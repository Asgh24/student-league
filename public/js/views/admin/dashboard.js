/** Site-owner dashboard: subscriptions, revenue, inbox and SMS health. */

import { api } from '../../api.js';
import { updateAdminPendingBadge } from '../../adminBadge.js';
import { el } from '../../dom.js';
import { errorMessage } from '../../format.js';
import { renderView, setTopbarTitle } from '../../shell.js';
import { emptyState } from '../../ui.js';
import { button, card, fa, faDateTime, pageHead, statCard, tile } from '../common.js';
import { adminTabs, money, statusChip } from './common.js';

function providerLabel(data) {
  if (data.paymentProvider === 'card') return data.cardConfigured ? 'کارت به کارت' : 'کارت به کارت (تنظیم نشده)';
  return data.paymentProvider === 'zarinpal' ? 'زرین‌پال' : 'پرداخت آزمایشی';
}

function revenueCard(data) {
  const pendingReceipts = data.payments.pendingReceipts ?? 0;
  return card({ title: 'فروش و اشتراک', icon: '💳' }, [
    el('div.grid.grid--stats', {}, [
      statCard({ label: 'درآمد کل (تومان)', value: money(data.revenue.total), icon: '💰' }),
      statCard({ label: 'درآمد ۳۰ روز اخیر', value: money(data.revenue.last30Days), kind: 'ok', icon: '📈' }),
      statCard({ label: 'پرداخت موفق', value: fa(data.revenue.count), icon: '🧾' }),
      statCard({ label: 'رسید در انتظار', value: fa(pendingReceipts), kind: pendingReceipts ? 'warn' : '', icon: '⏳' }),
    ]),
    el('p.small.muted', {
      text: `روش پرداخت فعال: ${providerLabel(data)} · دورهٔ آزمایشی معلمان جدید: ${fa(data.trialDays)} روز`,
    }),
    data.paymentProvider === 'card' && !data.cardConfigured
      ? el('div.demo-banner.demo-banner--warn', {}, [
        el('strong', { text: 'شماره کارت مقصد ثبت نشده است' }),
        el('p.small', { text: 'تا قبل از تکمیل اطلاعات کارت، معلمان نمی‌توانند رسید کارت به کارت ارسال کنند.' }),
      ])
      : null,
    el('div.row', {}, [
      button('مدیریت پرداخت‌ها', { kind: 'soft', icon: '🧾', onClick: () => { window.location.hash = '#/admin/payments'; } }),
      button('کارت و پرداخت', { kind: 'soft', icon: '💳', onClick: () => { window.location.hash = '#/admin/payment-settings'; } }),
      button('مدیریت معلمان', { kind: 'soft', icon: '👩‍🏫', onClick: () => { window.location.hash = '#/admin/teachers'; } }),
    ]),
  ]);
}

function recentPaymentsCard(payments) {
  return card({ title: 'آخرین پرداخت‌ها', icon: '🧾' }, [
    payments.length
      ? el('div.payment-list', {}, payments.map((payment) => el('div.payment-row', {}, [
        el('div.payment-row__main', {}, [
          el('strong', { text: payment.teacherName || 'معلم' }),
          statusChip(payment.status),
          el('p.small.muted', { text: `${payment.planName || 'اشتراک'} · ${money(payment.amount)} تومان · ${faDateTime(payment.createdAt)}` }),
        ]),
        payment.provider === 'manual'
          ? el('span.chip.chip--muted', { text: 'تمدید دستی' })
          : payment.provider === 'card'
            ? el('span.chip.chip--muted', { text: 'کارت به کارت' })
            : null,
      ])))
      : emptyState({ icon: '🧾', title: 'هنوز پرداختی ثبت نشده است' }),
  ]);
}

