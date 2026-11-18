#!/usr/bin/env node
/**
 * ADMIN_PASSWORD_HASH 만들기 (#219)
 *
 *   pnpm --filter @mytangerine/web hash-password
 *
 * 비밀번호는 표준 입력으로 받는다(명령 인자로 넘기면 셸 기록에 남는다).
 * 형식은 src/lib/auth/password.ts 와 같다 — 파라미터를 바꾸면 두 곳을 함께 바꾼다.
 */

import { randomBytes, scryptSync } from 'node:crypto';
import { createInterface } from 'node:readline';

const PARAMS = { N: 16384, r: 8, p: 1 };
const KEY_LENGTH = 64;
const MIN_LENGTH = 12;

function hash(password) {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, KEY_LENGTH, PARAMS);
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64'), key.toString('base64')].join(':');
}

const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: process.stdin.isTTY });
if (process.stdin.isTTY) {
  // 입력을 화면에 표시하지 않는다
  rl._writeToOutput = () => {};
  process.stderr.write(`관리자 비밀번호(${MIN_LENGTH}자 이상): `);
}

rl.once('line', (line) => {
  rl.close();
  if (process.stdin.isTTY) process.stderr.write('\n');
  const password = line.replace(/\r$/, '');
  if (password.length < MIN_LENGTH) {
    process.stderr.write(`비밀번호는 ${MIN_LENGTH}자 이상이어야 합니다.\n`);
    process.exit(1);
  }
  process.stdout.write(`ADMIN_PASSWORD_HASH=${hash(password)}\n`);
});
