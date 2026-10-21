/** Teacher subscription: current window, plans, gateway checkout and history. */

import { api } from '../api.js';
import { el } from '../dom.js';
import { errorMessage } from '../format.js';
import { renderView, setTopbarTitle } from '../shell.js';
import { state } from '../store.js';
import { emptyState, notify } from '../ui.js';
import { backToWorkbench, button, card, fa, faDate, faDateTime, pageHead, statCard } from './common.js';

const STATUS = {
  unlimited: { label: 'دسترسی نامحدود', icon: '♾️', kind: 'unlimited' },
  active: { label: 'اشتراک فعال', icon: '✅', kind: 'active' },
  trial: { label: 'دورهٔ آزمایشی', icon: '🎁', kind: 'trial' },
  expired: { label: 'پایان‌یافته', icon: '⛔', kind: 'expired' },
};

const PAYMENT_STATUS = {
  paid: ['پرداخت‌شده', 'ok'],
  pending: ['در انتظار پرداخت', 'amber'],
  failed: ['ناموفق', 'bad'],
  canceled: ['لغو‌شده', 'muted'],
};

function money(value) {
  try {
    return new Intl.NumberFormat(state.persianDigits ? 'fa-IR' : 'en-US').format(Number(value) || 0);
  } catch {
    return fa(value);
  }
}

function statusBanner(subscription, trialDays) {
  const meta = STATUS[subscription.status] ?? STATUS.expired;
  const lines = [];
  if (subscription.status === 'trial') {
    lines.push(`دورهٔ آزمایشی شما ${fa(subscription.daysLeft)} روز دیگر تمام می‌شود.`);
    if (subscription.endsAt) lines.push(`پایان دوره: ${faDate(subscription.endsAt)}`);
  } else if (subscription.status === 'active') {
    lines.push(`اشتراک شما فعال است و ${fa(subscription.daysLeft)} روز اعتبار دارد.`);
    if (subscription.endsAt) lines.push(`اعتبار تا: ${faDate(subscription.endsAt)}`);
  } else if (subscription.status === 'unlimited') {
    lines.push('این حساب دسترسی دائمی دارد و نیازی به تمدید نیست.');
  } else {
    lines.push('دورهٔ آزمایشی یا اشتراک شما به پایان رسیده است. برای ادامهٔ استفاده، یکی از طرح‌ها را انتخاب کنید.');
  }
  if (trialDays && subscription.status !== 'trial' && subscription.status !== 'unlimited') {
    lines.push(`معلمان جدید ${fa(trialDays)} روز استفادهٔ آزمایشی رایگان دریافت می‌کنند.`);
  }
  return el(`div.sub-banner.sub-banner--${meta.kind}`, {}, [
    el('div.sub-banner__icon', { text: meta.icon, 'aria-hidden': 'true' }),
    el('div', {}, [
      el('strong', { text: meta.label }),
      ...lines.map((line) => el('p.small', { text: line })),
    ]),
  ]);
}

function planCard(plan, provider, onBuy) {
  const badge = plan.days >= 365 ? 'بیشترین صرفه‌جویی' : plan.days >= 90 ? 'محبوب' : '';
  const buy = button('خرید این طرح', {
    icon: '💳',
    onClick: () => onBuy(plan),
    disabled: !provider.configured,
  });
  return el(`div.plan-card${plan.days >= 90 ? '.plan-card--featured' : ''}`, {}, [
    badge ? el('span.plan-card__badge', { text: badge }) : null,
    el('h3', { text: plan.name }),
    el('div.plan-card__price', {}, [
      el('strong', { text: money(plan.price) }),
      el('span', { text: 'تومان' }),
    ]),
    el('p.small.muted', { text: `${fa(plan.days)} روز دسترسی کامل` }),
    plan.description ? el('p.small', { text: plan.description }) : null,
    el('span.spacer'),
    buy,
  ]);
}

function paymentRow(payment) {
  const [label, kind] = PAYMENT_STATUS[payment.status] ?? [payment.status, 'muted'];
  return el('div.payment-row', {}, [
    el('div.payment-row__main', {}, [
      el('strong', { text: payment.planName || 'اشتراک' }),
      el('span.chip', { text: label, class: `chip chip--${kind}` }),
      el('p.small.muted', {
        text: `${money(payment.amount)} تومان · ${payment.provider === 'zarinpal' ? 'زرین‌پال' : payment.provider === 'manual' ? 'تمدید مدیر' : 'پرداخت آزمایشی'} · ${faDateTime(payment.createdAt)}`,
      }),
    ]),
    payment.refId ? el('span.small.muted', { text: `کد پیگیری: ${payment.refId}` }) : null,
  ]);
}

