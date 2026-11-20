// ESLint 9 flat config (#277) — Next 16 에서 `next lint` 가 없어져 eslint 를 직접 실행한다
import coreWebVitals from 'eslint-config-next/core-web-vitals';
import typescript from 'eslint-config-next/typescript';

const IGNORED_PATHS = ['.next/**', 'public/**', 'node_modules/**', 'coverage/**', 'next-env.d.ts'];

// scripts/*.js 는 node 로 바로 실행하는 CommonJS 진입점이라 require 가 정상이다
const NODE_SCRIPTS = {
  files: ['scripts/**/*.js'],
  rules: { '@typescript-eslint/no-require-imports': 'off' },
};

const config = [...coreWebVitals, ...typescript, NODE_SCRIPTS, { ignores: IGNORED_PATHS }];

export default config;
