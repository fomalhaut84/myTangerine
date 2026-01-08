/**
 * 프로젝트 루트 디렉토리 찾기
 * pnpm-workspace.yaml 또는 package.json의 workspaces 필드를 찾아서 프로젝트 루트를 결정
 */

import { existsSync, readFileSync } from 'fs';
import path from 'path';

/**
 * 주어진 디렉토리에서 시작하여 상위로 올라가며 프로젝트 루트 찾기
 * @param startDir 시작 디렉토리 (기본값: process.cwd())
 * @returns 프로젝트 루트 경로
 */
export function findProjectRoot(startDir: string = process.cwd()): string {
  let currentDir = startDir;

  // 최대 10단계까지만 올라감 (무한 루프 방지)
  for (let i = 0; i < 10; i++) {
    // pnpm-workspace.yaml 확인
    if (existsSync(path.join(currentDir, 'pnpm-workspace.yaml'))) {
      return currentDir;
    }

    // package.json의 workspaces 필드 확인
    const packageJsonPath = path.join(currentDir, 'package.json');
    if (existsSync(packageJsonPath)) {
      try {
        const packageJsonContent = readFileSync(packageJsonPath, 'utf-8');
        const packageJson = JSON.parse(packageJsonContent);
        if (packageJson.workspaces) {
          return currentDir;
        }
      } catch (error) {
        // package.json 파싱 실패 시 무시
      }
    }

    // 상위 디렉토리로 이동
    const parentDir = path.dirname(currentDir);

    // 루트 디렉토리에 도달했으면 현재 디렉토리 반환
    if (parentDir === currentDir) {
      return currentDir;
    }

    currentDir = parentDir;
  }

  // 찾지 못한 경우 시작 디렉토리 반환
  return startDir;
}
