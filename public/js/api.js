/** JSON API client with CSRF handling and a normalized error type. */

let csrfToken = null;

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details ?? [];
  }
}

export function setCsrfToken(token) {
  csrfToken = typeof token === 'string' && token.length > 0 ? token : null;
}

export function getCsrfToken() {
  return csrfToken;
}

let refreshInFlight = null;

/**
 * Always asks the server for a token bound to the *current* session. Needed
 * after logout (or any session rotation), because the in-memory token then
 * belongs to a session that no longer exists.
 */
export function refreshCsrf() {
  if (!refreshInFlight) {
    refreshInFlight = fetch('/api/v1/auth/csrf', {
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (data && typeof data.csrfToken === 'string') csrfToken = data.csrfToken;
        refreshInFlight = null;
        return csrfToken;
      })
      .catch(() => {
        refreshInFlight = null;
        return csrfToken;
      });
  }
  return refreshInFlight;
}

const BASE = '/api/v1';
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Builds a fresh fetch init per attempt so a retry never reuses mutated headers. */
function buildInit({ method, body, form, headers, token }) {
  const init = {
    method,
    credentials: 'same-origin',
    headers: { accept: 'application/json', ...headers },
  };
  if (token) init.headers['x-csrf-token'] = token;
  if (form) {
    init.body = form;
  } else if (body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  return init;
}

async function request(method, path, { body, form, headers = {} } = {}) {
  // A rotated session (logout, server restart, expired cookie) invalidates the
  // in-memory token, so one retry after a fresh token keeps the UI working.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const init = buildInit({ method, body, form, headers, token: csrfToken });

    let response;
    try {
      response = await fetch(`${BASE}${path}`, init);
    } catch (err) {
      throw new ApiError(0, 'NETWORK', 'ارتباط با سرور برقرار نشد', [String(err?.message || err)]);
    }

    const text = response.status === 204 ? '' : await response.text();
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
    }

    if (!response.ok) {
      const error = payload?.error ?? {};
      const code = error.code || 'HTTP_ERROR';
      if (code === 'INVALID_CSRF' && MUTATING.has(method) && attempt === 0) {
        await refreshCsrf();
        continue;
      }
      throw new ApiError(response.status, code, error.message || 'درخواست با خطا مواجه شد', error.details ?? []);
    }

    if (payload && typeof payload.csrfToken === 'string') setCsrfToken(payload.csrfToken);
    return payload;
  }

  throw new ApiError(403, 'INVALID_CSRF', 'توکن امنیتی نامعتبر است. صفحه را دوباره بارگذاری کنید');
}

export const api = {
  request,
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, { body }),
  patch: (path, body) => request('PATCH', path, { body }),
  put: (path, body) => request('PUT', path, { body }),
  del: (path, body) => request('DELETE', path, { body }),
  upload: (path, formData) => request('POST', path, { form: formData }),
};

/** Fetches the public metadata (brand name, version) used by the shell. */
export const meta = () => request('GET', '/meta');
export const me = () => request('GET', '/auth/me');
export const login = (username, password) => request('POST', '/auth/login', { body: { username, password } });
export const logout = () => request('POST', '/auth/logout', { body: {} });
