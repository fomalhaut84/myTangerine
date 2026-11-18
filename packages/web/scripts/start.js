#!/usr/bin/env node
/**
 * Next.js 프로덕션 서버 시작 스크립트
 * .env.local의 PORT 환경 변수를 읽어서 프로덕션 서버를 시작합니다.
 */

const { spawn } = require('child_process');
const path = require('path');

// .env.local 파일 로드 (Next.js와 동일하게 처리)
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const port = process.env.PORT || '3000';
// 리버스 프록시 뒤라면 127.0.0.1 로 묶는다 (#219 — 로그인 시도 제한이 X-Forwarded-For 를 믿는다)
const host = process.env.WEB_HOST;
if (host && !/^[\w.:-]+$/.test(host)) {
  console.error(`WEB_HOST 값이 올바르지 않습니다: ${host}`);
  process.exit(1);
}
const args = ['start', '-p', port, ...(host ? ['-H', host] : [])];

console.log(`Starting Next.js production server on ${host || '(all interfaces)'}:${port}...`);

const child = spawn('next', args, {
  stdio: 'inherit',
  shell: true,
});

child.on('exit', (code) => {
  process.exit(code || 0);
});
