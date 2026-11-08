// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { startVisiblePolling } from '../public/js/polling.js';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('visibility-aware polling', () => {
  it('skips hidden ticks and refreshes once when the tab becomes visible', async () => {
    vi.useFakeTimers();
    let hidden = false;
    vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
    const poll = vi.fn().mockResolvedValue(undefined);

    const stop = startVisiblePolling({ intervalMs: 1000, poll });
    await vi.advanceTimersByTimeAsync(1000);
    expect(poll).toHaveBeenCalledTimes(1);

    hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(5000);
    expect(poll).toHaveBeenCalledTimes(1);

    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
    expect(poll).toHaveBeenCalledTimes(2);

    stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops itself after its view becomes inactive', async () => {
    vi.useFakeTimers();
    let active = true;
    const poll = vi.fn().mockResolvedValue(undefined);

    startVisiblePolling({ intervalMs: 1000, poll, isActive: () => active });
    await vi.advanceTimersByTimeAsync(1000);
    expect(poll).toHaveBeenCalledTimes(1);

    active = false;
    await vi.advanceTimersByTimeAsync(1000);
    expect(poll).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not overlap a slow request with later ticks', async () => {
    vi.useFakeTimers();
    let finish;
    const poll = vi.fn(() => new Promise((resolve) => { finish = resolve; }));

    const stop = startVisiblePolling({ intervalMs: 1000, poll });
    await vi.advanceTimersByTimeAsync(3000);
    expect(poll).toHaveBeenCalledTimes(1);

    finish();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1000);
    expect(poll).toHaveBeenCalledTimes(2);
    stop();
  });
});
