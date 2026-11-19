/**
 * #231: 시트 재조정은 hybrid 에서만 (S-5)
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@mytangerine/core', () => ({
  SheetReconciler: class {
    constructor(public sheet: unknown, public db: unknown) {}
  },
}));

import { createReconciler } from '../reconcile-gate.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

describe('createReconciler', () => {
  it('hybrid 면 만든다', () => {
    expect(createReconciler('hybrid', {} as never, {} as never, logger as never)).toBeDefined();
  });

  it.each([['sheets'], ['database'], [undefined]])('%s 면 만들지 않는다(시트를 덮지 않는다)', (mode) => {
    expect(createReconciler(mode, {} as never, {} as never, logger as never)).toBeUndefined();
  });
});
