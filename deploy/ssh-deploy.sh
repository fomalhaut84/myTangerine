#!/usr/bin/env bash
# ssh-deploy.sh — 배포 전용 ssh 키의 forced command (#201). 이 키로는 이 스크립트만 돈다.
#
# 서버 ~/.ssh/authorized_keys 한 줄 (사용자 등록 · 런북 docs/runbooks/auto-deploy.md):
#   restrict,command="<홈>/myTangerine/deploy/ssh-deploy.sh" ssh-ed25519 AAAA… mytangerine-deploy
# 받는 명령은 하나뿐: SSH_ORIGINAL_COMMAND = "deploy vX.Y.Z" — 그 밖(셸 · 인자 추가 · 다른 명령)은 rc 2 로 거부.
# 하는 일: 같은 체크아웃의 deploy/release-inplace.sh <V> --yes. 종료 코드는 그 스크립트의 것을 그대로 돌려준다.
# 출력은 판정 양식뿐(홈 경로를 ~ 로) — Actions 로그는 공개 저장소에서 누구나 본다.
# 자기 교체: release-inplace 의 checkout 이 이 파일도 바꾼다 — 본문을 함수에 두고 마지막 줄에서 main 후 exit.

TAG_RE='^v[0-9]+\.[0-9]+\.[0-9]+$'

main() {
  set -uo pipefail
  export LC_ALL=C
  local cmd=${SSH_ORIGINAL_COMMAND:-} verb tag extra
  read -r verb tag extra <<<"$cmd"
  if [[ "$verb" != deploy || ! "$tag" =~ $TAG_RE || -n "$extra" || "$cmd" != "deploy $tag" ]]; then
    echo "ssh-deploy: 거부 — 받는 명령은 'deploy vX.Y.Z' 하나다" >&2
    return 2
  fi

  # 비대화형 ssh 는 로그인 프로필을 읽지 않는다 — 서버의 node · pnpm · pm2 는 /usr/local/bin (뒤에 붙인다: 앞의 PATH 를 덮지 않는다)
  PATH="${PATH:-/usr/bin:/bin}:/usr/local/bin"
  local root
  root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
  echo "## myTangerine $tag"
  bash "$root/deploy/release-inplace.sh" "$tag" --yes </dev/null 2>&1 \
    | sed -E "s#${HOME}#~#g; s#/(home|Users)/[^/[:space:]]+#~#g"
  local st=("${PIPESTATUS[@]}")
  # 가리기(sed)가 실패하면 양식이 사라진다 — 성공으로 보고하지 않는다
  if [[ ${st[1]} -ne 0 && ${st[0]} -eq 0 ]]; then
    echo "ssh-deploy: 출력 가리기 실패 — 배포 결과는 서버 원본 로그 확인" >&2
    return 4
  fi
  return "${st[0]}"
}

[[ "${BASH_SOURCE[0]}" != "$0" ]] || { main "$@"; exit $?; }
