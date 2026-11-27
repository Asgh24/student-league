/**
 * Bell badge + browser notifications.
 *
 * The shell polls one tiny endpoint (`/notifications/unread`) and paints every
 * badge in the page. Polling also runs while the tab is hidden (at a slower
 * pace) so an opt-in native notification can still reach a teacher or student
 * who left the site open in the background. There is no service worker: a
 * closed tab or closed app is covered by the optional parent SMS, not by push.
 */

import { api } from './api.js';
import { number } from './format.js';
import { state } from './store.js';
import { notify } from './ui.js';

const PREF_KEY = 'scl.desktopNotifications';
const POLL_MS = 45_000;

let timer = null;
let running = false;
let inFlight = false;
let lastSeenId = null;

function badgeText(count) {
  if (count <= 0) return '';
  const cap = count > 99 ? `${number(99, state.persianDigits)}+` : number(count, state.persianDigits);
  return cap;
}

/** Paints the count on the topbar bell and every drawer badge. */
export function updateNotificationsBadge(value) {
  const count = Math.max(0, Number.parseInt(value ?? 0, 10) || 0);
  state.notificationsUnread = count;
  if (typeof document === 'undefined') return count;
  const text = badgeText(count);
  for (const node of document.querySelectorAll('[data-notify-badge], #notif-badge')) {
    node.textContent = text;
    node.hidden = count === 0;
  }
  const button = document.getElementById('notif-btn');
  if (button) {
    button.classList.toggle('has-unread', count > 0);
    button.setAttribute('aria-label', count > 0 ? `اعلان‌ها (${number(count, state.persianDigits)} خوانده‌نشده)` : 'اعلان‌ها');
  }
  return count;
}

export function canUseDesktopNotifications() {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function desktopNotificationsEnabled() {
  try {
    return window.localStorage.getItem(PREF_KEY) === '1';
  } catch {
    return false;
  }
}

export function setDesktopNotificationsEnabled(value) {
  try {
    window.localStorage.setItem(PREF_KEY, value ? '1' : '0');
  } catch {
    /* storage can be unavailable in private mode */
  }
}

/** Returns 'granted' | 'denied' | 'default' | 'unsupported'. */
export async function requestDesktopNotifications() {
  if (!canUseDesktopNotifications()) return 'unsupported';
  if (window.Notification.permission === 'granted') {
    setDesktopNotificationsEnabled(true);
    return 'granted';
  }
  if (window.Notification.permission === 'denied') return 'denied';
  const permission = await window.Notification.requestPermission();
  setDesktopNotificationsEnabled(permission === 'granted');
  return permission;
}

function showDesktop(item) {
  if (!desktopNotificationsEnabled() || !canUseDesktopNotifications()) return;
  if (window.Notification.permission !== 'granted') return;
  try {
    const native = new window.Notification(item.title || 'اعلان جدید', {
      body: String(item.body ?? '').slice(0, 180),
      tag: `scl-notification-${item.id}`,
      icon: '/img/pwa/icon-192.png',
      badge: '/img/pwa/icon-192.png',
    });
    native.onclick = () => {
      window.focus();
      native.close();
    };
  } catch {
    /* some browsers only allow this from a service worker */
  }
}

/** Fetches the unread count, paints the badge and announces genuinely new items. */
export async function refreshNotificationsBadge() {
  if (typeof document === 'undefined') return 0;
  if (!state.user) {
    lastSeenId = null;
    updateNotificationsBadge(0);
    return 0;
  }
  if (inFlight) return null;
  inFlight = true;
  try {
    const payload = await api.get('/notifications/unread');
    updateNotificationsBadge(payload?.count ?? 0);
    const latest = payload?.latest;
    if (latest && Number.isFinite(Number(latest.id))) {
      const id = Number(latest.id);
      if (lastSeenId === null) {
        // The backlog that existed on load is not "new news" for this tab.
        lastSeenId = id;
      } else if (id > lastSeenId) {
        lastSeenId = id;
        if (document.hidden) showDesktop(latest);
        else notify.info(`🔔 ${latest.title}`);
      }
    }
    return payload?.count ?? 0;
  } catch {
    return null;
  } finally {
    inFlight = false;
  }
}

async function tick() {
  if (!running) return;
  if (!state.user) {
    updateNotificationsBadge(0);
    return;
  }
  await refreshNotificationsBadge();
}

/** Starts a visibility-aware poll loop; returns a stop function. */
export function startNotificationPolling({ intervalMs = POLL_MS } = {}) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};
  if (running) return () => {};
  running = true;
  void tick();
  timer = window.setInterval(() => void tick(), intervalMs);

  const onActive = () => {
    if (!document.hidden) void tick();
  };
  window.addEventListener('focus', onActive);
  document.addEventListener('visibilitychange', onActive);

  return () => {
    running = false;
    if (timer !== null) window.clearInterval(timer);
    timer = null;
    window.removeEventListener('focus', onActive);
    document.removeEventListener('visibilitychange', onActive);
  };
}