function smsCard(sms) {
  const counts = sms?.outbox ?? {};
  const config = sms?.config ?? {};
  return card({ title: 'پنل پیامک', icon: '📨' }, [
    el('p.small.muted', {
      text: config.configured
        ? `sms.ir متصل است · خط ${config.lineNumber || '—'}`
        : 'sms.ir هنوز پیکربندی نشده است؛ پیام‌ها در صف ذخیره می‌شوند.',
    }),
    el('div.grid.grid--stats', {}, [
      statCard({ label: 'در صف', value: fa(counts.queued ?? 0), kind: 'warn', icon: '⏳' }),
      statCard({ label: 'ارسال‌شده', value: fa(counts.sent ?? 0), kind: 'ok', icon: '✅' }),
      statCard({ label: 'ناموفق', value: fa(counts.failed ?? 0), kind: 'bad', icon: '❌' }),
    ]),
    el('div.row', {}, [
      button('باز کردن پنل پیامک', { kind: 'soft', icon: '📨', onClick: () => { window.location.hash = '#/admin/sms'; } }),
    ]),
  ]);
}

export async function renderAdminDashboard() {
  setTopbarTitle('داشبورد مدیر');
  const body = el('div');
  renderView([
    pageHead({ icon: '🛡️', title: 'پنل مدیر سامانه', subtitle: 'نظارت بر معلمان، اشتراک‌ها، پرداخت‌ها و پیامک‌ها' }),
    adminTabs('admin'),
    body,
  ]);
  body.appendChild(el('div.empty', {}, [el('span.empty__icon', { text: '⏳' }), el('p', { text: 'در حال دریافت آمار…' })]));

  let data;
  try {
    data = await api.get('/admin/dashboard');
  } catch (error) {
    body.textContent = '';
    body.appendChild(emptyState({ icon: '⚠️', title: 'دریافت آمار ناموفق بود', hint: errorMessage(error) }));
    return undefined;
  }

  updateAdminPendingBadge(data.payments.pendingReceipts ?? 0);
  const teachers = data.teachers;
  body.textContent = '';
  body.append(
    el('div.grid', { style: { gap: '14px' } }, [
      card({ title: 'نمای کلی سامانه', icon: '📊' }, [
        el('div.grid.grid--stats', {}, [
          statCard({ label: 'کل معلمان', value: fa(teachers.total), icon: '👩‍🏫' }),
          statCard({ label: 'دسترسی فعال', value: fa(teachers.activeTotal), kind: 'ok', icon: '✅' }),
          statCard({ label: 'در دورهٔ آزمایشی', value: fa(teachers.trial), kind: 'warn', icon: '🎁' }),
          statCard({ label: 'منقضی', value: fa(teachers.expired), kind: 'bad', icon: '⛔' }),
          statCard({ label: 'دانش‌آموزان', value: fa(data.students), icon: '🧑‍🎓' }),
          statCard({ label: 'لیگ‌ها', value: fa(data.leagues), icon: '🏆' }),
          statCard({ label: 'گفتگوها', value: fa(data.messages.threads), icon: '💬' }),
          statCard({ label: 'پیام‌ها', value: fa(data.messages.messages), icon: '✉️' }),
        ]),
      ]),
      revenueCard(data),
      el('div.grid.grid--two', {}, [
        recentPaymentsCard(data.recentPayments ?? []),
        smsCard(data.sms),
      ]),
      card({ title: 'دسترسی سریع', icon: '⚡' }, [
        el('div.grid.grid--tiles', {}, [
          tile({ icon: '👩‍🏫', label: 'معلمان', href: 'admin/teachers' }),
          tile({ icon: '🛍️', label: 'طرح‌های اشتراک', href: 'admin/plans' }),
          tile({ icon: '🧾', label: 'پرداخت‌ها', href: 'admin/payments' }),
          tile({ icon: '💳', label: 'کارت و پرداخت', href: 'admin/payment-settings' }),
          tile({ icon: '📨', label: 'پنل پیامک', href: 'admin/sms' }),
        ]),
      ]),
    ]),
  );
  return undefined;
}
