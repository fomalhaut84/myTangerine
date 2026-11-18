# 자동 배포 런북 (#201)

GitHub Release 발행(`vX.Y.Z`)이 곧 서버 배포다. 별도 승인 단계는 없다 — 릴리즈 PR 머지와 Release 발행이 배포 의지다.

```
Release 발행 (prerelease 제외)
  → Actions .github/workflows/deploy.yml (environment: production)
     저장소 코드를 받지 않고 ssh 로 "deploy vX.Y.Z" 한 줄만 보낸다
  → 서버 배포 전용 키의 forced command: deploy/ssh-deploy.sh   ("deploy vX.Y.Z" 외 전부 거부)
  → deploy/release-inplace.sh vX.Y.Z --yes
       락 → 태그 fetch → 태그가 main 에 있는 커밋인지 → HEAD 가 릴리즈 태그인지 · 작업 트리 깨끗한지
       → 지금보다 낮은 태그면 멈춤(다운그레이드는 사람이 --allow-downgrade 로만)
       → 스키마·마이그레이션 변경이 있으면 멈춤(rc 1 · 수동 절차)
       → checkout → pnpm install --frozen-lockfile → core · api · sync-service · web 빌드
       → pm2 restart myTangerineApi myTangerineSync myTangerineWeb
       → 헬스: API /health 200 · 웹 2xx/3xx · pm2 세 앱 online, 10초 뒤 다시 봐서 재시작 횟수가 늘지 않았을 때만 통과 (최대 60초)
       → 성공 기록 ~/mytangerine-private/last-ok 갱신 → 판정 양식 출력 (Actions 실행 요약에도 남는다)
```

- **자동 롤백은 없다** (사용자 결정 2026-11-17). 재시작·헬스 체크가 실패하면 판정 양식의 `되돌리기` 줄을 사람이 서버에서 실행한다.
- 빌드가 실패하면 직전 태그로 다시 빌드해 디스크를 원래대로 돌려놓고 멈춘다(서비스는 재시작하지 않았다).
- **빌드는 운영 체크아웃 위에서 한다** — `pnpm install` · `next build` 가 도는 동안(수 분) 웹이 일부 화면에서 오류를 낼 수 있다. 주문 처리 중인 시간에는 발행하지 않는다. (후속: 별도 디렉터리에서 빌드 후 교체)
- 같은 태그를 다시 보내면(Actions 재실행) **성공 기록과 헬스를 확인**한다 — 지난 배포가 실패로 끝났으면 `이미 배포됨` 이 아니라 rc 4 다.
- 저장소가 PUBLIC 이라 Actions 로그는 누구나 본다. 서버는 판정 양식만 돌려주고 홈 경로는 `~` 로 가린다. 원본 로그는 서버 `~/mytangerine-private/deploy-<태그>-<시각>.log`(600).

## 1회 설정 (사용자)

### 1. 배포 전용 키 만들기 — 로컬 PC 에서

```bash
ssh-keygen -t ed25519 -N '' -C mytangerine-deploy -f ./mytangerine-deploy
```

pleiades 배포 키와 **별개**로 만든다. 키 하나가 한 저장소의 forced command 하나만 부를 수 있어야 한다.

### 2. 서버에 공개키 등록 — forced command 로 묶는다

서버 `~/.ssh/authorized_keys` 에 **한 줄** 추가 (`<계정>` 은 서버 계정):

```
restrict,command="/home/<계정>/myTangerine/deploy/ssh-deploy.sh" ssh-ed25519 AAAA…(mytangerine-deploy.pub 내용)… mytangerine-deploy
```

- `restrict` = 포트 포워딩 · pty · agent 전달 등 전부 끔
- 이 키로는 `ssh-deploy.sh` 만 돈다. 그 스크립트는 `deploy vX.Y.Z` 외의 명령을 거부한다

### 3. 서버 호스트 키 받기 — 로컬 PC 에서

```bash
ssh-keyscan -p <포트> <서버 주소> 2>/dev/null
```

출력 줄을 **평소 접속할 때 보는 지문과 대조**한 뒤 다음 단계의 `DEPLOY_KNOWN_HOSTS` 에 넣는다.

