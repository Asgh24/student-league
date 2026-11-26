/**
 * «افزودن به صفحهٔ اصلی» support.
 *
 * Chrome, Edge and Samsung Internet expose the native install flow through the
 * `beforeinstallprompt` event; iOS Safari never fires it, so the dialog falls
 * back to written steps. Nothing here caches or intercepts requests: the
 * shortcut opens the same site in its own window and keeps the login session.
 */

const STANDALONE_QUERY = '(display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui)';

let deferredPrompt = null;
let installed = false;
let initialised = false;
const listeners = new Set();

function browserWindow() {
  return typeof window === 'undefined' ? null : window;
}

/** True while the site is already running from the home-screen icon. */
export function isStandalone() {
  const target = browserWindow();
  if (!target) return false;
  try {
    if (typeof target.matchMedia === 'function' && target.matchMedia(STANDALONE_QUERY).matches) return true;
  } catch {
    /* very old browsers have no matchMedia */
  }
  return target.navigator?.standalone === true;
}

/** iPhone/iPad, including iPadOS 13+ which reports a desktop Safari agent. */
export function isIos({ userAgent, maxTouchPoints } = {}) {
  const agent = userAgent ?? (typeof navigator === 'undefined' ? '' : navigator.userAgent ?? '');
  const touches = maxTouchPoints
    ?? (typeof navigator === 'undefined' ? 0 : Number(navigator.maxTouchPoints) || 0);
  if (/iPad|iPhone|iPod/i.test(agent)) return true;
  return /Macintosh/i.test(agent) && touches > 1;
}

/** Everything the UI needs to decide which button/instruction to show. */
export function installSnapshot() {
  return {
    installed: installed || isStandalone(),
    canPrompt: Boolean(deferredPrompt),
    ios: isIos(),
  };
}

function notifyListeners() {
  const value = installSnapshot();
  for (const listener of [...listeners]) {
    try {
      listener(value);
    } catch {
      /* a broken listener must not stop the others */
    }
  }
}

export function subscribeInstall(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Captures the browser install prompt; call once during boot. */
export function initInstallPrompt() {
  const target = browserWindow();
  if (!target || initialised) return installSnapshot();
  initialised = true;

  target.addEventListener('beforeinstallprompt', (event) => {
    // Keep the browser's mini-infobar away; the app offers its own button.
    event.preventDefault();
    deferredPrompt = event;
    notifyListeners();
  });

  target.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    installed = true;
    notifyListeners();
  });

  try {
    const query = typeof target.matchMedia === 'function' ? target.matchMedia(STANDALONE_QUERY) : null;
    query?.addEventListener?.('change', () => notifyListeners());
  } catch {
    /* ignore: the button state just stays as it was */
  }

  return installSnapshot();
}

/**
 * Runs the native install flow. Must be called from a user gesture (a click).
 * Returns `{ outcome: 'accepted' | 'dismissed' | 'unavailable' }`.
 */
export async function promptInstall() {
  const prompt = deferredPrompt;
  if (!prompt) return { outcome: 'unavailable' };
  deferredPrompt = null;
  try {
    await prompt.prompt();
    const choice = await prompt.userChoice;
    const outcome = choice?.outcome === 'accepted' ? 'accepted' : 'dismissed';
    if (outcome === 'accepted') installed = true;
    return { outcome };
  } catch {
    return { outcome: 'unavailable' };
  } finally {
    notifyListeners();
  }
}
