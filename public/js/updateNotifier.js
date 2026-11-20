/** Detects a newly deployed frontend and offers a deliberate, safe refresh. */

import { startVisiblePolling } from './polling.js';

const CHECK_INTERVAL_MS = 60_000;

export async function fetchServerRelease() {
  const response = await fetch('/healthz/version', {
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`version check failed (${response.status})`);
  const payload = await response.json();
  return typeof payload?.release === 'string' ? payload.release : '';
}

/** Clears Cache Storage (if ever used) and reloads through a cache-busting URL. */
export async function applyBrowserUpdate(release) {
  if ('caches' in window) {
    const names = await window.caches.keys();
    await Promise.all(names.map((name) => window.caches.delete(name)));
  }
  const url = new URL(window.location.href);
  url.searchParams.set('_update', release || Date.now().toString());
  window.location.replace(url.toString());
}

/**
 * Keeps the release loaded by this tab in memory. A different server release
 * means this exact tab is stale—even if another tab has already been updated.
 */
export function startUpdateNotifier({
  currentRelease = '',
  intervalMs = CHECK_INTERVAL_MS,
  getRelease = fetchServerRelease,
  applyUpdate = applyBrowserUpdate,
} = {}) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};

  const banner = document.getElementById('update-banner');
  const button = document.getElementById('update-app-btn');
  if (!banner || !button) return () => {};

  let baseline = typeof currentRelease === 'string' ? currentRelease : '';
  let availableRelease = '';
  let stopped = false;

  async function check() {
    const release = await getRelease();
    if (stopped || !release) return false;
    if (!baseline) {
      baseline = release;
      return false;
    }
    if (release === baseline) return false;
    availableRelease = release;
    banner.hidden = false;
    return true;
  }

  async function update() {
    if (!availableRelease) return;
    button.disabled = true;
    button.textContent = 'در حال به‌روزرسانی…';
    try {
      await applyUpdate(availableRelease);
    } catch {
      button.disabled = false;
      button.textContent = 'تلاش دوباره';
    }
  }

  button.addEventListener('click', update);
  const stopPolling = startVisiblePolling({ intervalMs, poll: check });
  // Also check once at startup; a deployment may have landed between loading
  // the HTML and completing application bootstrap.
  void check().catch(() => {});

  return () => {
    stopped = true;
    stopPolling();
    button.removeEventListener('click', update);
  };
}
