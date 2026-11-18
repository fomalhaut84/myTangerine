// @vitest-environment node
/**
 * 관리자 비밀번호 해시 검증 (#219)
 */

import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../password';

describe('password hash', () => {
  it('verifies the original password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash.startsWith('scrypt:')).toBe(true);
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('correct horse battery stapl', hash)).toBe(false);
  });

  it('produces different hashes for the same password (random salt)', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });

  it.each([undefined, '', 'plain-text', 'scrypt:1:2', 'bcrypt:a:b:c:d:e', 'scrypt:x:8:1:AAAA:AAAA', 'scrypt:3:8:1:AAAA:AAAA'])(
    'rejects when the stored hash is missing or malformed (%s)',
    async (stored) => {
      expect(await verifyPassword('anything', stored)).toBe(false);
    }
  );

  // 회귀: `$` 구분자는 Next 의 .env 변수 확장에 깨진다
  it('does not contain $ (safe in .env.local)', async () => {
    expect(await hashPassword('secret')).not.toContain('$');
  });

  it('rejects an empty password', async () => {
    const hash = await hashPassword('secret');
    expect(await verifyPassword('', hash)).toBe(false);
  });
});