### 4. GitHub environment · secrets

저장소 → Settings → Environments → **New environment: `production`**

1. **Deployment branches and tags** → *Selected branches and tags* → **Add rule → Tag → `v*`**
   (다른 브랜치·태그에서 이 secrets 를 쓰는 배포가 돌지 못하게)
2. **Environment secrets** (저장소 수준 secrets 가 아니라 environment 에):

| 이름 | 값 |
|---|---|
| `DEPLOY_SSH_KEY` | `mytangerine-deploy` **개인키** 파일 전체 |
| `DEPLOY_HOST` | 서버 주소 |
| `DEPLOY_USER` | 서버 계정 |
| `DEPLOY_KNOWN_HOSTS` | 3단계 출력 |
| `DEPLOY_PORT` | ssh 포트 (22 면 생략) |

3. 로컬의 개인키 파일을 지운다: `rm ./mytangerine-deploy ./mytangerine-deploy.pub`

### 5. 서버 점검 (한 번)

```bash
cd ~/myTangerine
git ls-files -s deploy/*.sh          # 100755 여야 한다 — 실행 비트가 없으면 forced command 가 실패한다
head -10 ~/.bashrc                   # 비대화형이면 바로 return 하는 줄([ -z "$PS1" ] && return 등)이 맨 위에 있어야 한다
                                     # — 없으면 .bashrc 출력이 공개 Actions 로그에 섞일 수 있다
grep '^PORT=' .env packages/web/.env.local   # 헬스 체크가 보는 포트 — 같은 서버의 다른 앱(pleiades 등)과 겹치지 않는지
```

### 6. GitHub 태그 보호 (권장)

Settings → Rules → Rulesets → **New tag ruleset**: 대상 `v*` · *Restrict creations / updates / deletions* · 우회는 관리자만.
release 이벤트는 그 태그 커밋에 있는 `deploy.yml` 로 돈다 — 태그를 아무나 못 달게 해야 production secrets 가 보호된다.
스크립트도 태그가 `main` 에 머지된 커밋인지 확인한다(아니면 rc 1).

### 7. 첫 배포 (부트스트랩)

forced command 가 가리키는 `deploy/ssh-deploy.sh` 는 **이 기능이 들어간 첫 릴리즈부터** 서버 체크아웃에 생긴다.
그 전 태그(v1.1.1 이하)에서는 Actions 가 부를 스크립트가 없으므로 첫 릴리즈는 이렇게 한다:

1. 릴리즈를 **draft 로** 만든다: `gh release create vX.Y.Z --draft --title vX.Y.Z --notes-file …`
2. 서버에서 손으로 배포한다:
   ```bash
   cd ~/myTangerine
   git fetch --tags && git checkout vX.Y.Z
   # 하나라도 실패하면 재시작까지 가지 않는다
   CI=true pnpm install --frozen-lockfile \
     && pnpm --filter @mytangerine/core build && pnpm --filter @mytangerine/api build \
     && pnpm --filter @mytangerine/sync-service build && pnpm --filter @mytangerine/web build \
     && pm2 restart myTangerineApi myTangerineSync myTangerineWeb
   deploy/release-inplace.sh vX.Y.Z --dry-run      # "이미 배포됨" 이 나와야 한다 (헬스 확인 포함)
   ```
3. GitHub 에서 draft 를 **Publish** → Actions 가 돈다 → `결과: 이미 배포됨` (rc 0 · 헬스 확인 · 성공 기록 생성) 이면 ssh · forced command · secrets 경로가 끝까지 확인된 것이다.

그 다음 릴리즈부터는 발행만 하면 된다.

되돌리기(직전 태그로)는 서버에서 사람이 한다: `deploy/release-inplace.sh <직전 태그> --yes --allow-downgrade` — 자동 경로(ssh)는 이 플래그를 붙일 수 없다.

## 웹 접근 제어 전환 (#196 · 1회 · `--draft` 릴리즈)

#218(API 키) · #219(웹 로그인) · #220(웹 서버 경유 호출)이 들어간 릴리즈는 **`--draft`** 로 발행하고, 아래를 마친 뒤 GitHub 에서 Publish 한다.
셋 중 하나만 배포하면 웹이 API 를 부르지 못한다.

