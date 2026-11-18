#!/usr/bin/env bash
# release-inplace.sh — 서버 체크아웃(~/myTangerine)에 새 태그를 제자리 배포하고 판정 양식만 출력한다 (#201).
#
# 사용:  deploy/release-inplace.sh <vX.Y.Z> [--yes] [--dry-run] [--retry] [--allow-downgrade] [--confirm-manual]
#   --yes              확인을 묻지 않는다 (Actions 경로 · ssh-deploy.sh)
#   --dry-run          검사만 — 체크아웃·서비스·기록은 그대로 (헬스 확인은 읽기만 한다)
#   --retry            HEAD 가 이미 <vX.Y.Z> 일 때 같은 태그로 다시 빌드·재시작한다
#   --allow-downgrade  지금보다 낮은 태그로 간다 — 되돌리기 전용. 사람이 서버에서만 쓴다(자동 경로는 붙이지 않는다)
#   --confirm-manual   손으로 배포한 지금 태그(HEAD = <vX.Y.Z>)를 헬스 확인 뒤 성공으로 기록한다 — 수동 마이그레이션 뒤. 사람만
# 종료 코드: 0 통과 · 이미 배포됨(헬스 확인) · dry-run   1 중단 — 서비스 재시작 없음·체크아웃 직전 태그   2 사용법
#            4 사람 개입 필요 — 재시작·헬스 실패 · 빌드 복구 실패 · 지난 배포가 성공하지 않은 상태 (자동 롤백 없음)
# 출력은 판정 양식뿐이다 — Actions 로그는 공개된다. 홈 경로는 ~ 로 가리고 .env · pm2 env 값은 출력하지 않는다.
# 원본 로그·기록은 저장소 밖 700 디렉터리($MYTANGERINE_PRIVATE_DIR · 기본 ~/mytangerine-private).
# 자기 교체: checkout 이 이 파일을 바꾼다 — 본문을 함수에 두고 마지막 줄에서 main 을 부른 뒤 곧바로 exit 한다.

TAG_RE='^v[0-9]+\.[0-9]+\.[0-9]+$'
PM2_APPS_DEFAULT='myTangerineApi myTangerineSync myTangerineWeb'
BUILD_PACKAGES=(core api sync-service web)
# 스키마·마이그레이션이 바뀐 릴리즈는 자동 배포하지 않는다. 정본은 prisma/ 하나(#208) — packages/core/prisma 는
# #208 에서 지웠지만, 그 삭제가 든 릴리즈도 수동 절차를 타도록 목록에 남긴다
MIGRATION_PATHS=(prisma packages/core/prisma)

usage() { sed -n '4,10p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' >&2; exit 2; }
redact() { sed -E "s#${HOME}#~#g; s#/(home|Users)/[^/[:space:]]+#~#g"; }
count_lines() { [[ -z "$1" ]] && echo 0 || printf '%s\n' "$1" | wc -l | tr -d ' '; }
is_newer() { [[ "$1" != "$2" && "$(printf '%s\n%s\n' "$1" "$2" | sort -V | tail -1)" == "$1" ]]; }  # $1 > $2

FORM=()
form() { FORM+=("$*"); }
emit() {  # <결과 문구>
  echo "=== 판정 양식 ==="
  printf '%s\n' "${FORM[@]}" | redact
  echo "결과: $1" | redact
  [[ -z "${LOG:-}" ]] || echo "원본 로그: $LOG (공개하지 않는다)" | redact
  echo "=== 끝 ==="
}
stop() { local code=$1; shift; emit "중단 — $*"; exit "$code"; }

# 단계 출력은 원본 로그로만. 자식은 락 fd 9 를 물려받지 않는다(pm2 데몬이 잡으면 락이 풀리지 않는다)
run() { "$@" >>"$LOG" 2>&1 9>&-; }

LOCK_DIR=
take_lock() {  # <파일> → 0 잡음 · 1 다른 배포가 잡고 있음 · 3 락 파일을 열지 못함
  if [[ "${MYTANGERINE_LOCK:-}" != mkdir ]] && command -v flock >/dev/null; then
    exec 9>>"$1" || return 3
    flock -n 9 || return 1
    return 0
  fi
  mkdir "$1.d" 2>/dev/null || return 1
  LOCK_DIR="$1.d"
  trap '[[ -z "$LOCK_DIR" ]] || rm -rf "$LOCK_DIR"' EXIT
}

