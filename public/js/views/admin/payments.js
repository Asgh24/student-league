/** Admin payment ledger, including manual card-to-card receipt review. */

import { api } from '../../api.js';
import { updateAdminPendingBadge } from '../../adminBadge.js';
import { el } from '../../dom.js';
import { errorMessage } from '../../format.js';
import { renderView, setTopbarTitle } from '../../shell.js';
import { confirmDialog, emptyState, formDialog, notify } from '../../ui.js';
import { button, card, chip, fa, faDateTime, field, pageHead } from '../common.js';
import { adminTabs, money, pendingReceiptNotice, statusChip } from './common.js';

const PROVIDERS = {
  zarinpal: 'زرین‌پال',
  mock: 'آزمایشی',
  manual: 'تمدید مدیر',
  card: 'کارت به کارت',
};

const PAYMENT_STATUSES = ['', 'pending', 'paid', 'failed', 'canceled'];

function receiptBox(payment) {
  if (payment.provider !== 'card') return null;
  const children = [];
  if (payment.receiptText) {
    children.push(el('p.small.muted', { text: 'متن رسید' }));
    children.push(el('p', { text: payment.receiptText }));
  }
  if (payment.hasReceiptImage) {
    children.push(el('p.small.muted', {
      text: `تصویر رسید${payment.receiptName ? `: ${payment.receiptName}` : ''}`,
    }));
    children.push(el('div.receipt-actions', {}, [
      el('a.btn.btn--sm.btn--ghost', {
        href: `/api/v1/admin/payments/${payment.id}/receipt`,
        target: '_blank',
        rel: 'noopener',
        text: '🖼️ مشاهده تصویر رسید',
      }),
    ]));
  }
  if (payment.reviewNote) {
    children.push(el('p.small.muted', { text: `یادداشت بررسی: ${payment.reviewNote}` }));
  }
  if (!children.length) return null;
  return el('div.receipt-box', {}, children);
}

function statusOf(payment) {
  if (payment.provider === 'card' && payment.status === 'canceled') {
    return chip('رد/لغو شده', 'muted');
  }
  return statusChip(payment.status);
}

function paymentCard(payment, { onApprove, onReject }) {
  const pendingCard = payment.provider === 'card' && payment.status === 'pending';
  const meta = [
    `ثبت: ${faDateTime(payment.createdAt)}`,
    payment.paidAt ? `پرداخت: ${faDateTime(payment.paidAt)}` : null,
    payment.refId ? `کد پیگیری: ${payment.refId}` : null,
    payment.error ? `خطا: ${payment.error}` : null,
  ].filter(Boolean).join(' · ');

  return el(`div.payment-row${pendingCard ? '.is-pending' : ''}`, {}, [
    el('div.payment-row__main', {}, [
      el('div.row', {}, [
        el('strong', { text: payment.teacherName || 'معلم' }),
        statusOf(payment),
        el('span.chip.chip--muted', { text: PROVIDERS[payment.provider] ?? payment.provider }),
      ]),
      el('p', {}, [
        el('strong', { text: `${money(payment.amount)} تومان` }),
        el('span.small.muted', { text: ` · ${payment.planName || 'اشتراک'} · ${fa(payment.days)} روز` }),
      ]),
      el('p.small.muted', { text: meta }),
      receiptBox(payment),
    ]),
    pendingCard
      ? el('div.payment-row__actions', {}, [
        button('تأیید و فعال‌سازی', { kind: 'primary', icon: '✅', onClick: () => onApprove(payment) }),
        button('رد رسید', { kind: 'danger', icon: '⛔', onClick: () => onReject(payment) }),
      ])
      : null,
  ]);
}

