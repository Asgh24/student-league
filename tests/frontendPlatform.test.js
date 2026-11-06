// @vitest-environment jsdom
/**
 * Frontend smoke tests for the multi-teacher platform: teacher signup, the
 * subscription storefront, the admin panel, the shared inbox and the credits
 * footer. The API module is mocked so these run without a server.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

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
  return {
    api,
    ApiError: class ApiError extends Error {},
    setCsrfToken: vi.fn(),
    getCsrfToken: () => null,
    refreshCsrf: vi.fn(async () => 'csrf-test'),
    meta: vi.fn(async () => ({})),
    me: vi.fn(async () => ({ user: null })),
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
  };
});

const { api, login, register } = await import('../public/js/api.js');
const { renderLogin } = await import('../public/js/views/login.js');
const { renderSubscription } = await import('../public/js/views/subscription.js');
const { renderAdminDashboard } = await import('../public/js/views/admin/dashboard.js');
const { renderAdminExpiredUsers } = await import('../public/js/views/admin/expiredUsers.js');
const { renderAdminTeachers } = await import('../public/js/views/admin/teachers.js');
const { renderFiles } = await import('../public/js/views/files.js');
const { renderTeacherMessages } = await import('../public/js/views/messages.js');
const { renderSupport } = await import('../public/js/views/support.js');
const { renderAdminSupport } = await import('../public/js/views/admin/support.js');
const { renderSettings } = await import('../public/js/views/settings.js');
const { setMeta, setPersianDigits, setUser } = await import('../public/js/store.js');

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shellHtml = fs.readFileSync(path.join(rootDir, 'public', 'index.html'), 'utf8');

function installShellSkeleton() {
  document.body.innerHTML = `
    <header class="topbar" id="topbar" hidden>
      <button class="icon-btn" id="menu-btn" type="button"></button>
      <span class="topbar__title" id="topbar-title"></span>
      <span class="spacer"></span>
      <button class="pill" id="league-pill" hidden></button>
      <span class="pill pill--user" id="user-pill" hidden></span>
    </header>
    <div class="scrim" id="scrim" hidden></div>
    <aside class="drawer" id="drawer">
      <div class="drawer__head"><strong id="drawer-title"></strong><button id="drawer-close"></button></div>
      <nav class="drawer__nav" id="drawer-nav"></nav>
      <div class="drawer__foot" id="drawer-foot"></div>
    </aside>
    <main class="view" id="view" tabindex="-1"></main>
    <footer class="site-footer">
      <p class="site-footer__credit">تهیه‌کنندگان: محمدجواد ابراهیمی - علی طاهری</p>
      <p class="site-footer__copy">© ۱۴۰۵ لیگ جامع دانش‌آموزی — تمامی حقوق محفوظ است.</p>
    </footer>
    <div class="toasts" id="toasts"></div>
    <div id="modal-root"></div>
  `;
}

function daysFromNow(days) {
  return new Date(Date.now() + days * 86400000).toISOString();
}

beforeEach(() => {
  vi.clearAllMocks();
  installShellSkeleton();
  window.location.hash = '';
  setUser(null);
  setPersianDigits(true);
  setMeta({ appName: 'لیگ جامع دانش‌آموزی', trialDays: 14 });
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('credits footer', () => {
  it('contains the exact credits and a copyright notice', () => {
    expect(shellHtml).toContain('تهیه‌کنندگان: محمدجواد ابراهیمی - علی طاهری');
    expect(shellHtml).toContain('تمامی حقوق محفوظ است');
    expect(shellHtml).toContain('class="site-footer"');
  });
});

describe('login form', () => {
  it('keeps the login inputs visible and submits them', async () => {
    login.mockResolvedValueOnce({
      user: { id: 1, role: 'teacher', username: 'teacher', displayName: 'معلم نمونه', subscription: { status: 'active' } },
      csrfToken: 'csrf-test',
    });
    const navigate = vi.fn();
    renderLogin({ navigate });

    const username = document.getElementById('login-username');
    const password = document.getElementById('login-password');
    // Regression: the login and signup panels used to share the same nodes,
    // which moved them into the hidden signup panel and left the inputs invisible.
    expect(username).toBeTruthy();
    expect(password).toBeTruthy();
    expect(username.closest('[hidden]')).toBeNull();
    expect(password.closest('[hidden]')).toBeNull();

    username.value = 'teacher';
    password.value = 'teacher1234';
    document.querySelector('form.login-card').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await vi.waitFor(() => expect(login).toHaveBeenCalledWith('teacher', 'teacher1234'));
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('teacher'));
  });
});

describe('teacher signup', () => {
  it('shows the 14-day demo notice and starts a session after registration', async () => {
    register.mockResolvedValueOnce({
      user: { id: 9, role: 'teacher', username: 'new-teacher', displayName: 'خانم جدید', subscription: { status: 'trial' } },
      trialDays: 14,
    });
    const navigate = vi.fn();
    renderLogin({ navigate });
    expect(document.body.textContent).toContain('۱۴ روز استفادهٔ آزمایشی رایگان');

    const tabs = [...document.querySelectorAll('.tab')];
    tabs.find((tab) => tab.textContent.includes('ثبت‌نام معلم')).click();
    expect(document.getElementById('signup-display-name').required).toBe(true);

    document.getElementById('signup-display-name').value = 'خانم جدید';
    document.getElementById('signup-username').value = 'new-teacher';
    document.getElementById('signup-password').value = 'new-password-1';
    document.getElementById('signup-confirm').value = 'new-password-1';
    document.querySelector('form.login-card').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await vi.waitFor(() => expect(register).toHaveBeenCalledWith('خانم جدید', 'new-teacher', 'new-password-1'));
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('teacher'));
  });
});

describe('subscription storefront', () => {
  it('renders the trial banner, plans and payment history', async () => {
    api.get.mockResolvedValueOnce({
      subscription: { status: 'trial', daysLeft: 7, endsAt: daysFromNow(7) },
      plans: [
        { id: 1, name: 'اشتراک یک‌ماهه', days: 30, price: 149000, description: 'مناسب شروع', active: true, sortOrder: 1 },
        { id: 2, name: 'اشتراک سه‌ماهه', days: 90, price: 399000, description: 'محبوب', active: true, sortOrder: 2 },
      ],
      paymentProvider: { provider: 'mock', configured: true, label: 'پرداخت آزمایشی', sandbox: true },
      payments: [{
        id: 4,
        planName: 'اشتراک یک‌ماهه',
        amount: 149000,
        status: 'paid',
        provider: 'mock',
        refId: 'MOCK-4',
        createdAt: daysFromNow(-1),
      }],
      trialDays: 14,
    });

    await renderSubscription({ query: new URLSearchParams() });

    const text = document.body.textContent;
    expect(text).toContain('دورهٔ آزمایشی');
    expect(text).toContain('اشتراک یک‌ماهه');
    expect(text).toContain('اشتراک سه‌ماهه');
    expect(text).toContain('حالت پرداخت آزمایشی فعال است');
    expect(text).toContain('MOCK-4');
    expect([...document.querySelectorAll('.plan-card')]).toHaveLength(2);
  });
});

describe('admin panel', () => {
  it('renders the owner dashboard statistics', async () => {
    api.get.mockResolvedValueOnce({
      teachers: { total: 12, active: 5, trial: 4, expired: 3, unlimited: 0, activeTotal: 5 },
      revenue: { total: 1200000, count: 8, last30Days: 500000, last30Count: 3 },
      payments: { pending: 1 },
      leagues: 14,
      students: 210,
      messages: { threads: 9, messages: 42 },
      sms: { outbox: { queued: 2, sent: 8, failed: 1 }, campaigns: { queued: 0, sent: 3, failed: 0 }, config: { configured: false, lineNumber: '' } },
      plans: { total: 3, active: 3 },
      recentPayments: [{ id: 1, teacherName: 'خانم الف', status: 'paid', planName: 'ماهانه', amount: 149000, createdAt: daysFromNow(-1), provider: 'mock' }],
      trialDays: 14,
      paymentProvider: 'mock',
    });

    await renderAdminDashboard();

    const text = document.body.textContent;
    expect(text).toContain('پنل مدیر سامانه');
    expect(text).toContain('کل معلمان');
    expect(text).toContain('خانم الف');
    expect(text).toContain('sms.ir هنوز پیکربندی نشده است');
  });

  it('lists teachers with subscription state and renewal action', async () => {
    api.get.mockResolvedValueOnce({
      items: [{
        id: 3,
        username: 'teacher-a',
        displayName: 'خانم الف',
        role: 'teacher',
        trialEndsAt: daysFromNow(5),
        subscriptionEndsAt: null,
        subscription: { status: 'trial', daysLeft: 5, active: true },
        leagueCount: 1,
        studentCount: 22,
        lastPaidAt: null,
        createdAt: daysFromNow(-9),
      }],
      total: 1,
      counts: { total: 1, activeTotal: 0, trial: 1, expired: 0 },
    });

    await renderAdminTeachers();

    const text = document.body.textContent;
    expect(text).toContain('خانم الف');
    expect(text).toContain('دورهٔ آزمایشی');
    expect(text).toContain('تمدید دستی');
    expect(text).toContain('۲۲ دانش‌آموز');
  });

  it('renders expired users with storage usage and a guarded delete action', async () => {
    api.get.mockResolvedValueOnce({
      items: [{
        id: 7,
        username: 'expired-a',
        displayName: 'معلم منقضی',
        role: 'teacher',
        trialEndsAt: daysFromNow(-4),
        subscriptionEndsAt: null,
        subscription: { status: 'expired', daysLeft: 0, active: false, endsAt: daysFromNow(-4) },
        leagueCount: 2,
        studentCount: 31,
        fileCount: 3,
        storage: { usedBytes: 5 * 1024 * 1024, limitBytes: 70 * 1024 * 1024, remainingBytes: 65 * 1024 * 1024 },
        lastPaidAt: null,
        createdAt: daysFromNow(-40),
      }],
      total: 1,
    });

    await renderAdminExpiredUsers();

    const text = document.body.textContent;
    expect(text).toContain('حذف کاربران منقضی');
    expect(text).toContain('معلم منقضی');
    expect(text).toContain('اشتراک منقضی');
    expect(text).toContain('۳ فایل');
    expect(text).toContain('حذف حساب');
    expect(text).toContain('حذف حساب دائمی است');
  });
});

describe('teacher file storage', () => {
  it('shows total usage, remaining space and the per-file limit', async () => {
    api.get.mockImplementation(async (url) => {
      if (url.endsWith('/files')) {
        return {
          items: [],
          limits: { maxBytes: 10 * 1024 * 1024, extensions: ['.pdf'] },
          storage: {
            usedBytes: 60 * 1024 * 1024,
            limitBytes: 70 * 1024 * 1024,
            remainingBytes: 10 * 1024 * 1024,
          },
        };
      }
      return { league: { name: 'لیگ الف' } };
    });

    await renderFiles({ params: { id: '1' } });

    const text = document.body.textContent;
    expect(text).toContain('فضای ذخیره‌سازی');
    expect(text).toContain('۶۰ مگابایت از ۷۰ مگابایت استفاده شده');
    expect(text).toContain('۱۰ مگابایت باقی‌مانده');
    expect(text).toContain('حداکثر حجم هر فایل');
    expect(text).toContain('پسوندهای مجاز: .pdf');
  });
});

describe('shared inbox', () => {
  it('opens a thread, shows unread state and the composer', async () => {
    const thread = {
      id: 5,
      participantName: 'آرش آزمون',
      subject: '',
      unread: 1,
      lastMessage: { body: 'سلام، یک سؤال دارم', at: daysFromNow(-1), senderRole: 'student' },
    };
    api.get.mockImplementation(async (url) => {
      if (url === '/messages/threads') return { items: [thread], unreadTotal: 1 };
      if (url === '/messages/threads/5') {
        return {
          thread: { ...thread, unread: 0 },
          messages: [{
            id: 11,
            body: 'سلام، یک سؤال دارم',
            senderRole: 'student',
            senderName: 'آرش آزمون',
            createdAt: daysFromNow(-1),
            mine: false,
            readAt: daysFromNow(-1),
          }],
          unreadTotal: 0,
        };
      }
      if (url === '/messages/contacts') return { items: [], role: 'teacher' };
      throw new Error(`unexpected ${url}`);
    });

    await renderTeacherMessages();
    expect(document.body.textContent).toContain('آرش آزمون');
    expect(document.querySelector('.inbox__unread').textContent).toBe('۱');

    document.querySelector('.inbox__item').click();
    await vi.waitFor(() => expect(document.body.textContent).toContain('سلام، یک سؤال دارم'));
    expect(document.querySelector('#chat-message')).not.toBeNull();
    expect(document.body.textContent).toContain('ارسال');
  });
});

describe('user support inbox', () => {
  const thread = {
    id: 3,
    participantName: 'پشتیبانی سایت',
    subject: 'مشکل در پرداخت',
    status: 'answered',
    unread: 1,
    userId: 42,
    username: 'teacher-a',
    userName: 'خانم الف',
    userRole: 'teacher',
    lastMessage: { body: 'سلام، بررسی شد و فعال شد', at: daysFromNow(-1), senderRole: 'admin' },
  };

  function mockSupportApi() {
    api.get.mockImplementation(async (url) => {
      if (url === '/support/threads') return { items: [thread], unreadTotal: 1 };
      if (url === '/support/threads/3') {
        return {
          thread: { ...thread, unread: 0 },
          messages: [
            {
              id: 11, body: 'سلام، اشتراکم فعال نشده است', senderRole: 'user',
              senderName: 'خانم الف', createdAt: daysFromNow(-2), mine: true, readAt: daysFromNow(-2),
            },
            {
              id: 12, body: 'سلام، بررسی شد و فعال شد', senderRole: 'admin',
              senderName: 'مدیر سامانه', createdAt: daysFromNow(-1), mine: false, readAt: daysFromNow(-1),
            },
          ],
          unreadTotal: 0,
        };
      }
      throw new Error(`unexpected ${url}`);
    });
  }

  it('lists own tickets with status and unread badge, then opens one', async () => {
    mockSupportApi();
    await renderSupport();
    expect(api.get).toHaveBeenCalledWith('/support/threads');
    expect(document.body.textContent).toContain('مشکل در پرداخت');
    expect(document.body.textContent).toContain('پاسخ داده شد');
    expect(document.querySelector('.inbox__unread').textContent).toBe('۱');

    document.querySelector('.inbox__item').click();
    await vi.waitFor(() => expect(document.body.textContent).toContain('سلام، اشتراکم فعال نشده است'));
    const chat = document.querySelector('.inbox__chat');
    expect(chat.textContent).toContain('پشتیبانی سایت');
    expect(chat.textContent).toContain('سلام، بررسی شد و فعال شد');
    expect(chat.textContent).toContain('مدیر سامانه');
    expect(chat.querySelector('.bubble--mine')).not.toBeNull();
    expect(document.querySelector('#chat-message')).not.toBeNull();
  });

  it('shows the empty state when the user has no tickets', async () => {
    api.get.mockResolvedValue({ items: [], unreadTotal: 0 });
    await renderSupport();
    const list = document.querySelector('.inbox__list');
    expect(list.textContent).toContain('هنوز پیامی به پشتیبانی نفرستاده‌اید');
  });

  it('disables the composer when the ticket is closed', async () => {
    api.get.mockImplementation(async (url) => {
      if (url === '/support/threads') return { items: [{ ...thread, status: 'closed' }], unreadTotal: 0 };
      if (url === '/support/threads/3') {
        return { thread: { ...thread, status: 'closed', unread: 0 }, messages: [], unreadTotal: 0 };
      }
      throw new Error(`unexpected ${url}`);
    });
    await renderSupport();
    document.querySelector('.inbox__item').click();
    await vi.waitFor(() => expect(document.querySelector('#chat-message')).not.toBeNull());
    expect(document.querySelector('#chat-message').disabled).toBe(true);
    expect(document.querySelector('.composer [type=submit]').disabled).toBe(true);
  });

  it('sends a follow-up message through the composer', async () => {
    mockSupportApi();
    api.post.mockResolvedValue({
      message: { id: 13, body: 'ممنون، درست شد', senderRole: 'user', senderName: 'خانم الف', createdAt: daysFromNow(0), mine: true, readAt: null },
      thread: { ...thread, status: 'open', unread: 0 },
    });
    await renderSupport();
    document.querySelector('.inbox__item').click();
    await vi.waitFor(() => expect(document.querySelector('#chat-message')).not.toBeNull());

    const composer = document.querySelector('#chat-message');
    composer.value = 'ممنون، درست شد';
    document.querySelector('.composer').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(api.post).toHaveBeenCalledWith('/support/threads/3/messages', { body: 'ممنون، درست شد' }));
    await vi.waitFor(() => expect(document.querySelector('.inbox__chat').textContent).toContain('ممنون، درست شد'));
  });
});

describe('admin support inbox', () => {
  const thread = {
    id: 3,
    participantName: 'خانم الف',
    subject: 'مشکل در پرداخت',
    status: 'open',
    unread: 1,
    userId: 42,
    username: 'teacher-a',
    userName: 'خانم الف',
    userRole: 'teacher',
    lastMessage: { body: 'سلام، اشتراکم فعال نشده است', at: daysFromNow(-1), senderRole: 'user' },
  };

  function mockAdminApi() {
    api.get.mockImplementation(async (url) => {
      if (url === '/admin/support/threads') return { items: [thread], unreadTotal: 1 };
      if (url === '/admin/support/threads/3') {
        return {
          thread: { ...thread, unread: 0 },
          messages: [{
            id: 11, body: 'سلام، اشتراکم فعال نشده است', senderRole: 'user',
            senderName: 'خانم الف', createdAt: daysFromNow(-1), mine: false, readAt: daysFromNow(-1),
          }],
          unreadTotal: 0,
        };
      }
      throw new Error(`unexpected ${url}`);
    });
  }

  it('lists tickets with the user identity and opens one', async () => {
    mockAdminApi();
    await renderAdminSupport();
    expect(api.get).toHaveBeenCalledWith('/admin/support/threads');
    expect(document.body.textContent).toContain('خانم الف');
    expect(document.body.textContent).toContain('teacher-a');
    expect(document.body.textContent).toContain('معلم');
    expect(document.querySelector('.inbox__unread').textContent).toBe('۱');

    document.querySelector('.inbox__item').click();
    await vi.waitFor(() => expect(document.body.textContent).toContain('سلام، اشتراکم فعال نشده است'));
    const chat = document.querySelector('.inbox__chat');
    expect(chat.textContent).toContain('خانم الف');
    expect(chat.textContent).toContain('وضعیت تیکت:');
    expect(chat.querySelectorAll('.row button')).toHaveLength(3);
    expect(document.querySelector('#chat-message')).not.toBeNull();
  });

  it('shows the empty state when there are no tickets', async () => {
    api.get.mockResolvedValue({ items: [], unreadTotal: 0 });
    await renderAdminSupport();
    expect(document.body.textContent).toContain('هنوز پیامی به پشتیبانی ارسال نشده است');
  });

  it('replies to the user from the composer', async () => {
    mockAdminApi();
    api.post.mockResolvedValue({
      message: { id: 12, body: 'پاسخ مدیر', senderRole: 'admin', senderName: 'مدیر سامانه', createdAt: daysFromNow(0), mine: true, readAt: null },
      thread: { ...thread, status: 'answered', unread: 0 },
    });
    await renderAdminSupport();
    document.querySelector('.inbox__item').click();
    await vi.waitFor(() => expect(document.querySelector('#chat-message')).not.toBeNull());

    const composer = document.querySelector('#chat-message');
    composer.value = 'پاسخ مدیر';
    document.querySelector('.composer').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(api.post).toHaveBeenCalledWith('/admin/support/threads/3/messages', { body: 'پاسخ مدیر' }));
  });

  it('changes the ticket status from the status buttons', async () => {
    mockAdminApi();
    api.patch.mockResolvedValue({ thread: { ...thread, status: 'closed', unread: 0 } });
    await renderAdminSupport();
    document.querySelector('.inbox__item').click();
    await vi.waitFor(() => expect(document.querySelector('#chat-message')).not.toBeNull());

    const buttons = [...document.querySelectorAll('.row button')];
    buttons.find((button) => button.textContent.trim() === 'بسته').click();
    await vi.waitFor(() => expect(api.patch).toHaveBeenCalledWith('/admin/support/threads/3/status', { status: 'closed' }));
    await vi.waitFor(() => expect(document.querySelector('.inbox__chat').textContent).toContain('بسته'));
  });
});

describe('settings', () => {
  it('labels the admin role correctly', () => {
    setUser({ id: 1, role: 'admin', username: 'owner', displayName: 'مدیر سامانه', persianDigits: true });
    renderSettings();
    expect(document.body.textContent).toContain('مدیر سامانه');
    expect(document.body.textContent).toContain('تغییر گذرواژه');
  });
});
