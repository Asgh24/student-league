/** Shared admin panel chrome and formatting. */

import { el } from '../../dom.js';
import { state } from '../../store.js';
import { chip, fa } from '../common.js';

const TABS = [
  ['admin', '📊', 'داشبورد'],
  ['admin/teachers', '👩‍🏫', 'معلمان'],
  ['admin/plans', '🛍️', 'طرح‌ها'],
  ['admin/payments', '🧾', 'پرداخت‌ها'],
  ['admin/payment-settings', '💳', 'کارت و پرداخت'],
  ['admin/sms', '📨', 'پنل پیامک'],
  ['admin/backup', '🗄️', 'بکاپ و بازیابی'],
];

export function adminTabs(active) {
  return el('nav.tabs.admin-tabs', { 'aria-label': 'بخش‌های پنل مدیر' }, TABS.map(([href, icon, label]) => {
    const children = [el('span', { text: `${icon} ${label}` })];
    if (href === 'admin/payments') {
      const pending = state.adminPendingPayments;
      children.push(el('span.tab__badge', {
        'data-admin-pending': '',
        text: pending > 0 ? fa(pending) : '',
        hidden: pending === 0,
        'aria-label': 'رسیدهای در انتظار بررسی',
      }));
    }
    return el(`a.tab${href === active ? '.is-active' : ''}`, { href: `#/${href}` }, children);
  }));
}

export function pendingReceiptNotice(count, { filtered = false } = {}) {
  if (!count) return null;
  return el('div.demo-banner.demo-banner--warn', { role: 'status' }, [
    el('strong', { text: `🔔 ${fa(count)} رسید کارت به کارت در انتظار بررسی است` }),
    el('p.small', {
      text: filtered
        ? 'برای دیدن و بررسی آن‌ها، روی «فقط رسیدهای در انتظار» بزنید.'
        : 'رسیدهای در انتظار در بالای همین فهرست نمایش داده می‌شوند.',
    }),
  ]);
}

export function money(value) {
  try {
    return new Intl.NumberFormat(state.persianDigits ? 'fa-IR' : 'en-US').format(Number(value) || 0);
  } catch {
    return String(Number(value) || 0);
  }
}

const STATUS_LABELS = {
  unlimited: ['نامحدود', 'muted'],
  active: ['فعال', 'ok'],
  trial: ['آزمایشی', 'amber'],
  expired: ['منقضی', 'bad'],
  paid: ['پرداخت‌شده', 'ok'],
  pending: ['در انتظار', 'amber'],
  failed: ['ناموفق', 'bad'],
  canceled: ['لغو‌شده', 'muted'],
  sent: ['ارسال‌شده', 'ok'],
  queued: ['در صف', 'amber'],
};

export function statusChip(status) {
  const [label, kind] = STATUS_LABELS[status] ?? [status, 'muted'];
  return chip(label, kind);
}

export function adminEmpty(title, hint = '') {
  return el('div.empty', {}, [
    el('span.empty__icon', { text: '📭', 'aria-hidden': 'true' }),
    el('p', { text: title }),
    hint ? el('p.small.muted', { text: hint }) : null,
  ]);
}
