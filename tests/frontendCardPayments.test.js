// @vitest-environment jsdom
/**
 * Frontend card-to-card flows: card details for teachers, the receipt modal,
 * admin card settings and the review queue with its numeric badge.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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

const { api } = await import('../public/js/api.js');
const { renderSubscription } = await import('../public/js/views/subscription.js');
const { renderAdminPaymentSettings } = await import('../public/js/views/admin/paymentSettings.js');
const { renderAdminPayments } = await import('../public/js/views/admin/payments.js');
const { adminTabs } = await import('../public/js/views/admin/common.js');
const { setAdminPendingPayments, setMeta, setPersianDigits, setUser } = await import('../public/js/store.js');

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shellHtml = fs.readFileSync(path.join(rootDir, 'public', 'index.html'), 'utf8');

const CARD = {
  cardNumber: '6037123456789012',
  cardHolder: 'سارا صاحب کارت',
  bankName: 'بانک ملی',
  instructions: 'شماره پیگیری را در متن رسید بنویسید.',
  configured: true,
};

const PLAN = { id: 1, name: 'اشتراک یک‌ماهه', days: 30, price: 149000, description: 'مناسب شروع', active: true, sortOrder: 1 };

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
    <div class="toasts" id="toasts"></div>
    <div id="modal-root"></div>
  `;
}

function subscriptionPayload(overrides = {}) {
  return {
    subscription: { status: 'trial', daysLeft: 7, endsAt: new Date(Date.now() + 7 * 86400000).toISOString() },
    plans: [PLAN],
    paymentProvider: { provider: 'card', configured: true, label: 'کارت به کارت', card: CARD },
    receiptMaxBytes: 5 * 1024 * 1024,
    payments: [],
    trialDays: 14,
    ...overrides,
  };
}

function buttonByText(text) {
  return [...document.querySelectorAll('button')].find((node) => node.textContent.includes(text));
}

beforeEach(() => {
  vi.clearAllMocks();
  installShellSkeleton();
  window.location.hash = '';
  setUser(null);
  setPersianDigits(true);
  setAdminPendingPayments(0);
  setMeta({ appName: 'لیگ جامع دانش‌آموزی', trialDays: 14 });
  expect(shellHtml).toContain('لیگ جامع دانش‌آموزی');
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('teacher card-to-card storefront', () => {
  it('shows the destination card and submits a text receipt from the modal', async () => {
    api.get.mockResolvedValue(subscriptionPayload());
    api.upload.mockResolvedValue({ message: 'رسید ثبت شد' });

    await renderSubscription({ query: new URLSearchParams() });

    const text = document.body.textContent;
    expect(text).toContain('اطلاعات کارت مقصد');
    expect(text).toContain('6037 1234 5678 9012');
    expect(text).toContain(CARD.cardHolder);
    expect(text).toContain('پرداخت کارت به کارت');
    expect(text).toContain(CARD.instructions);

    buttonByText('پرداخت کارت به کارت').click();
    expect(document.getElementById('modal-root').textContent).toContain('ثبت رسید کارت به کارت');

    document.getElementById('receipt-text').value = 'پیگیری ۱۲۳۴۵۶';
    buttonByText('ارسال رسید').click();

    await vi.waitFor(() => expect(api.upload).toHaveBeenCalledTimes(1));
    const [url, form] = api.upload.mock.calls[0];
    expect(url).toBe('/subscription/card-checkout');
    expect(form.get('planId')).toBe('1');
    expect(form.get('receiptText')).toBe('پیگیری ۱۲۳۴۵۶');
    await vi.waitFor(() => expect(document.getElementById('modal-root').textContent).not.toContain('ثبت رسید کارت به کارت'));
  });

  it('disables new purchases while a card receipt is waiting for review', async () => {
    api.get.mockResolvedValue(subscriptionPayload({
      payments: [{
        id: 8,
        planName: PLAN.name,
        amount: PLAN.price,
        days: PLAN.days,
        status: 'pending',
        provider: 'card',
        receiptText: 'پیگیری ۹۹',
        hasReceiptImage: true,
        createdAt: new Date().toISOString(),
      }],
    }));

    await renderSubscription({ query: new URLSearchParams() });

    expect(document.body.textContent).toContain('در انتظار تأیید مدیر');
    expect(document.body.textContent).toContain('پیگیری ۹۹');
    const buy = buttonByText('رسید در انتظار بررسی');
    expect(buy).toBeTruthy();
    expect(buy.disabled).toBe(true);
    expect(buttonByText('لغو این رسید')).toBeTruthy();
    expect(document.querySelector('a[href="/api/v1/subscription/payments/8/receipt"]')).toBeTruthy();
  });

  it('does not offer paid plans to an unlimited account', async () => {
    api.get.mockResolvedValue(subscriptionPayload({
      subscription: { status: 'unlimited', daysLeft: null, endsAt: null },
    }));

    await renderSubscription({ query: new URLSearchParams() });

    expect(document.body.textContent).toContain('دسترسی شما دائمی است');
    expect(buttonByText('پرداخت کارت به کارت')).toBeUndefined();
    expect(document.querySelectorAll('.plan-card')).toHaveLength(0);
  });

  it('warns when the admin has not configured a card yet', async () => {
    api.get.mockResolvedValue(subscriptionPayload({
      paymentProvider: { provider: 'card', configured: false, label: 'کارت به کارت', card: null },
    }));

    await renderSubscription({ query: new URLSearchParams() });

    expect(document.body.textContent).toContain('اطلاعات کارت هنوز تنظیم نشده است');
    expect(buttonByText('درگاه تنظیم نشده')).toBeTruthy();
  });
});

describe('admin card settings', () => {
  it('renders the saved card and sends normalized values to the API', async () => {
    api.get.mockResolvedValueOnce({
      settings: { ...CARD, updatedAt: new Date().toISOString() },
      configured: true,
      provider: { provider: 'card', configured: true, label: 'کارت به کارت' },
    });
    api.get.mockResolvedValue({
      settings: { ...CARD, cardHolder: 'نام جدید', updatedAt: new Date().toISOString() },
      configured: true,
      provider: { provider: 'card', configured: true, label: 'کارت به کارت' },
    });
    api.put.mockResolvedValue({ settings: CARD, configured: true });

    await renderAdminPaymentSettings();

    expect(document.getElementById('card-number').value).toBe('6037 1234 5678 9012');
    expect(document.getElementById('card-holder').value).toBe(CARD.cardHolder);
    expect(document.body.textContent).toContain('اطلاعات کارت کامل است');

    document.getElementById('card-holder').value = 'نام جدید';
    buttonByText('ذخیره اطلاعات کارت').click();

    await vi.waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    expect(api.put).toHaveBeenCalledWith('/admin/payment-settings', {
      cardNumber: '6037 1234 5678 9012',
      cardHolder: 'نام جدید',
      bankName: 'بانک ملی',
      instructions: CARD.instructions,
    });
  });
});

describe('admin payment review', () => {
  it('shows the receipt, approves it and updates the numeric badge', async () => {
    const pending = {
      id: 5,
      teacherName: 'خانم الف',
      planName: PLAN.name,
      amount: PLAN.price,
      days: PLAN.days,
      status: 'pending',
      provider: 'card',
      receiptText: 'پیگیری ۱۲۳',
      hasReceiptImage: true,
      receiptName: 'receipt.png',
      createdAt: new Date().toISOString(),
    };
    api.get.mockResolvedValue({
      items: [pending],
      total: 1,
      page: 1,
      limit: 50,
      pages: 1,
      pendingReceipts: 1,
    });
    api.post.mockResolvedValue({
      payment: { ...pending, status: 'paid' },
      subscription: { status: 'active', subscriptionEndsAt: new Date(Date.now() + 30 * 86400000).toISOString() },
      alreadyPaid: false,
    });

    await renderAdminPayments({ query: new URLSearchParams() });

    expect(document.body.textContent).toContain('پیگیری ۱۲۳');
    expect(document.body.textContent).toContain('تأیید و فعال‌سازی');
    expect(document.body.textContent).toContain('رد رسید');
    expect(document.querySelector('a[href="/api/v1/admin/payments/5/receipt"]')).toBeTruthy();
    expect(document.querySelectorAll('[data-admin-pending]').length).toBeGreaterThan(0);

    const approveButtons = [...document.querySelectorAll('button')].filter((node) => node.textContent.includes('تأیید و فعال‌سازی'));
    approveButtons[0].click();
    const confirmButtons = [...document.querySelectorAll('#modal-root button')].filter((node) => node.textContent.includes('تأیید و فعال‌سازی'));
    confirmButtons[confirmButtons.length - 1].click();

    await vi.waitFor(() => expect(api.post).toHaveBeenCalledWith('/admin/payments/5/approve', {}));
  });

  it('renders the pending badge on the admin tabs', () => {
    setAdminPendingPayments(3);
    const tabs = adminTabs('admin/payments');
    document.body.appendChild(tabs);
    const badge = tabs.querySelector('[data-admin-pending]');
    expect(badge).toBeTruthy();
    expect(badge.hidden).toBe(false);
    expect(badge.textContent).toBe('۳');
  });
});