# .env 류에서 값 하나 — 출력하지 않고 포트 계산에만 쓴다
env_value() {  # <파일> <키>
  [[ -f "$1" ]] || return 0
  sed -nE "s/^$2=[\"']?([^\"'#[:space:]]*).*/\1/p" "$1" | tail -1
}

head_tag() {  # HEAD 에 붙은 릴리즈 태그 중 가장 높은 것 (없으면 빈 문자열)
  git -C "$ROOT" tag --points-at HEAD --sort=-v:refname 2>>"$LOG" | grep -E "$TAG_RE" | head -1
}

prev_tag() {  # <태그> — 버전 순으로 바로 아래 릴리즈 태그
  git -C "$ROOT" tag --list 'v*' --sort=-v:refname 2>>"$LOG" \
    | awk -v v="$1" 'f && /^v[0-9]+\.[0-9]+\.[0-9]+$/ { print; exit } $0 == v { f = 1 }'
}

schema_diff() {  # <a> <b> — 스키마·마이그레이션 변경 파일 (git 실패 시 rc ≠ 0)
  git -C "$ROOT" diff --name-only "refs/tags/$1" "refs/tags/$2" -- "${MIGRATION_PATHS[@]}" 2>>"$LOG"
}

build() {  # <태그> — checkout → install → 패키지 빌드. 실패 단계는 STEP 에 남는다
  STEP="checkout $1"
  run git -C "$ROOT" -c advice.detachedHead=false checkout -q --detach "refs/tags/$1^{commit}" || return 1
  STEP="install"
  (cd "$ROOT" && CI=true run pnpm install --frozen-lockfile) || return 1
  local pkg
  for pkg in "${BUILD_PACKAGES[@]}"; do
    STEP="build $pkg"
    (cd "$ROOT" && run pnpm --filter "@mytangerine/$pkg" build) || return 1
  done
  STEP=
}

# pm2 앱 상태 — "이름 상태 재시작횟수" 줄들 뒤에 OK. OK 가 없으면 조회 실패다(fail-closed).
# jlist 의 env 는 node 안에서만 읽고 출력하지 않는다.
pm2_snapshot() {  # <앱…>
  pm2 jlist 2>>"$LOG" 9>&- | node -e '
    let s = "";
    process.stdin.on("data", (d) => (s += d)).on("end", () => {
      // pm2 가 stdout 에 경고 줄을 섞을 수 있다 — 첫 "[" 부터 마지막 "]" 까지만 읽는다
      let list;
      try { list = JSON.parse(s.slice(s.indexOf("["), s.lastIndexOf("]") + 1)); } catch { process.exit(1); }
      if (!Array.isArray(list)) process.exit(1);
      const lines = process.argv.slice(1).map((n) => {
        const p = list.find((x) => x.name === n);
        const env = (p && p.pm2_env) || {};
        return `${n} ${p ? env.status : "missing"} ${p ? env.restart_time ?? -1 : -1}`;
      });
      process.stdout.write(lines.join("\n") + "\nOK\n");
    });' "$@" 2>>"$LOG"
}

# 스냅샷에서 online 이 아닌 앱 이름 (조회 실패면 "(pm2 조회 실패)")
not_online() {  # <스냅샷>
  [[ "$(printf '%s\n' "$1" | tail -1)" == OK ]] || { echo "(pm2 조회 실패)"; return; }
  printf '%s\n' "$1" | awk '$0 != "OK" && $2 != "online" { printf "%s%s", sep, $1; sep = " " }'
}
restarts() { printf '%s\n' "$1" | awk '$0 != "OK" { printf "%s=%s ", $1, $3 }'; }

http_code() {  # <url>
  local code
  code=$(curl -s -o /dev/null -m 5 -w '%{http_code}' "$1" 9>&-) || code=000
  [[ "$code" =~ ^[0-9]{3}$ ]] || code=000
  printf '%s' "$code"
}