1. **루트 `.env`(API)** — `API_SECRET_KEY` 있음 · `CORS_ORIGIN` 없음(또는 `*` 아님) · `HOST=127.0.0.1` 추가(API 를 외부에 열지 않는다 — 요청 상한도 이 전제)
2. **`packages/web/.env.local`(웹)**
   - `API_SECRET_KEY` = 루트 `.env` 와 **같은 값**
   - `API_INTERNAL_URL=http://127.0.0.1:<API PORT>`
   - `SESSION_SECRET` = `openssl rand -hex 32`
   - `ADMIN_PASSWORD_HASH` = `pnpm --filter @mytangerine/web hash-password` 출력 줄(비밀번호는 표준 입력 · 화면에 안 보임)
   - `WEB_HOST=127.0.0.1` — 로그인 시도 제한(IP별)이 리버스 프록시가 붙인 `X-Forwarded-For` 를 믿는 전제다. 이 전제가 안 되면 `LOGIN_GLOBAL_MAX_FAILURES` 를 켠다(대가: 관리자 잠금 공격 가능)
   - HTTPS 가 아니면 `SESSION_COOKIE_SECURE=false`
   - `NEXT_PUBLIC_API_BASE_URL` 은 더 쓰지 않는다(지워도 된다)
3. **리버스 프록시** — `/api` 를 API 로 보내는 분기를 지우고 **전부 웹으로** 보낸다. `X-Forwarded-For` 를 덧붙이는지 확인(로그인 시도 제한이 마지막 값을 쓴다). 읽기 타임아웃(nginx `proxy_read_timeout` 기본 60초)을 `/bff/api/sync` 는 5분 이상 · `/bff/api/orders/report` 는 2분 이상으로
4. Publish → 자동 배포 → 브라우저에서 `/login` → 로그인 → 주문 목록 · 라벨 PDF 다운로드 · 동기화 버튼 1회씩

**되돌리기:** `deploy/release-inplace.sh v1.2.0 --yes --allow-downgrade` + 리버스 프록시 `/api` 분기 복구 + API `HOST` 원복. 추가한 웹 env 는 남아도 무해.

## 릴리즈 발행 규칙

| 릴리즈 | 발행 | 배포 |
|---|---|---|
| 일반 (코드만) | `gh release create vX.Y.Z …` | 발행 즉시 자동 |
| **스키마·마이그레이션 변경** | `gh release create vX.Y.Z --prerelease …` | Actions 건너뜀 → 아래 *수동 마이그레이션* |
| 서버 조치 필요 (`.env` 새 키 · pm2 이름·포트) | `gh release create vX.Y.Z --draft …` | 서버 조치 → GitHub 에서 Publish → 자동 |

prerelease 를 나중에 정식으로 바꿔도 배포는 돌지 않는다(`released` 이벤트). 스크립트도 스키마 변경 태그에서는 바꾸기 전에 멈추므로(rc 1) 실수로 정식 발행해도 서비스는 그대로다.

배포 시각: 발행 = 즉시 배포. 주문 처리 중인 시간은 피한다. sync-service 는 1분마다 돈다 — 재시작으로 한 주기를 건너뛸 수 있다.

## 결과 읽기 (Actions 실행 요약 · 판정 양식)

