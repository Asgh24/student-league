/** Shared admin panel chrome and formatting. */

import { el } from '../../dom.js';
import { state } from '../../store.js';
import { chip } from '../common.js';

const TABS = [
  ['admin', '📊', 'داشبورد'],
  ['admin/teachers', '👩‍🏫', 'معلمان'],
  ['admin/plans', '🛍️', 'طرح‌ها'],
  ['admin/payments', '🧾', 'پرداخت‌ها'],
  ['admin/sms', '📨', 'پنل پیامک'],
];

export function adminTabs(active) {
  return el('nav.tabs.admin-tabs', { 'aria-label': 'بخش‌های پنل مدیر' }, TABS.map(([href, icon, label]) => el(`a.tab${href === active ? '.is-active' : ''}`, {
    href: `#/${href}`,
    text: `${icon} ${label}`,
  })));
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