export async function renderAdminPayments(ctx = {}) {
  setTopbarTitle('پرداخت‌ها');
  let search = '';
  const fromQuery = typeof ctx?.query?.get === 'function' ? ctx.query.get('status') : '';
  let status = PAYMENT_STATUSES.includes(fromQuery) ? fromQuery : '';
  let page = 1;
  const body = el('div');
  renderView([
    pageHead({
      icon: '🧾',
      title: 'پرداخت‌ها',
      subtitle: 'تاریخچهٔ خرید اشتراک، رسیدهای کارت به کارت و تمدیدهای دستی',
      actions: [
        el('a.btn.btn--ghost', { href: '#/admin/payment-settings' }, [
          el('span', { text: '💳', 'aria-hidden': 'true' }),
          el('span', { text: 'تنظیمات کارت' }),
        ]),
      ],
    }),
    adminTabs('admin/payments'),
    body,
  ]);

  async function approve(payment) {
    const confirmed = await confirmDialog({
      title: 'تأیید رسید کارت به کارت',
      message: `رسید ${payment.teacherName || 'معلم'} برای «${payment.planName || 'اشتراک'}» به مبلغ ${money(payment.amount)} تومان تأیید شود؟ با این کار ${fa(payment.days)} روز به اشتراک معلم اضافه می‌شود.`,
      confirmLabel: 'تأیید و فعال‌سازی',
    });
    if (!confirmed) return;
    try {
      const result = await api.post(`/admin/payments/${payment.id}/approve`, {});
      const end = result?.subscription?.subscriptionEndsAt || result?.subscription?.endsAt;
      notify.ok(result?.alreadyPaid
        ? 'این پرداخت قبلاً تأیید شده بود و اشتراک دوباره تمدید نشد'
        : `اشتراک تأیید شد${end ? ` و تا ${faDateTime(end)} فعال است` : ''}`);
      await load();
    } catch (error) {
      notify.error(errorMessage(error));
    }
  }

  async function reject(payment) {
    const values = await formDialog({
      title: 'رد رسید کارت به کارت',
      description: `رسید ${payment.teacherName || 'معلم'} برای «${payment.planName || 'اشتراک'}» رد شود؟`,
      fields: [{
        name: 'reason',
        label: 'دلیل رد (اختیاری)',
        type: 'textarea',
        placeholder: 'مثلاً مبلغ واریزی با مبلغ طرح هم‌خوانی ندارد',
      }],
      submitLabel: 'رد رسید',
    });
    if (!values) return;
    try {
      await api.post(`/admin/payments/${payment.id}/reject`, { reason: values.reason });
      notify.ok('رسید رد شد و به معلم اطلاع داده می‌شود');
      await load();
    } catch (error) {
      notify.error(errorMessage(error));
    }
  }

  async function load() {
    body.replaceChildren(el('div.empty', {}, [
      el('span.empty__icon', { text: '⏳' }),
      el('p', { text: 'در حال دریافت پرداخت‌ها…' }),
    ]));
    const params = new URLSearchParams({ page: String(page), limit: '50' });
    if (search) params.set('search', search);
    if (status) params.set('status', status);
    let payload;
    try {
      payload = await api.get(`/admin/payments?${params.toString()}`);
    } catch (error) {
      body.replaceChildren(emptyState({ icon: '⚠️', title: 'دریافت پرداخت‌ها ناموفق بود', hint: errorMessage(error) }));
      return;
    }
    updateAdminPendingBadge(payload.pendingReceipts ?? 0);

    const searchInput = el('input', { id: 'admin-pay-search', type: 'search', value: search, placeholder: 'نام معلم یا نام کاربری…' });
    const statusSelect = el('select', { id: 'admin-pay-status' }, [
      el('option', { value: '', text: 'همهٔ وضعیت‌ها', selected: status === '' }),
      el('option', { value: 'pending', text: 'در انتظار بررسی', selected: status === 'pending' }),
      el('option', { value: 'paid', text: 'پرداخت‌شده', selected: status === 'paid' }),
      el('option', { value: 'failed', text: 'ناموفق', selected: status === 'failed' }),
      el('option', { value: 'canceled', text: 'رد/لغو‌شده', selected: status === 'canceled' }),
    ]);
    const form = el('form.filter-bar', {}, [
      field('جستجو', searchInput),
      field('وضعیت', statusSelect),
      el('div.field', {}, [el('label', { text: ' ' }), button('اعمال', { icon: '🔎', type: 'submit' })]),
    ]);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      search = searchInput.value.trim();
      status = statusSelect.value;
      page = 1;
      void load();
    });

    const pendingNotice = pendingReceiptNotice(payload.pendingReceipts, { filtered: status !== 'pending' });
    const pendingFilter = payload.pendingReceipts && status !== 'pending'
      ? button('فقط رسیدهای در انتظار', {
        kind: 'ghost',
        icon: '🔔',
        onClick: () => {
          status = 'pending';
          page = 1;
          void load();
        },
      })
      : null;

    const pager = payload.pages > 1
      ? el('div.row', { style: { marginTop: '10px' } }, [
        button('قبلی', { kind: 'ghost', icon: '→', disabled: page <= 1, onClick: () => { page -= 1; void load(); } }),
        el('span.small.muted', { text: `صفحهٔ ${fa(payload.page)} از ${fa(payload.pages)}` }),
        button('بعدی', { kind: 'ghost', icon: '←', disabled: page >= payload.pages, onClick: () => { page += 1; void load(); } }),
      ])
      : null;

    body.replaceChildren(
      card({ title: `پرداخت‌ها (${fa(payload.total ?? 0)})`, icon: '📋' }, [
        pendingNotice,
        pendingFilter ? el('div.row', { style: { marginBottom: '10px' } }, [pendingFilter]) : null,
        form,
        payload.items?.length
          ? el('div.payment-list', {}, payload.items.map((payment) => paymentCard(payment, { onApprove: approve, onReject: reject })))
          : emptyState({ icon: '🧾', title: 'پرداختی با این فیلتر پیدا نشد' }),
        pager,
      ]),
    );
  }

  await load();
  return undefined;
}