# 헬스: API /health 200 · 웹 2xx/3xx · pm2 앱 전부 online — 그리고 안정 구간 뒤 다시 봐서
# online 이 유지되고 재시작 횟수가 늘지 않았을 때만 통과(크래시 루프는 순간적으로 online 이다)
health() {
  local api_port web_port deadline stable code_api=000 code_web=000 bad="" snap first
  api_port=$(env_value "$ROOT/.env" PORT); api_port=${api_port:-3001}
  web_port=$(env_value "$ROOT/packages/web/.env.local" PORT); web_port=${web_port:-3000}
  deadline=$((SECONDS + ${MYTANGERINE_HEALTH_TIMEOUT:-60}))
  stable=${MYTANGERINE_HEALTH_STABLE:-10}
  # shellcheck disable=SC2086
  while (( SECONDS < deadline )); do
    code_api=$(http_code "http://127.0.0.1:$api_port/health")
    code_web=$(http_code "http://127.0.0.1:$web_port/")
    snap=$(pm2_snapshot $APPS); bad=$(not_online "$snap")
    if [[ "$code_api" == 200 && "$code_web" =~ ^[23] && -z "$bad" ]]; then
      first=$(restarts "$snap")
      sleep "$stable"
      code_api=$(http_code "http://127.0.0.1:$api_port/health")
      code_web=$(http_code "http://127.0.0.1:$web_port/")
      snap=$(pm2_snapshot $APPS); bad=$(not_online "$snap")
      if [[ "$code_api" == 200 && "$code_web" =~ ^[23] && -z "$bad" && "$(restarts "$snap")" == "$first" ]]; then
        form "헬스: api 200 · web $code_web · pm2 전부 online · ${stable}s 동안 재시작 없음"
        return 0
      fi
      [[ -n "$bad" || "$(restarts "$snap")" == "$first" ]] || bad="(재시작 반복: $first→ $(restarts "$snap"))"
    fi
    sleep "${MYTANGERINE_HEALTH_INTERVAL:-3}"
  done
  form "헬스: api $code_api · web $code_web · online 아님: ${bad:-없음}"
  return 1
}

record_ok() {  # <태그> — 성공 기록을 쓰고 진행 중 표지를 지운다
  printf '%s\n' "$1" > "$PRIV/last-ok.tmp" && mv -f "$PRIV/last-ok.tmp" "$PRIV/last-ok" && rm -f "$PRIV/pending"
}
# 진행 중 표지 — 시도를 시작할 때 쓰고 성공(또는 직전 태그로 복구)했을 때만 지운다.
# 남아 있으면 지난 시도가 실패·중단된 것이다(회귀: PR #203 Codex P2 — 실패한 재시도를 이전 성공 기록이 덮었다)
mark_pending() { printf '%s\n' "$1" > "$PRIV/pending.tmp" && mv -f "$PRIV/pending.tmp" "$PRIV/pending"; }