export async function renderSubscription(ctx) {
  setTopbarTitle('اشتراک من');
  const body = el('div');
  renderView([
    pageHead({
      icon: '💳',
      title: 'اشتراک من',
      subtitle: 'وضعیت دسترسی، خرید و تاریخچهٔ پرداخت‌ها',
      actions: [backToWorkbench()],
    }),
    body,
  ]);
  body.appendChild(el('div.empty', {}, [el('span.empty__icon', { text: '⏳' }), el('p', { text: 'در حال دریافت وضعیت اشتراک…' })]));

  let payload;
  try {
    payload = await api.get('/subscription/status');
  } catch (error) {
    body.textContent = '';
    body.appendChild(emptyState({ icon: '⚠️', title: 'دریافت وضعیت اشتراک ناموفق بود', hint: errorMessage(error) }));
    return undefined;
  }

  const subscription = payload?.subscription ?? { status: 'expired', daysLeft: 0 };
  const plans = payload?.plans ?? [];
  const provider = payload?.paymentProvider ?? { provider: 'mock', configured: false, label: 'درگاه' };
  const trialDays = payload?.trialDays ?? state.meta.trialDays ?? 14;

  const bought = ctx?.query?.get('payment');
  if (bought === 'success') notify.ok('پرداخت با موفقیت انجام شد و اشتراک شما فعال شد');
  else if (bought === 'canceled') notify.warn('پرداخت لغو شد');
  else if (bought === 'failed') notify.error('پرداخت ناموفق بود؛ اگر مبلغ کسر شده باشد، طبق رویهٔ درگاه بازگردانده می‌شود');
  else if (bought === 'notfound') notify.error('سابقهٔ این پرداخت پیدا نشد');

  async function buy(plan) {
    try {
      const checkout = await api.post('/subscription/checkout', { planId: plan.id });
      if (!checkout?.redirectUrl) throw new Error('نشانی درگاه پرداخت دریافت نشد');
      window.location.href = checkout.redirectUrl;
    } catch (error) {
      notify.error(errorMessage(error));
    }
  }

  const history = (payload?.payments ?? []).filter((payment) => payment.status !== 'pending');
  const pending = (payload?.payments ?? []).filter((payment) => payment.status === 'pending');

  body.textContent = '';
  body.appendChild(el('div.grid', {}, [
    statusBanner(subscription, trialDays),
    card({ title: 'خلاصهٔ دسترسی', icon: '📊' }, [
      el('div.grid.grid--stats', {}, [
        statCard({ label: 'وضعیت', value: STATUS[subscription.status]?.label ?? '—', icon: '🔐' }),
        statCard({
          label: 'روزهای باقی‌مانده',
          value: subscription.status === 'unlimited' ? '∞' : fa(subscription.daysLeft ?? 0),
          icon: '⏳',
        }),
        statCard({ label: 'تعداد پرداخت موفق', value: fa(history.filter((payment) => payment.status === 'paid').length), icon: '🧾' }),
      ]),
    ]),
    card({ title: 'طرح‌های اشتراک', icon: '🛍️' }, [
      provider.provider === 'mock'
        ? el('div.demo-banner', {}, [
          el('strong', { text: 'حالت پرداخت آزمایشی فعال است' }),
          el('p.small', { text: 'در این حالت هیچ پولی جابه‌جا نمی‌شود و می‌توانید کل فرایند خرید و فعال‌سازی را امتحان کنید.' }),
        ])
        : null,
      !provider.configured
        ? el('div.demo-banner.demo-banner--warn', {}, [
          el('strong', { text: 'درگاه پرداخت هنوز تنظیم نشده است' }),
          el('p.small', { text: 'مدیر سامانه باید شناسهٔ پذیرندهٔ زرین‌پال را در تنظیمات سرور وارد کند.' }),
        ])
        : null,
      plans.length
        ? el('div.plans', {}, plans.map((plan) => planCard(plan, provider, buy)))
        : emptyState({ icon: '🛍️', title: 'طرح فعالی برای فروش وجود ندارد', hint: 'لطفاً بعداً دوباره سر بزنید یا با مدیر سامانه تماس بگیرید.' }),
      el('p.small.muted', {
        style: { marginTop: '12px' },
        text: `درگاه: ${provider.label}${provider.provider === 'zarinpal' ? (provider.sandbox ? ' (سندباکس)' : '') : ''} · مبالغ به تومان نمایش داده می‌شوند.`,
      }),
    ]),
    pending.length ? card({ title: 'پرداخت‌های در انتظار', icon: '⏳' }, pending.map(paymentRow)) : null,
    card({ title: 'تاریخچهٔ پرداخت‌ها', icon: '🧾' }, [
      history.length
        ? el('div.payment-list', {}, history.map(paymentRow))
        : emptyState({ icon: '🧾', title: 'هنوز پرداختی ثبت نشده است' }),
    ]),
  ]));
  return undefined;
}
