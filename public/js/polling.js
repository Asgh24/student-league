/** Runs network polling only while its view and browser tab are active. */

export function startVisiblePolling({ intervalMs, poll, isActive = () => true }) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};

  let stopped = false;
  let inFlight = false;
  let timer = null;

  function stop() {
    if (stopped) return;
    stopped = true;
    if (timer !== null) window.clearInterval(timer);
    timer = null;
    document.removeEventListener('visibilitychange', onVisibilityChange);
  }

  async function run() {
    if (stopped) return;
    if (!isActive()) {
      stop();
      return;
    }
    if (document.hidden || inFlight) return;

    inFlight = true;
    try {
      await poll();
    } catch {
      // A transient polling error must not interrupt the current screen.
    } finally {
      inFlight = false;
    }
  }

  function onVisibilityChange() {
    if (!document.hidden) void run();
  }

  timer = window.setInterval(() => void run(), intervalMs);
  document.addEventListener('visibilitychange', onVisibilityChange);
  return stop;
}