main() {
  set -uo pipefail
  export LC_ALL=C GIT_TERMINAL_PROMPT=0
  local V="" yes=0 dry=0 retry=0 downgrade=0 manual=0 arg
  for arg in "$@"; do
    case "$arg" in
      --yes) yes=1 ;;
      --dry-run) dry=1 ;;
      --retry) retry=1 ;;
      --allow-downgrade) downgrade=1 ;;
      --confirm-manual) manual=1 ;;
      -*) usage ;;
      *) [[ -z "$V" ]] || usage; V=$arg ;;
    esac
  done
  [[ "$V" =~ $TAG_RE ]] || usage
  if [[ "$(uname -s)" == Darwin && $dry -eq 0 && "${MYTANGERINE_TEST:-}" != 1 ]]; then
    echo "release-inplace: 로컬(Darwin)에서는 --dry-run 만 허용한다 — 배포는 서버에서" >&2
    exit 2
  fi

  ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
  APPS=${MYTANGERINE_PM2_APPS:-$PM2_APPS_DEFAULT}
  PRIV=${MYTANGERINE_PRIVATE_DIR:-$HOME/mytangerine-private}
  LOG=
  form "태그: $V"
  local logfile
  logfile="$PRIV/deploy-$V-$(date +%Y%m%d-%H%M%S).log"
  if ! { mkdir -p "$PRIV" && chmod 700 "$PRIV" && (umask 077; : > "$logfile"); } 2>/dev/null; then
    stop 1 "개인 로그 디렉터리를 준비하지 못했다(~/mytangerine-private 권한 확인)"
  fi
  LOG=$logfile
  local lock_rc=0
  take_lock "$PRIV/deploy.lock" || lock_rc=$?
  case $lock_rc in
    0) ;;
    3) stop 1 "락 파일을 열지 못했다" ;;
    *) stop 1 "다른 배포가 진행 중이다(락)" ;;
  esac

  # A — 태그 · 작업 트리 · 마이그레이션 (여기까지는 체크아웃·서비스 그대로)
  run git -C "$ROOT" fetch -q --no-tags origin "refs/tags/$V:refs/tags/$V" \
    || stop 1 "태그 $V fetch 실패 — 태그 없음 · 로컬 태그와 다름 · 네트워크 중 하나(원본 로그)"
  # 릴리즈 태그는 main 에 머지된 커밋이어야 한다 — dev·피처 커밋에 붙은 v* 태그를 배포하지 않는다
  run git -C "$ROOT" fetch -q --no-tags origin "+refs/heads/main:refs/remotes/origin/main" \
    || stop 1 "origin/main fetch 실패(원본 로그)"
  git -C "$ROOT" merge-base --is-ancestor "refs/tags/$V^{commit}" refs/remotes/origin/main 2>>"$LOG" \
    || stop 1 "태그 $V 가 main 에 없는 커밋이다 — 릴리즈 PR 머지 뒤의 main 에 태그를 단다"
  local P last=""
  P=$(head_tag)
  [[ -n "$P" ]] || stop 1 "지금 HEAD 가 릴리즈 태그가 아니다 — 수동 확인(런북 첫 배포)"
  form "직전: $P"
  [[ -f "$PRIV/last-ok" ]] && last=$(head -1 "$PRIV/last-ok")

  local pending=""
  [[ -f "$PRIV/pending" ]] && pending=$(head -1 "$PRIV/pending")
  (( ! manual )) || [[ "$P" == "$V" ]] || stop 2 "--confirm-manual 은 HEAD 가 $V 일 때만 쓴다(지금 $P)"

  if [[ "$P" == "$V" && $retry -eq 0 ]]; then
    # 같은 태그 — 지난 배포가 성공으로 끝났는지 기록과 헬스로 확인한다(실패한 배포를 "이미 배포됨"으로 덮지 않는다)
    if (( manual )); then
      # 손으로 배포한 태그를 성공으로 기록한다 (회귀: PR #203 Codex P2 — 수동 마이그레이션 뒤 기록을 맞출 길이 없었다)
      health || { emit "실패 — 손 배포 확인: 헬스 실패"; exit 4; }
      if (( dry )); then emit "dry-run — 손 배포 확인 가능(헬스 정상) · 기록하지 않았다"; exit 0; fi
      record_ok "$V" || stop 4 "성공 기록(last-ok)을 쓰지 못했다"
      emit "손 배포 확인 — $V 를 성공으로 기록했다${last:+ (이전 기록 $last)}"
      exit 0
    fi
    if [[ -n "$pending" ]]; then
      form "끝나지 않은 시도: $pending"
      form "재시도: deploy/release-inplace.sh $V --yes --retry"
      stop 4 "지난 배포 시도가 성공으로 끝나지 않았다"
    fi
    if [[ -n "$last" && "$last" != "$V" ]]; then
      form "마지막 성공 배포: $last"
      form "재시도: deploy/release-inplace.sh $V --yes --retry"
      form "손으로 배포했다면: deploy/release-inplace.sh $V --yes --confirm-manual"
      stop 4 "HEAD 는 $V 지만 그 배포는 성공으로 끝나지 않았다"
    fi
    if ! health; then
      form "재시도: deploy/release-inplace.sh $V --yes --retry"
      emit "실패 — $V 가 체크아웃돼 있지만 헬스 확인 실패"
      exit 4
    fi
    if (( ! dry )) && [[ -z "$last" ]]; then
      record_ok "$V" || stop 4 "성공 기록(last-ok)을 쓰지 못했다"
      form "성공 기록: 없었음 → $V 로 기록(첫 확인)"
    fi
    emit "이미 배포됨 — $V (헬스 확인 · 다시 빌드하려면 --retry)"
    exit 0
  fi

  if [[ "$P" != "$V" ]] && is_newer "$P" "$V" && (( ! downgrade )); then
    stop 1 "$V 는 지금($P)보다 낮다 — 되돌리기는 서버에서 --allow-downgrade 로 손으로 한다"
  fi
  local st
  st=$(git -C "$ROOT" status --porcelain --untracked-files=no 2>>"$LOG") || stop 1 "git status 실패"
  [[ -z "$st" ]] || stop 1 "작업 트리에 커밋되지 않은 변경이 있다 — 수동 확인"
  local mig envd
  mig=$(schema_diff "$P" "$V") || stop 1 "스키마 비교 실패"
  if [[ -n "$mig" ]]; then
    form "스키마·마이그레이션 변경: $(count_lines "$mig") 파일"
    stop 1 "스키마·마이그레이션 변경 — 자동 배포하지 않는다(런북 수동 절차 · 이런 릴리즈는 --prerelease 로 발행)"
  fi
  form "스키마·마이그레이션 변경: 0"
  if envd=$(git -C "$ROOT" diff --name-only "refs/tags/$P" "refs/tags/$V" -- .env.example 'packages/*/.env.example' 2>>"$LOG"); then
    [[ -z "$envd" ]] || form "주의: .env.example 변경 — 서버 .env 에 새 키가 필요한지 확인"
  else
    form "주의: .env.example 비교 실패 — 확인 불가"
  fi

  # 되돌리기 대상 — 재시도면 바로 아래 태그, 아니면 지금 태그
  local BACK=$P back_note=""
  if [[ "$P" == "$V" ]]; then
    BACK=$(prev_tag "$V")
    if [[ -z "$BACK" ]]; then
      form "되돌리기 대상: 없음(아래 태그를 찾지 못했다)"
    else
      local bmig
      bmig=$(schema_diff "$BACK" "$V") || bmig="(비교 실패)"
      [[ -z "$bmig" ]] || back_note=" — 주의: $BACK..$V 구간에 스키마 변경이 있다. 되돌리기 전에 런북 확인"
    fi
  fi

  if (( dry )); then
    emit "dry-run — 검사 통과 · 체크아웃·서비스 그대로"
    exit 0
  fi
  if (( ! yes )); then
    local answer
    read -r -p "$P → $V 배포할까? [y/N] " answer
    [[ "$answer" == y ]] || stop 1 "사용자 취소"
  fi

  # B — 빌드. 운영 체크아웃 위에서 install·next build 를 하므로 빌드 동안 웹이 잠시 오류를 낼 수 있다(#201 후속: 별도 디렉터리 빌드).
  #     새 태그로 가는 중 실패하면 직전 태그로 다시 빌드해 디스크를 원래대로(서비스 재시작 없음).
  #     재시도(같은 태그) 실패는 더 옛 태그로 내려가지 않는다 — 그 구간의 마이그레이션을 검사하지 않았기 때문이다.
  local t0=$SECONDS failed
  mark_pending "$V" || stop 1 "진행 중 표지를 쓰지 못했다"
  if ! build "$V"; then
    failed=$STEP
    form "빌드: 실패 — $failed"
    if [[ "$P" != "$V" ]] && build "$P"; then
      rm -f "$PRIV/pending"   # 디스크가 실행 중인 직전 태그와 다시 같아졌다
      stop 1 "$failed 실패 — 직전 태그 $P 로 다시 빌드했다(서비스 재시작 없음 · 빌드 중 웹이 잠시 오류를 냈을 수 있다)"
    fi
    [[ "$P" == "$V" ]] && form "복구: 재시도라 직전 태그로 내려가지 않았다" || form "복구: 실패 — ${STEP:-?}"
    form "수동: 원인 해결 뒤 deploy/release-inplace.sh $V --yes --retry · 또는 런북 손 배포"
    emit "중단 — 빌드 실패 · 디스크가 실행 중 버전과 다를 수 있다"
    exit 4
  fi
  form "빌드: 통과 ($((SECONDS - t0))s)"

  # C — 재시작 · 헬스 (실패하면 안내만 — 자동 롤백 없음)
  # shellcheck disable=SC2086
  if ! run pm2 restart $APPS || ! health; then
    if [[ -n "$BACK" ]]; then
      form "되돌리기: deploy/release-inplace.sh $BACK --yes --allow-downgrade$back_note"
    fi
    form "재시도: deploy/release-inplace.sh $V --yes --retry"
    emit "실패 — 재시작 또는 헬스 체크"
    exit 4
  fi
  record_ok "$V" || stop 4 "배포는 됐지만 성공 기록(last-ok)을 쓰지 못했다"
  form "소요: $((SECONDS - t0))s"
  emit "통과 — $V"
  exit 0
}

[[ "${BASH_SOURCE[0]}" != "$0" ]] || { main "$@"; exit $?; }
