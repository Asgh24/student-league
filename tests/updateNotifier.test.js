// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startUpdateNotifier } from '../public/js/updateNotifier.js';

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = `
    <section id="update-banner" hidden>
      <button id="update-app-btn" type="button">به‌روزرسانی</button>
    </section>
  `;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('frontend update notifier', () => {
  it('stays hidden on the loaded release and appears after a deployment', async () => {
    let serverRelease = 'release-a';
    const getRelease = vi.fn(async () => serverRelease);
    const applyUpdate = vi.fn(async () => {});
    const stop = startUpdateNotifier({
      currentRelease: 'release-a',
      intervalMs: 1000,
      getRelease,
      applyUpdate,
    });

    await vi.waitFor(() => expect(getRelease).toHaveBeenCalledTimes(1));
    expect(document.getElementById('update-banner').hidden).toBe(true);

    serverRelease = 'release-b';
    await vi.advanceTimersByTimeAsync(1000);
    expect(document.getElementById('update-banner').hidden).toBe(false);

    document.getElementById('update-app-btn').click();
    await vi.waitFor(() => expect(applyUpdate).toHaveBeenCalledWith('release-b'));
    stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses the first successful check as its baseline when startup metadata failed', async () => {
    const getRelease = vi.fn(async () => 'release-a');
    const stop = startUpdateNotifier({ currentRelease: '', intervalMs: 1000, getRelease });

    await vi.waitFor(() => expect(getRelease).toHaveBeenCalledTimes(1));
    expect(document.getElementById('update-banner').hidden).toBe(true);
    stop();
  });
});