| rc | 의미 | 할 일 |
|---|---|---|
| 0 `통과` | 배포 완료 | — |
| 0 `이미 배포됨` | 같은 태그가 성공 기록돼 있고 헬스도 정상(재실행 등) | — |
| 1 | 멈춤 — 서비스 재시작 없음 (태그 없음 · main 에 없는 태그 · 낮은 태그 · 작업 트리 변경 · 스키마 변경 · 락 · 빌드 실패 후 직전 태그로 복구 — 빌드 중 웹이 잠시 오류를 냈을 수 있다) | `결과:` 줄의 원인 해결 → Actions "Re-run jobs" 또는 서버에서 `deploy/release-inplace.sh vX.Y.Z --yes` |
| 2 | 사용법 · 명령 거부 | 태그 형식 · forced command 확인 |
| 4 | 재시작·헬스 실패 · 빌드 복구 실패 · 지난 시도가 끝나지 않음(`pending`) · 성공 기록과 HEAD 가 다름(손 배포 뒤라면 `--confirm-manual`) — **서비스가 불완전할 수 있다** | 양식의 `되돌리기:` 줄(직전 태그 · `--allow-downgrade`) 또는 `재시도:` 줄(`--retry`)을 서버에서 실행. 원본 로그 확인 |
| 124 | Actions 쪽 시간 초과(25분) — 서버 쪽 배포는 계속 돌았을 수 있다 | 서버 `~/mytangerine-private/` 의 최신 로그와 `last-ok` 확인 |
| 255 | ssh 연결 실패 | 호스트 · 포트 · 키 · known_hosts · authorized_keys 줄 확인 |

## 수동 마이그레이션 (prerelease 릴리즈)

`.claude/rules/data-safety.md` 의 *Prisma 스키마 — 정본 하나* 를 먼저 읽는다 — 정본은 루트 `prisma/` 하나다(#208). `migrate status` 확인 없이 `migrate deploy` 하지 않는다.

1. sync-service 정지: `pm2 stop myTangerineSync`
2. 백업: `sudo -u postgres pg_dump -Fc mytangerine > ~/mytangerine-$(date +%Y%m%d-%H%M).dump`
3. `git fetch --tags && git checkout vX.Y.Z` → `CI=true pnpm install --frozen-lockfile` → `pnpm prisma:generate`(DB 접속 없음 · install 이 건너뛰어도 client 를 만든다) → `pnpm exec prisma migrate status`(저장소 루트) → **up to date 가 아닐 때만** `pnpm prisma:deploy` → 4개 패키지 빌드 → `pm2 restart …`
4. sync-service 재개: `pm2 start myTangerineSync` — 다음 단계의 헬스 확인은 pm2 앱 3개가 **모두 online** 이어야 통과하므로 먼저 켠다
5. `deploy/release-inplace.sh vX.Y.Z --yes --confirm-manual` — 헬스 확인 뒤 이 태그를 성공으로 기록한다(`손 배포 확인`). 이걸 하지 않으면 다음 자동 배포 · 재실행이 "성공으로 끝나지 않았다"(rc 4)로 멈춘다

**스키마가 바뀐 릴리즈의 되돌리기는 손으로 한다** — `release-inplace.sh <직전> --allow-downgrade` 도 두 태그 사이 스키마 차이를 보고 rc 1 로 멈춘다.
`git checkout <직전태그>` → `CI=true pnpm install --frozen-lockfile` → 4개 패키지 빌드 → `pm2 restart …` → `deploy/release-inplace.sh <직전태그> --yes --confirm-manual`.
마이그레이션을 적용했다면 되돌리기 전에 그 SQL 이 직전 코드와 호환되는지 먼저 본다(DB 는 되돌리지 않는다 — 필요하면 2단계 백업으로 복원, 사용자 판단).

> **#208 이전 태그로 되돌릴 때.** #208 이전 스키마는 client 를 루트 `node_modules/.prisma` 에 생성하지만,
> 런타임은 #208 이 pnpm 저장소 안에 만든 client 를 계속 먼저 읽는다. 두 스키마의 모델이 같은 동안은 무해하다.
> 스키마가 바뀐 뒤 #208 이전으로 되돌리게 되면 `node_modules/.pnpm/@prisma+client@*/node_modules/.prisma` 를 지우고 install 을 다시 한다.

## 되돌리기 (이 자동화 자체)

**#201 이전 태그(v1.1.1 이하)로 되돌리면 `deploy/` 가 체크아웃에서 사라진다** — forced command 가 없어 이후 자동 배포가 rc 127 로 실패한다. 그 경우 다음 릴리즈는 7단계(부트스트랩)처럼 손으로 한다.

즉시 — `.github/workflows/deploy.yml` 삭제 · environment `production` 의 secrets 삭제 · 서버 `authorized_keys` 의 `mytangerine-deploy` 줄 삭제. 그 뒤로는 위 5-2 의 손 배포로 돌아간다.
