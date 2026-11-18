/**
 * 관리자 비밀번호 해시 (#219) — Node 내장 scrypt.
 *
 * 저장 형식: `scrypt:<N>:<r>:<p>:<salt base64>:<hash base64>` (ADMIN_PASSWORD_HASH).
 * 구분자가 `$` 가 아닌 이유: Next 는 .env 값의 `$NAME` 을 변수로 확장해 해시를 깨뜨린다.
 * 해시 만들기: `pnpm --filter @mytangerine/web hash-password` (비밀번호는 표준 입력으로 받는다).
 */

import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';

const PARAMS = { N: 16384, r: 8, p: 1 } as const;
const KEY_LENGTH = 64;
const SALT_BYTES = 16;
// 저장된 해시의 N 이 지나치게 크면 메모리를 다 쓴다 — 상한을 둔다
const MAX_N = 2 ** 20;

function scrypt(password: string, salt: Buffer, keylen: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, { ...options, maxmem: 256 * 1024 * 1024 }, (err, key) =>
      err ? reject(err) : resolve(key)
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await scrypt(password, salt, KEY_LENGTH, PARAMS);
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64'), key.toString('base64')].join(':');
}

interface ParsedHash {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  key: Buffer;
}

function parseHash(stored: string): ParsedHash | null {
  const parts = stored.split(':');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null;
  const [, nRaw, rRaw, pRaw, saltRaw, keyRaw] = parts;
  const [N, r, p] = [nRaw, rRaw, pRaw].map((v) => (/^\d+$/.test(v) ? Number(v) : NaN));
  if (![N, r, p].every((v) => Number.isInteger(v) && v > 0) || N > MAX_N) return null;
  const salt = Buffer.from(saltRaw, 'base64');
  const key = Buffer.from(keyRaw, 'base64');
  if (salt.length === 0 || key.length === 0) return null;
  return { N, r, p, salt, key };
}

export async function verifyPassword(password: string, stored: string | undefined): Promise<boolean> {
  if (!password || !stored) return false;
  const parsed = parseHash(stored);
  if (!parsed) return false;

  try {
    const derived = await scrypt(password, parsed.salt, parsed.key.length, {
      N: parsed.N,
      r: parsed.r,
      p: parsed.p,
    });
    return timingSafeEqual(derived, parsed.key);
  } catch {
    // 잘못된 파라미터(예: N 이 2 의 거듭제곱이 아님) — 설정 오류이므로 로그인 실패로 처리
    return false;
  }
}
