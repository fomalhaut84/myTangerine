/**
 * pm2 앱 정의 (#256)
 *
 * fork 모드로 띄운다 — cluster 모드는 pm2 가 직접 띄운 프로세스(pnpm)의 출력만 로그에 남겨,
 * pnpm 이 다시 띄운 node 의 앱 로그(pino)가 사라졌다(2026-04 ~ 2026-11-19 운영).
 * 앱마다 인스턴스 하나라 cluster 로 얻는 것이 없다.
 *
 * - 이름은 배포 스크립트(deploy/release-inplace.sh PM2_APPS_DEFAULT)와 같다 — 배포는 이름으로 재시작한다
 * - cwd 는 저장소 루트: 서비스가 실행 위치에서 위로 올라가 루트 .env 를 읽는다(비밀은 .env 에만 — 여기 넣지 않는다)
 * - TZ 고정(#257): 시트 타임스탬프 해석이 프로세스 시간대를 따른다
 * - 전환 · 되돌리기 절차: docs/runbooks/auto-deploy.md *pm2 fork 모드 전환*
 */

const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');

function app(name, pkg) {
  return {
    name,
    script: 'pnpm',
    args: ['--filter', pkg, 'start'],
    cwd: REPO_ROOT,
    exec_mode: 'fork',
    instances: 1,
    autorestart: true,
    time: true, // 로그 줄 앞에 시각
    env: { TZ: 'Asia/Seoul' },
  };
}

module.exports = {
  apps: [
    app('myTangerineApi', '@mytangerine/api'),
    app('myTangerineSync', '@mytangerine/sync-service'),
    app('myTangerineWeb', '@mytangerine/web'),
  ],
};
