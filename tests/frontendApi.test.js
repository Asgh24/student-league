// @vitest-environment jsdom
/**
 * Client side CSRF lifecycle: the token must be refreshed when the session is
 * rotated, and a stale token must be retried exactly once.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError, api, refreshCsrf, setCsrfToken } from '../public/js/api.js';

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

let fetchMock;

beforeEach(() => {
  setCsrfToken(null);
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock;
});

describe('api client CSRF handling', () => {
  it('stores the token returned by /auth/csrf and sends it on mutations', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { csrfToken: 'token-1' }));
    const token = await refreshCsrf();
    expect(token).toBe('token-1');

    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    await api.post('/leagues', { name: 'کلاس' });

    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe('/api/v1/leagues');
    expect(init.method).toBe('POST');
    expect(init.headers['x-csrf-token']).toBe('token-1');
    expect(init.credentials).toBe('same-origin');
  });

  it('refreshes the token and retries once when the session rotated', async () => {
    setCsrfToken('stale-token');
    fetchMock
      .mockResolvedValueOnce(jsonResponse(403, { error: { code: 'INVALID_CSRF', message: 'stale' } }))
      .mockResolvedValueOnce(jsonResponse(200, { csrfToken: 'fresh-token' }))
      .mockResolvedValueOnce(jsonResponse(201, { ok: true }));

    const result = await api.post('/leagues', { name: 'کلاس' });
    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/leagues');
    expect(fetchMock.mock.calls[1][0]).toBe('/api/v1/auth/csrf');
    expect(fetchMock.mock.calls[2][0]).toBe('/api/v1/leagues');
    expect(fetchMock.mock.calls[0][1].headers['x-csrf-token']).toBe('stale-token');
    expect(fetchMock.mock.calls[2][1].headers['x-csrf-token']).toBe('fresh-token');
  });

  it('does not retry a plain permission error', async () => {
    setCsrfToken('token-1');
    fetchMock.mockResolvedValueOnce(jsonResponse(403, { error: { code: 'FORBIDDEN', message: 'ممنوع' } }));

    await expect(api.get('/student/dashboard')).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports transport failures as a network error', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    await expect(api.get('/meta')).rejects.toMatchObject({ status: 0, code: 'NETWORK' });
  });
});
