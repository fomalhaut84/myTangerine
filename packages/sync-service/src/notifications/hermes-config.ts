/**
 * hermes 알림 설정 (#251)
 *
 * - HERMES_KEY(비밀)가 없으면 꺼진다 — 표시도 발송도 하지 않는다.
 *   키 없이 운영하는 동안 대기가 쌓였다가 키를 넣는 순간 몰려 나가지 않게 한다
 * - HERMES_URL 기본값은 같은 서버 루프백(hermes 는 지금 루프백 요청만 받는다)
 * - ADMIN_WEB_URL 은 주문 상세 링크의 앞부분. hermes 는 https 링크만 게시하므로 https 만 받는다
 *
 * 결과 객체와 경고 문구에 키 값을 넣지 않는다(S-1).
 */

export const DEFAULT_HERMES_URL = 'http://127.0.0.1:4700/v1/messages';

export type HermesConfig =
  | { enabled: false; reason: string }
  | { enabled: true; url: string; key: string; adminWebUrl: string | undefined; warnings: string[] };

type Env = Record<string, string | undefined>;

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export function loadHermesConfig(env: Env): HermesConfig {
  const key = env.HERMES_KEY?.trim();
  if (!key) {
    return { enabled: false, reason: 'HERMES_KEY 미설정 — 신규 주문 알림을 끈다' };
  }

  const rawUrl = env.HERMES_URL?.trim() || DEFAULT_HERMES_URL;
  const url = parseUrl(rawUrl);
  if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:')) {
    return { enabled: false, reason: 'HERMES_URL 이 http(s) 주소가 아니다 — 신규 주문 알림을 끈다' };
  }

  const warnings: string[] = [];
  let adminWebUrl: string | undefined;
  const rawAdmin = env.ADMIN_WEB_URL?.trim();
  if (rawAdmin) {
    const admin = parseUrl(rawAdmin);
    if (admin && admin.protocol === 'https:') {
      adminWebUrl = admin.toString().replace(/\/+$/, '');
    } else {
      warnings.push('ADMIN_WEB_URL 이 https 주소가 아니다 — 알림에 주문 상세 링크를 넣지 않는다');
    }
  } else {
    warnings.push('ADMIN_WEB_URL 미설정 — 알림에 주문 상세 링크를 넣지 않는다');
  }

  return { enabled: true, url: url.toString(), key, adminWebUrl, warnings };
}
