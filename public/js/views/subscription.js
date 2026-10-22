/** Teacher subscription: current window, plans, manual card receipts and history. */

import { api } from '../api.js';
import { el } from '../dom.js';
import { bytes, errorMessage } from '../format.js';
import { renderView, setTopbarTitle } from '../shell.js';
import { state } from '../store.js';
import { confirmDialog, emptyState, notify, openModal } from '../ui.js';
import { backToWorkbench, button, card, fa, faDate, faDateTime, field, pageHead, statCard } from './common.js';

const STATUS = {
  unlimited: { label: 'دسترسی نامحدود', icon: '♾️', kind: 'unlimited' },
  active: { label: 'اشتراک فعال', icon: '✅', kind: 'active' },
  trial: { label: 'دورهٔ آزمایشی', icon: '🎁', kind: 'trial' },
  expired: { label: 'پایان‌یافته', icon: '⛔', kind: 'expired' },
};

const PAYMENT_STATUS = {
  paid: ['پرداخت‌شده', 'ok'],
  pending: ['در انتظار بررسی', 'amber'],
  failed: ['ناموفق', 'bad'],
  canceled: ['رد/لغو‌شده', 'muted'],
};

const PROVIDERS = {
  zarinpal: 'زرین‌پال',
  mock: 'پرداخت آزمایشی',
  manual: 'تمدید مدیر',
  card: 'کارت به کارت',
};

function money(value) {
  try {
    return new Intl.NumberFormat(state.persianDigits ? 'fa-IR' : 'en-US').format(Number(value) || 0);
  } catch {
    return fa(value);
  }
}

function formatCard(value) {
  return String(value ?? '').replace(/(.{4})/g, '$1 ').trim();
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

function destinationCard(provider) {
  const details = provider.card ?? {};
  if (provider.provider !== 'card' || !provider.configured) return null;
  const copy = button('کپی شماره کارت', {
    icon: '📋',
    kind: 'ghost',
    onClick: async () => {
      try {
        await navigator.clipboard.writeText(details.cardNumber);
        notify.ok('شماره کارت کپی شد');
      } catch {
        notify.error('کپی خودکار ممکن نشد؛ شماره کارت را دستی انتخاب کنید');
      }
    },
  });
  return card({ title: 'اطلاعات کارت مقصد', icon: '🏦' }, [
    el('div.receipt-box', {}, [
      el('p.small.muted', { text: 'شماره کارت' }),
      el('strong.receipt-card-number', { text: formatCard(details.cardNumber) }),
      el('p', { text: `صاحب کارت: ${details.cardHolder}` }),
      details.bankName ? el('p.small.muted', { text: `بانک: ${details.bankName}` }) : null,
    ]),
    el('p.small.muted', {
      text: 'مبلغ طرح انتخابی را به این کارت واریز کنید، سپس متن رسید و/یا تصویر رسید را در همین صفحه ثبت کنید.',
    }),
    details.instructions ? el('p.small', { text: details.instructions }) : null,
    el('div.row', {}, [copy]),
  ]);
}

function planCard(plan, provider, { hasPendingCard, onBuy }) {
  const badge = plan.days >= 365 ? 'بیشترین صرفه‌جویی' : plan.days >= 90 ? 'محبوب' : '';
  const cardMode = provider.provider === 'card';
  const blocked = !provider.configured || (cardMode && hasPendingCard);
  const label = !provider.configured
    ? 'درگاه تنظیم نشده'
    : cardMode && hasPendingCard
      ? 'رسید در انتظار بررسی'
      : cardMode
        ? 'پرداخت کارت به کارت'
        : 'خرید این طرح';
  const buy = button(label, {
    icon: cardMode ? '🏦' : '💳',
    onClick: () => onBuy(plan),
    disabled: blocked,
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
        text: `${money(payment.amount)} تومان · ${PROVIDERS[payment.provider] ?? payment.provider} · ${faDateTime(payment.createdAt)}`,
      }),
      payment.hasReceiptImage
        ? el('a.small', {
          href: `/api/v1/subscription/payments/${payment.id}/receipt`,
          target: '_blank',
          rel: 'noopener',
          text: '🖼️ مشاهده تصویر رسید',
        })
        : null,
      payment.status === 'canceled' && payment.reviewNote
        ? el('p.small', { text: `دلیل رد: ${payment.reviewNote}` })
        : null,
    ]),
    payment.refId ? el('span.small.muted', { text: `کد پیگیری: ${payment.refId}` }) : null,
  ]);
}

