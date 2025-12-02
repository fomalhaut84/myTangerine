/**
 * In-memory cache 유틸리티
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class InMemoryCache<T> {
  private cache = new Map<string, CacheEntry<T>>();

  /**
   * 캐시에 값 저장
   * @param key 캐시 키
   * @param value 저장할 값
   * @param ttlMs TTL (밀리초)
   */
  set(key: string, value: T, ttlMs: number): void {
    const expiresAt = Date.now() + ttlMs;
    this.cache.set(key, { value, expiresAt });
  }

  /**
   * 캐시에서 값 조회
   * @param key 캐시 키
   * @returns 캐시된 값 또는 undefined
   */
  get(key: string): T | undefined {
    const entry = this.cache.get(key);

    if (!entry) {
      return undefined;
    }

    // 만료된 캐시는 삭제하고 undefined 반환
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }

    return entry.value;
  }

  /**
   * 캐시에서 특정 키 삭제
   * @param key 캐시 키
   */
  delete(key: string): void {
    this.cache.delete(key);
  }

  /**
   * 패턴과 일치하는 모든 키 삭제
   * @param pattern 정규표현식 또는 문자열 패턴
   */
  invalidate(pattern: string | RegExp): void {
    const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;

    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * 모든 캐시 삭제
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * 만료된 캐시 정리
   */
  cleanup(): void {
    const now = Date.now();

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * 캐시 크기 조회
   */
  size(): number {
    return this.cache.size;
  }
}
