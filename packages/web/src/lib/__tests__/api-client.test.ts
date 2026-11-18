/**
 * 웹 서버 경유 클라이언트 (#220)
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { BFF_BASE, handleUnauthorized } from '../api-client';

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
