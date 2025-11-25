/**
 * 전역 키보드 단축키 컴포넌트
 */

'use client';

import { useGlobalKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';

export function KeyboardShortcuts() {
  useGlobalKeyboardShortcuts();
  return null;
}
