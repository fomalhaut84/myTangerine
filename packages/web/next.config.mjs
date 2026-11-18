import withPWA, { runtimeCaching as defaultRuntimeCaching } from '@ducanh2912/next-pwa';

/**
 * 서비스워커가 캐시해도 되는 것은 정적 자원뿐이다 (#219).
 * 기본 규칙의 pages · pages-rsc · apis · start-url 은 로그인 뒤 본 주문(개인정보) 화면·응답을
 * Cache Storage 에 남기고, 로그아웃 뒤나 오프라인에서 세션 없이 보여 줄 수 있어 뺀다.
 * 규칙이 없는 요청은 서비스워커를 거치지 않고 네트워크로 간다.
 *
 * 주의: 이 플러그인은 webpack 빌드에서만 돈다. 현재 `next build`(Turbopack)는 서비스워커를 만들지 않는다 —
 * 이 설정은 webpack 빌드로 돌아갈 때를 위한 것이다. 로그아웃은 남아 있는 서비스워커·캐시를 지운다.
 */
const STATIC_CACHE_NAMES = new Set([
  'google-fonts-webfonts',
  'google-fonts-stylesheets',
  'static-font-assets',
  'static-image-assets',
  'next-static-js-assets',
  'next-image',
  'static-js-assets',
  'static-style-assets',
]);

export const staticRuntimeCaching = defaultRuntimeCaching.filter((rule) =>
  STATIC_CACHE_NAMES.has(rule.options?.cacheName ?? '')
);

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Next.js 16에서 Turbopack이 기본값이지만 PWA 플러그인은 webpack 필요
  turbopack: {},
};

export default withPWA({
  dest: 'public',
  disable: process.env.NODE_ENV === 'development',
  register: true,
  skipWaiting: true,
  cacheStartUrl: false,
  cacheOnFrontEndNav: false,
  workboxOptions: {
    runtimeCaching: staticRuntimeCaching,
  },
})(nextConfig);
