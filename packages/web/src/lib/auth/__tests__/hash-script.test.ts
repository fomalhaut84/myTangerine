// @vitest-environment node
/**
 * 해시 생성 스크립트와 검증 코드의 형식 일치 (#219)
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { verifyPassword } from '../password';

const SCRIPT = path.resolve(__dirname, '../../../../scripts/hash-password.mjs');

function run(input: string) {
  return spawnSync(process.execPath, [SCRIPT], { input, encoding: 'utf8' });
}

describe('scripts/hash-password.mjs', () => {
  it('prints a hash that verifyPassword accepts', async () => {
    const result = run('a-long-admin-password\n');
    expect(result.status).toBe(0);
    const line = result.stdout.trim();
    expect(line.startsWith('ADMIN_PASSWORD_HASH=scrypt:')).toBe(true);
    const hash = line.slice('ADMIN_PASSWORD_HASH='.length);
    expect(await verifyPassword('a-long-admin-password', hash)).toBe(true);
    expect(await verifyPassword('another-password', hash)).toBe(false);
  });

  it('refuses a short password and prints nothing to stdout', () => {
    const result = run('short\n');
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
  });
});
