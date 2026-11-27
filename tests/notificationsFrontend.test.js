// @vitest-environment jsdom
/**
 * In-site notification centre, frontend side:
 * - the topbar bell badge and the polling loop that keeps it fresh
 * - the inbox (role gating of the compose button, list, read, delete)
 * - the teacher/admin compose form and its validation
 * - the opt-in browser notifications preference
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../public/js/api.js', () => {
  const api = {
    request: vi.fn(),
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    del: vi.fn(),
    upload: vi.fn(),
  };
  return { api, ApiError: class ApiError extends Error {} };
});

vi.mock('../public/js/ui.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    confirmDialog: vi.fn(async () => true),
    notify: { ok: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() },
  };
});

const { api } = await import('../public/js/api.js');
const { confirmDialog, notify } = await import('../public/js/ui.js');
const { setLeagueId, setUser, state } = await import('../public/js/store.js');
const {
  canUseDesktopNotifications,
  desktopNotificationsEnabled,
  refreshNotificationsBadge,
  requestDesktopNotifications,
  setDesktopNotificationsEnabled,
  startNotificationPolling,
  updateNotificationsBadge,
} = await import('../public/js/notifications.js');
const { renderNotifications } = await import('../public/js/views/notifications.js');
const { renderNotificationsCompose } = await import('../public/js/views/notificationsCompose.js');

const NOTIF_BADGE = () => document.getElementById('notif-badge');
const NOTIF_BTN = () => document.getElementById('notif-btn');
const COMPOSE_LINK = () => document.querySelector('#view a[href="#/teacher/notifications/new"]');
const ADMIN_COMPOSE_LINK = () => document.querySelector('#view a[href="#/admin/notifications/new"]');

function shell() {
  document.body.innerHTML = `
    <header class="topbar" id="topbar">
      <span class="topbar__title" id="topbar-title">عنوان</span>
      <button class="pill pill--bell" id="notif-btn" type="button" aria-label="اعلان‌ها" hidden>
        <span aria-hidden="true">🔔</span>
        <span class="pill__count" id="notif-badge" hidden></span>
      </button>
    </header>
    <main class="view" id="view" tabindex="-1"></main>
    <div id="modal-root"></div>
    <div id="toasts"></div>
  `;
}

function clickButton(root, label) {
  const node = [...root.querySelectorAll('button')]
    .find((button) => button.textContent.includes(label));
  expect(node, `button «${label}» not found`).toBeTruthy();
  node.click();
  return node;
}

const INBOX_ITEMS = [
  {
    id: 2,
    source: 'admin',
    senderName: 'مدیر سامانه',
    title: 'تعطیلی فردا',
    body: 'فردا مدرسه تعطیل است.',
    category: 'info',
    link: '',
    pinned: false,
    createdAt: '2026-01-02T08:00:00.000Z',
    readAt: null,
  },
  {
    id: 1,
    source: 'teacher',
    senderName: 'خانم الف',
    title: 'آزمون ریاضی',
    body: 'فردا آزمون فصل سوم است.',
    category: 'warning',
    link: 'teacher/league/1/homework',
    pinned: false,
    createdAt: '2026-01-01T08:00:00.000Z',
    readAt: '2026-01-01T09:00:00.000Z',
  },
];

beforeEach(async () => {
  shell();
  localStorage.clear();
  setUser(null);
  setLeagueId(null);
  // Reset the module's "already seen" pointer without touching the network.
  await refreshNotificationsBadge();
  vi.clearAllMocks();
  api.get.mockResolvedValue({ count: 0, latest: null });
  api.post.mockResolvedValue({ ok: true, unreadTotal: 0 });
  api.del.mockResolvedValue({ ok: true, unreadTotal: 0 });
  confirmDialog.mockResolvedValue(true);
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('topbar bell badge', () => {
  it('paints the unread count on the bell, caps it and hides it at zero', () => {
    updateNotificationsBadge(3);
    expect(state.notificationsUnread).toBe(3);
    expect(NOTIF_BADGE().textContent).toBe('۳');
    expect(NOTIF_BADGE().hidden).toBe(false);
    expect(NOTIF_BTN().classList.contains('has-unread')).toBe(true);
    expect(NOTIF_BTN().getAttribute('aria-label')).toContain('۳ خوانده‌نشده');

    updateNotificationsBadge(120);
    expect(NOTIF_BADGE().textContent).toBe('۹۹+');

    updateNotificationsBadge(0);
    expect(state.notificationsUnread).toBe(0);
    expect(NOTIF_BADGE().textContent).toBe('');
    expect(NOTIF_BADGE().hidden).toBe(true);
    expect(NOTIF_BTN().classList.contains('has-unread')).toBe(false);
    expect(NOTIF_BTN().getAttribute('aria-label')).toBe('اعلان‌ها');
  });

  it('refreshes from the unread endpoint only for a signed-in user', async () => {
    expect(await refreshNotificationsBadge()).toBe(0);
    expect(api.get).not.toHaveBeenCalled();

    setUser({ id: 1, role: 'student', displayName: 'دانش‌آموز', persianDigits: true });
    api.get.mockResolvedValue({ count: 4, latest: null });
    const count = await refreshNotificationsBadge();
    expect(api.get).toHaveBeenCalledWith('/notifications/unread');
    expect(count).toBe(4);
    expect(NOTIF_BADGE().textContent).toBe('۴');
  });

  it('does not treat the backlog on first load as a new notification', async () => {
    setUser({ id: 1, role: 'student', displayName: 'دانش‌آموز', persianDigits: true });
    api.get.mockResolvedValue({ count: 1, latest: { id: 10, title: 'قدیمی', body: 'متن' } });
    await refreshNotificationsBadge();
    expect(notify.info).not.toHaveBeenCalled();

    api.get.mockResolvedValue({ count: 2, latest: { id: 11, title: 'تازه', body: 'متن' } });
    await refreshNotificationsBadge();
    expect(notify.info).toHaveBeenCalledTimes(1);
    expect(notify.info.mock.calls[0][0]).toContain('تازه');
  });

  it('starts and stops the polling loop cleanly', async () => {
    vi.useFakeTimers();
    setUser({ id: 1, role: 'teacher', displayName: 'معلم', persianDigits: true });
    api.get.mockResolvedValue({ count: 2, latest: null });

    const stop = startNotificationPolling({ intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(api.get).toHaveBeenCalled();

    const before = api.get.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.get.mock.calls.length).toBeGreaterThan(before);

    stop();
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });
});

describe('browser notification preference', () => {
  it('reports unsupported and never enables without the API', async () => {
    const original = window.Notification;
    delete window.Notification;
    expect(canUseDesktopNotifications()).toBe(false);
    expect(await requestDesktopNotifications()).toBe('unsupported');
    if (original) window.Notification = original;
  });

  it('stores the opt-in once the browser grants permission', async () => {
    class FakeNotification {
      static permission = 'default';
      static requestPermission = vi.fn(async () => 'granted');
      constructor(title, options) {
        this.title = title;
        this.options = options;
      }
      close() {}
    }
    const original = window.Notification;
    window.Notification = FakeNotification;

    expect(desktopNotificationsEnabled()).toBe(false);
    expect(await requestDesktopNotifications()).toBe('granted');
    expect(FakeNotification.requestPermission).toHaveBeenCalled();
    expect(desktopNotificationsEnabled()).toBe(true);

    setDesktopNotificationsEnabled(false);
    expect(desktopNotificationsEnabled()).toBe(false);

    if (original) window.Notification = original;
    else delete window.Notification;
  });
});

describe('inbox view', () => {
  function inboxApi(unreadTotal = 1) {
    api.get.mockImplementation((path) => {
      if (path === '/notifications/unread') return Promise.resolve({ count: unreadTotal, latest: null });
      return Promise.resolve({ items: INBOX_ITEMS, total: INBOX_ITEMS.length, page: 1, unreadTotal });
    });
  }

  it('shows a student the notices with no compose action', async () => {
    setUser({ id: 2, role: 'student', displayName: 'دانش‌آموز', persianDigits: true });
    inboxApi();

    renderNotifications();
    await vi.waitFor(() => expect(document.querySelectorAll('#view .notif')).toHaveLength(2));

    expect(COMPOSE_LINK()).toBeNull();
    expect(ADMIN_COMPOSE_LINK()).toBeNull();
    expect(document.querySelector('#view .notif.is-unread')).not.toBeNull();
    expect(document.querySelector('#view').textContent).toContain('تعطیلی فردا');
  });

  it('gives a plain teacher a compose link to the teacher form', async () => {
    setUser({ id: 1, role: 'teacher', displayName: 'معلم', persianDigits: true });
    inboxApi();
    renderNotifications();
    await vi.waitFor(() => expect(COMPOSE_LINK()).not.toBeNull());
    expect(ADMIN_COMPOSE_LINK()).toBeNull();
  });

  it('gives the admin the site-wide broadcast form', async () => {
    setUser({ id: 9, role: 'admin', displayName: 'مدیر', persianDigits: true });
    inboxApi();
    renderNotifications();
    await vi.waitFor(() => expect(ADMIN_COMPOSE_LINK()).not.toBeNull());
    expect(COMPOSE_LINK()).toBeNull();
    expect(document.querySelector('#view').textContent).toContain('ارسال اعلان همگانی');
  });

  it('hides compose from an assistant without the notifications permission', async () => {
    setUser({
      id: 3,
      role: 'teacher',
      displayName: 'همیار',
      persianDigits: true,
      assistant: { leagueId: 5, permissions: [] },
    });
    inboxApi();
    renderNotifications();
    await vi.waitFor(() => expect(document.querySelectorAll('#view .notif')).toHaveLength(2));
    expect(COMPOSE_LINK()).toBeNull();
  });

  it('lets an assistant compose when the notifications permission is granted', async () => {
    setUser({
      id: 3,
      role: 'teacher',
      displayName: 'همیار',
      persianDigits: true,
      assistant: { leagueId: 5, permissions: ['notifications'] },
    });
    inboxApi();
    renderNotifications();
    await vi.waitFor(() => expect(COMPOSE_LINK()).not.toBeNull());
  });

  it('marks one notice read and updates the bell', async () => {
    setUser({ id: 2, role: 'student', displayName: 'دانش‌آموز', persianDigits: true });
    inboxApi(1);
    api.post.mockResolvedValue({ ok: true, unreadTotal: 0 });

    renderNotifications();
    await vi.waitFor(() => expect(document.querySelectorAll('#view .notif')).toHaveLength(2));

    clickButton(document.querySelector('#view'), 'خواندم');
    await vi.waitFor(() => expect(api.post).toHaveBeenCalledWith('/notifications/2/read'));
    await vi.waitFor(() => expect(NOTIF_BADGE().hidden).toBe(true));
  });

  it('opens a linked notice without marking an already-read one again', async () => {
    setUser({ id: 2, role: 'student', displayName: 'دانش‌آموز', persianDigits: true });
    inboxApi(0);
    renderNotifications();
    await vi.waitFor(() => expect(document.querySelectorAll('#view .notif')).toHaveLength(2));

    clickButton(document.querySelectorAll('#view .notif')[1], 'مشاهده');
    expect(window.location.hash).toBe('#/teacher/league/1/homework');
    expect(api.post).not.toHaveBeenCalledWith('/notifications/1/read');
  });

  it('removes only the user copy after confirmation', async () => {
    setUser({ id: 2, role: 'student', displayName: 'دانش‌آموز', persianDigits: true });
    inboxApi(2);
    renderNotifications();
    await vi.waitFor(() => expect(document.querySelectorAll('#view .notif')).toHaveLength(2));

    clickButton(document.querySelectorAll('#view .notif')[0], 'حذف');
    await vi.waitFor(() => expect(confirmDialog).toHaveBeenCalled());
    await vi.waitFor(() => expect(api.del).toHaveBeenCalledWith('/notifications/2'));
    await vi.waitFor(() => expect(document.querySelectorAll('#view .notif')).toHaveLength(1));
    expect(notify.ok).toHaveBeenCalledWith('اعلان حذف شد');
  });

  it('marks every notice read and re-loads the inbox', async () => {
    setUser({ id: 2, role: 'student', displayName: 'دانش‌آموز', persianDigits: true });
    inboxApi(2);
    renderNotifications();
    await vi.waitFor(() => expect(document.querySelectorAll('#view .notif')).toHaveLength(2));

    clickButton(document.querySelector('#view'), 'خواندن همه');
    await vi.waitFor(() => expect(api.post).toHaveBeenCalledWith('/notifications/read-all'));
    expect(NOTIF_BADGE().hidden).toBe(true);
  });
});

describe('compose view', () => {
  const STUDENTS = [
    { id: 11, name: 'علی', hasLogin: true, hasParentPhone: true },
    { id: 12, name: 'سارا', hasLogin: false, hasParentPhone: false },
  ];

  it('sends a league notice with the teacher payload', async () => {
    setUser({ id: 1, role: 'teacher', displayName: 'معلم', persianDigits: true });
    setLeagueId(12);
    api.get.mockImplementation((path) => {
      if (path === '/leagues/12/notifications/audience') {
        return Promise.resolve({ students: STUDENTS, counts: { students: 2, withLogin: 1, withParentPhone: 1 } });
      }
      if (path === '/leagues/12/notifications') return Promise.resolve({ items: [] });
      return Promise.resolve({ count: 0, latest: null });
    });
    api.post.mockResolvedValue({ notification: { id: 1 }, recipients: { accounts: 1, students: 2, parents: 1 }, sms: null });

    renderNotificationsCompose();
    await vi.waitFor(() => expect(document.querySelector('#view .notif-picker')).not.toBeNull());

    document.querySelector('#view .notif-form').querySelector('#notif-title').value = 'آزمون فردا';
    document.querySelector('#view .notif-form').querySelector('#notif-body').value = 'فردا آزمون فصل سوم است';
    const form = document.querySelector('#view .notif-form');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await vi.waitFor(() => expect(api.post).toHaveBeenCalled());
    const [path, payload] = api.post.mock.calls[0];
    expect(path).toBe('/leagues/12/notifications');
    expect(payload).toMatchObject({
      title: 'آزمون فردا',
      body: 'فردا آزمون فصل سوم است',
      audience: 'all',
      sendSms: false,
    });
    expect(payload.studentIds).toEqual([]);
    expect(document.querySelector('#view .notif-status__ok')).not.toBeNull();
  });

  it('refuses a selected audience with no student picked', async () => {
    setUser({ id: 1, role: 'teacher', displayName: 'معلم', persianDigits: true });
    setLeagueId(12);
    api.get.mockImplementation((path) => {
      if (path === '/leagues/12/notifications/audience') {
        return Promise.resolve({ students: STUDENTS, counts: { students: 2, withLogin: 1, withParentPhone: 1 } });
      }
      return Promise.resolve({ items: [] });
    });

    renderNotificationsCompose();
    await vi.waitFor(() => expect(document.querySelector('#view .notif-picker')).not.toBeNull());

    const form = document.querySelector('#view .notif-form');
    form.querySelector('#notif-title').value = 'عنوان معتبر';
    form.querySelector('#notif-body').value = 'متن معتبر';
    const selectedRadio = [...form.querySelectorAll('input[type="radio"]')]
      .find((input) => input.value === 'selected');
    selectedRadio.click();

    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(notify.error).toHaveBeenCalledWith('حداقل یک دانش‌آموز انتخاب کنید'));
    expect(api.post).not.toHaveBeenCalled();
  });

  it('sends an admin broadcast without needing a league', async () => {
    setUser({ id: 9, role: 'admin', displayName: 'مدیر سامانه', persianDigits: true });
    api.get.mockImplementation((path) => {
      if (path === '/admin/notifications') return Promise.resolve({ items: [] });
      return Promise.resolve({ count: 0, latest: null });
    });
    api.post.mockResolvedValue({ recipients: { users: 4 }, notification: { id: 5 } });

    renderNotificationsCompose();
    const form = document.querySelector('#view .notif-form');
    form.querySelector('#notif-title').value = 'اطلاعیه سایت';
    form.querySelector('#notif-body').value = 'نسخه جدید منتشر شد';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await vi.waitFor(() => expect(api.post).toHaveBeenCalled());
    const [path, payload] = api.post.mock.calls[0];
    expect(path).toBe('/admin/notifications');
    expect(payload).toMatchObject({ title: 'اطلاعیه سایت', audience: 'all' });
    expect(payload.studentIds).toBeUndefined();
  });

  it('asks the teacher to open a league before composing', async () => {
    setUser({ id: 1, role: 'teacher', displayName: 'معلم', persianDigits: true });
    setLeagueId(null);
    renderNotificationsCompose();
    await vi.waitFor(() => expect(document.querySelector('#view .empty')).not.toBeNull());
    expect(document.querySelector('#view').textContent).toContain('ابتدا یک لیگ را باز کنید');
    expect(document.querySelector('#view .notif-form')).toBeNull();
  });
});
