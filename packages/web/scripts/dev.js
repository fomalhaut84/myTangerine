#!/usr/bin/env node
/**
 * Next.js 개발 서버 시작 스크립트
 * .env.local의 PORT 환경 변수를 읽어서 dev 서버를 시작합니다.
 */

const { spawn } = require('child_process');
const path = require('path');

// .env.local 파일 로드 (Next.js와 동일하게 처리)
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const port = process.env.PORT || '3000';

console.log(`Starting Next.js dev server on port ${port}...`);

const child = spawn('next', ['dev', '-p', port], {
  stdio: 'inherit',
  shell: true,
});

child.on('exit', (code) => {
  process.exit(code || 0);
});