function pendingCardRow(payment, onCancel) {
  if (payment.provider !== 'card') return paymentRow(payment);
  return el('div.payment-row.is-pending', {}, [
    el('div.payment-row__main', {}, [
      el('strong', { text: payment.planName || 'اشتراک' }),
      el('span.chip.chip--amber', { text: 'در انتظار تأیید مدیر' }),
      el('p.small.muted', {
        text: `${money(payment.amount)} تومان · ${fa(payment.days)} روز · ثبت: ${faDateTime(payment.createdAt)}`,
      }),
      payment.receiptText ? el('p.small', { text: `متن رسید: ${payment.receiptText}` }) : null,
      payment.hasReceiptImage
        ? el('a.small', {
          href: `/api/v1/subscription/payments/${payment.id}/receipt`,
          target: '_blank',
          rel: 'noopener',
          text: '🖼️ مشاهده تصویر رسید ارسال‌شده',
        })
        : null,
    ]),
    el('div.payment-row__actions', {}, [
      button('لغو این رسید', { kind: 'danger', icon: '✖️', onClick: () => onCancel(payment) }),
    ]),
  ]);
}

function openReceiptDialog({ plan, provider, maxBytes, onSubmitted }) {
  const details = provider.card ?? {};
  const receiptText = el('textarea', {
    id: 'receipt-text',
    rows: '3',
    maxlength: '500',
    placeholder: 'شماره پیگیری، ساعت واریز یا توضیح کوتاه',
  });
  const fileInput = el('input', {
    id: 'receipt-image',
    type: 'file',
    accept: 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp',
  });
  const fileHint = el('span.receipt-file', { text: 'تصویری انتخاب نشده است' });
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileHint.textContent = file ? `${file.name} · ${bytes(file.size)}` : 'تصویری انتخاب نشده است';
  });

  const body = el('div.grid', {}, [
    el('div.receipt-box', {}, [
      el('p.small.muted', { text: 'کارت مقصد' }),
      el('strong.receipt-card-number', { text: formatCard(details.cardNumber) }),
      el('p.small', { text: `${details.cardHolder}${details.bankName ? ` · ${details.bankName}` : ''}` }),
      el('p.small.muted', { text: `مبلغ طرح: ${money(plan.price)} تومان · مدت: ${fa(plan.days)} روز` }),
    ]),
    field('متن رسید', receiptText, 'متن رسید یا تصویر آن، حداقل یکی الزامی است.'),
    field('تصویر رسید کارت به کارت', fileInput, `فرمت JPG، PNG یا WEBP؛ حداکثر ${bytes(maxBytes)}.`),
    fileHint,
    el('p.small.muted', { text: `پس از تأیید مدیر، ${fa(plan.days)} روز به اشتراک شما اضافه می‌شود.` }),
  ]);

  let busy = false;
  openModal({
    title: 'ثبت رسید کارت به کارت',
    body,
    actions: [
      { label: 'انصراف', kind: 'ghost', onClick: ({ close }) => close() },
      {
        label: 'ارسال رسید',
        onClick: async ({ close, button: submit }) => {
          if (busy) return;
          const text = receiptText.value.trim();
          const file = fileInput.files?.[0] ?? null;
          if (!text && !file) {
            notify.error('متن رسید یا تصویر رسید را وارد کنید');
            receiptText.focus();
            return;
          }
          if (file && file.size > maxBytes) {
            notify.error(`حجم تصویر رسید باید کمتر از ${bytes(maxBytes)} باشد`);
            return;
          }
          busy = true;
          submit.disabled = true;
          submit.textContent = 'در حال ارسال…';
          try {
            const form = new FormData();
            form.append('planId', String(plan.id));
            form.append('receiptText', text);
            if (file) form.append('receipt', file);
            const result = await api.upload('/subscription/card-checkout', form);
            close();
            notify.ok(result?.message || 'رسید شما ثبت شد و پس از بررسی مدیر فعال می‌شود');
            await onSubmitted();
          } catch (error) {
            notify.error(errorMessage(error));
            busy = false;
            submit.disabled = false;
            submit.textContent = 'ارسال رسید';
          }
        },
      },
    ],
  });
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

  let firstLoad = true;

  async function load() {
    body.replaceChildren(el('div.empty', {}, [
      el('span.empty__icon', { text: '⏳' }),
      el('p', { text: 'در حال دریافت وضعیت اشتراک…' }),
    ]));

    let payload;
    try {
      payload = await api.get('/subscription/status');
    } catch (error) {
      body.replaceChildren(emptyState({ icon: '⚠️', title: 'دریافت وضعیت اشتراک ناموفق بود', hint: errorMessage(error) }));
      return;
    }

    const subscription = payload?.subscription ?? { status: 'expired', daysLeft: 0 };
    const plans = payload?.plans ?? [];
    const provider = payload?.paymentProvider ?? { provider: 'mock', configured: false, label: 'درگاه' };
    const trialDays = payload?.trialDays ?? state.meta.trialDays ?? 14;
    const maxBytes = payload?.receiptMaxBytes ?? state.meta.maxUploadBytes ?? 5 * 1024 * 1024;
    const allPayments = payload?.payments ?? [];
    const history = allPayments.filter((payment) => payment.status !== 'pending');
    const pending = allPayments.filter((payment) => payment.status === 'pending');
    const pendingCard = pending.some((payment) => payment.provider === 'card');

    if (firstLoad) {
      firstLoad = false;
      const bought = ctx?.query?.get?.('payment');
      if (bought === 'success') notify.ok('پرداخت با موفقیت انجام شد و اشتراک شما فعال شد');
      else if (bought === 'canceled') notify.warn('پرداخت لغو شد');
      else if (bought === 'failed') notify.error('پرداخت ناموفق بود؛ اگر مبلغ کسر شده باشد، طبق رویهٔ درگاه بازگردانده می‌شود');
      else if (bought === 'notfound') notify.error('سابقهٔ این پرداخت پیدا نشد');
    }

    async function buy(plan) {
      if (provider.provider === 'card') {
        openReceiptDialog({ plan, provider, maxBytes, onSubmitted: load });
        return;
      }
      try {
        const checkout = await api.post('/subscription/checkout', { planId: plan.id });
        if (!checkout?.redirectUrl) throw new Error('نشانی درگاه پرداخت دریافت نشد');
        window.location.href = checkout.redirectUrl;
      } catch (error) {
        notify.error(errorMessage(error));
      }
    }

    async function cancelPending(payment) {
      const confirmed = await confirmDialog({
        title: 'لغو رسید در انتظار',
        message: 'این رسید لغو شود تا بتوانید رسید جدیدی ارسال کنید؟',
        confirmLabel: 'لغو رسید',
        danger: true,
      });
      if (!confirmed) return;
      try {
        await api.del(`/subscription/payments/${payment.id}`);
        notify.ok('رسید لغو شد؛ اکنون می‌توانید رسید جدید ثبت کنید');
        await load();
      } catch (error) {
        notify.error(errorMessage(error));
      }
    }

    body.replaceChildren(el('div.grid', {}, [
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
      subscription.status === 'unlimited' ? null : destinationCard(provider),
      subscription.status === 'unlimited'
        ? card({ title: 'طرح‌های اشتراک', icon: '🛍️' }, [
          emptyState({
            icon: '♾️',
            title: 'دسترسی شما دائمی است',
            hint: 'این حساب دسترسی نامحدود دارد و نیازی به خرید یا تمدید اشتراک نیست.',
          }),
        ])
        : card({ title: 'طرح‌های اشتراک', icon: '🛍️' }, [
          provider.provider === 'mock'
            ? el('div.demo-banner', {}, [
              el('strong', { text: 'حالت پرداخت آزمایشی فعال است' }),
              el('p.small', { text: 'در این حالت هیچ پولی جابه‌جا نمی‌شود و می‌توانید کل فرایند خرید و فعال‌سازی را امتحان کنید.' }),
            ])
            : null,
          provider.provider === 'card' && !provider.configured
            ? el('div.demo-banner.demo-banner--warn', {}, [
              el('strong', { text: 'اطلاعات کارت هنوز تنظیم نشده است' }),
              el('p.small', { text: 'مدیر سامانه باید شماره کارت و نام صاحب کارت را در پنل وارد کند.' }),
            ])
            : null,
          plans.length
            ? el('div.plans', {}, plans.map((plan) => planCard(plan, provider, { hasPendingCard: pendingCard, onBuy: buy })))
            : emptyState({ icon: '🛍️', title: 'طرح فعالی برای فروش وجود ندارد', hint: 'لطفاً بعداً دوباره سر بزنید یا با مدیر سامانه تماس بگیرید.' }),
          el('p.small.muted', {
            style: { marginTop: '12px' },
            text: `روش پرداخت: ${provider.label}${provider.provider === 'zarinpal' ? (provider.sandbox ? ' (سندباکس)' : '') : ''} · مبالغ به تومان نمایش داده می‌شوند.`,
          }),
        ]),
      pending.length
        ? card({ title: 'پرداخت‌های در انتظار بررسی', icon: '⏳' }, pending.map((payment) => pendingCardRow(payment, cancelPending)))
        : null,
      card({ title: 'تاریخچهٔ پرداخت‌ها', icon: '🧾' }, [
        history.length
          ? el('div.payment-list', {}, history.map(paymentRow))
          : emptyState({ icon: '🧾', title: 'هنوز پرداختی ثبت نشده است' }),
      ]),
    ]));
  }

  await load();
  return undefined;
}
