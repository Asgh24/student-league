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

const { api, register } = await import('../public/js/api.js');
const { renderLogin } = await import('../public/js/views/login.js');
const { renderSubscription } = await import('../public/js/views/subscription.js');
const { renderAdminDashboard } = await import('../public/js/views/admin/dashboard.js');
const { renderAdminTeachers } = await import('../public/js/views/admin/teachers.js');
const { renderTeacherMessages } = await import('../public/js/views/messages.js');
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
    expect(document.getElementById('login-display-name').required).toBe(true);

    document.getElementById('login-display-name').value = 'خانم جدید';
    document.getElementById('login-username').value = 'new-teacher';
    document.getElementById('login-password').value = 'new-password-1';
    document.getElementById('login-confirm').value = 'new-password-1';
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

describe('settings', () => {
  it('labels the admin role correctly', () => {
    setUser({ id: 1, role: 'admin', username: 'owner', displayName: 'مدیر سامانه', persianDigits: true });
    renderSettings();
    expect(document.body.textContent).toContain('مدیر سامانه');
    expect(document.body.textContent).toContain('تغییر گذرواژه');
  });
});
