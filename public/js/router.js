/**
 * Minimal hash router. Patterns use `:name` segments, e.g. `/teacher/league/:id`.
 * Views receive `{ params, query, navigate, path }` and may return a redirect
 * path to force a different route.
 */

export function currentPath() {
  const raw = (typeof window !== 'undefined' ? window.location.hash : '').replace(/^#\/?/, '');
  const withoutQuery = raw.split('?')[0];
  return withoutQuery.replace(/\/+$/, '');
}

export function queryParams() {
  const raw = (typeof window !== 'undefined' ? window.location.hash : '').split('?')[1] ?? '';
  try {
    return new URLSearchParams(raw);
  } catch {
    return new URLSearchParams();
  }
}

/** Returns a params object when `path` matches `pattern`, otherwise null. */
export function matchPattern(pattern, path) {
  const expected = String(pattern).split('/').filter(Boolean);
  const actual = String(path).split('/').filter(Boolean);
  if (expected.length !== actual.length) return null;
  const params = {};
  for (let index = 0; index < expected.length; index += 1) {
    const token = expected[index];
    if (token.startsWith(':')) {
      params[token.slice(1)] = decodeURIComponent(actual[index]);
      continue;
    }
    if (token !== actual[index]) return null;
  }
  return params;
}

/** Builds a concrete path from a pattern plus parameter values. */
export function buildPath(pattern, params = {}) {
  return String(pattern)
    .split('/')
    .map((token) => (token.startsWith(':') ? encodeURIComponent(params[token.slice(1)] ?? '') : token))
    .join('/');
}

export function createRouter({ routes, fallback = null, onNavigate = null, onError = null }) {
  let resolving = false;
  let scheduled = false;

  function go(path, { replace = false } = {}) {
    const clean = String(path ?? '').replace(/^#?\/?/, '');
    const target = `#/${clean}`;
    if (window.location.hash === target) {
      void resolve();
      return;
    }
    if (replace) window.location.replace(`${window.location.pathname}${window.location.search}${target}`);
    else window.location.hash = target;
  }

  async function resolve() {
    if (resolving) {
      scheduled = true;
      return;
    }
    resolving = true;
    try {
      const path = currentPath();
      const query = queryParams();
      for (const route of routes) {
        const params = matchPattern(route.path, path);
        if (!params) continue;

        if (route.guard) {
          const verdict = route.guard({ params, query, path });
          if (verdict === false) return;
          if (typeof verdict === 'string') {
            go(verdict, { replace: true });
            return;
          }
        }
        const result = await route.view({ params, query, path, navigate: go });
        if (typeof result === 'string') {
          go(result, { replace: true });
          return;
        }
        if (onNavigate) onNavigate({ path, params, route });
        return;
      }
      if (fallback) await fallback({ path, query, navigate: go });
    } catch (error) {
      if (onError) onError(error);
      else throw error;
    } finally {
      resolving = false;
      if (scheduled) {
        scheduled = false;
        void resolve();
      }
    }
  }

  function start() {
    window.addEventListener('hashchange', () => {
      void resolve();
    });
    return resolve();
  }

  return { start, navigate: go, resolve };
}
