/**
 * 시트 칸이 없을 때 조용히 성공하지 않는다 (#293)
 *
 * 예전에는 `송장번호` · `삭제됨` 칸이 없으면 경고만 남기고 성공으로 끝났다 — hybrid 는 시트 반영이 된 줄 알고
 * 실패 표시를 남기지 않아, DB 에만 있는 변경이 표시 없이 남았다. 이제 아무것도 쓰기 전에 던진다.
 * 실제 시트에는 닿지 않는다(S-4).
 */
import { describe, it, expect, vi } from 'vitest';
import { SheetService } from '../sheet-service.js';

function service(headers: string[]) {
  const s = Object.create(SheetService.prototype) as SheetService;
  const updateCell = vi.fn().mockResolvedValue(undefined);
  const updateOrderStatus = vi.fn().mockResolvedValue(undefined);
  Object.assign(s, { getHeaders: vi.fn().mockResolvedValue(headers), updateCell, updateOrderStatus });
  return { s, updateCell, updateOrderStatus };
}

describe('SheetService — 칸이 없으면 쓰지 않고 던진다 (#293)', () => {
  it('markDelivered: 송장번호를 줬는데 칸이 없으면 상태도 바꾸지 않고 던진다', async () => {
    const { s, updateCell, updateOrderStatus } = service(['타임스탬프', '비고']);
    await expect(s.markDelivered([5], 'T-1')).rejects.toThrow('송장번호');
    expect(updateOrderStatus).not.toHaveBeenCalled();
    expect(updateCell).not.toHaveBeenCalled();
  });

  it('markDelivered: 송장번호가 없으면 칸이 없어도 상태만 쓴다(기존)', async () => {
    const { s, updateOrderStatus } = service(['타임스탬프', '비고']);
    await s.markDelivered([5]);
    expect(updateOrderStatus).toHaveBeenCalledWith(5, '배송완료');
  });

  it.each(['softDelete', 'restore'] as const)('%s: 삭제됨 칸이 없으면 던진다', async (m) => {
    const { s, updateCell } = service(['타임스탬프', '비고']);
    await expect(s[m]([5])).rejects.toThrow('삭제됨');
    expect(updateCell).not.toHaveBeenCalled();
  });

  it('softDelete: 칸이 있으면 쓴다', async () => {
    const { s, updateCell } = service(['타임스탬프', '비고', '삭제됨']);
    await s.softDelete([5]);
    expect(updateCell).toHaveBeenCalledWith(5, 3, expect.any(String));
  });
});
