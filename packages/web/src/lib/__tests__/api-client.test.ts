/**
 * 웹 서버 경유 클라이언트 (#220)
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { toast } from 'sonner';
import { BFF_BASE, handleUnauthorized, notifyWriteWarnings } from '../api-client';

vi.mock('sonner', () => ({ toast: { warning: vi.fn() } }));

describe('api-client', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState(null, '', '/');
  });

  it('calls the same-origin BFF, never the API server directly', () => {
    expect(BFF_BASE).toBe('/bff');
  });

  it('sends the user to /login with the current path on 401', () => {
    window.history.replaceState(null, '', '/orders?status=new');
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => {});
    handleUnauthorized(new Response(null, { status: 401 }));
    expect(assign).toHaveBeenCalledWith(`/login?next=${encodeURIComponent('/orders?status=new')}`);
  });

  it('does nothing for other statuses', () => {
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => {});
    handleUnauthorized(new Response(null, { status: 403 }));
    handleUnauthorized(new Response(null, { status: 200 }));
    expect(assign).not.toHaveBeenCalled();
  });
});

describe('notifyWriteWarnings (#197)', () => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  afterEach(() => {
    vi.mocked(toast.warning).mockClear();
  });

  it('shows each warning from a write response', async () => {
    await notifyWriteWarnings('POST', json({ success: true, warnings: ['시트 반영 실패'] }));
    expect(toast.warning).toHaveBeenCalledWith('시트 반영 실패', expect.anything());
  });

  it('ignores reads, failures, missing warnings and non-JSON bodies', async () => {
    await notifyWriteWarnings('GET', json({ warnings: ['x'] }));
    await notifyWriteWarnings('POST', json({ warnings: ['x'] }, 500));
    await notifyWriteWarnings('PATCH', json({ success: true }));
    await notifyWriteWarnings('POST', new Response('%PDF', { headers: { 'content-type': 'application/pdf' } }));
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it('leaves the original body readable for the caller', async () => {
    const response = json({ success: true, warnings: ['w'] });
    await notifyWriteWarnings('POST', response);
    expect(await response.json()).toEqual({ success: true, warnings: ['w'] });
  });
});
