/** Admin payment ledger. */

import { api } from '../../api.js';
import { el } from '../../dom.js';
import { errorMessage } from '../../format.js';
import { renderView, setTopbarTitle } from '../../shell.js';
import { emptyState } from '../../ui.js';
import { button, card, fa, faDateTime, field, pageHead } from '../common.js';
import { adminTabs, money, statusChip } from './common.js';

const PROVIDERS = { zarinpal: 'زرین‌پال', mock: 'آزمایشی', manual: 'تمدید مدیر' };

function paymentCard(payment) {
  return el('div.payment-row', {}, [
    el('div.payment-row__main', {}, [
      el('div.row', {}, [
        el('strong', { text: payment.teacherName || 'معلم' }),
        statusChip(payment.status),
        el('span.chip.chip--muted', { text: PROVIDERS[payment.provider] ?? payment.provider }),
      ]),
      el('p', {}, [
        el('strong', { text: `${money(payment.amount)} تومان` }),
        el('span.small.muted', { text: ` · ${payment.planName || 'اشتراک'} · ${fa(payment.days)} روز` }),
      ]),
      el('p.small.muted', {
        text: [
          `ثبت: ${faDateTime(payment.createdAt)}`,
          payment.paidAt ? `پرداخت: ${faDateTime(payment.paidAt)}` : null,
          payment.refId ? `کد پیگیری: ${payment.refId}` : null,
          payment.error ? `خطا: ${payment.error}` : null,
        ].filter(Boolean).join(' · '),
      }),
    ]),
  ]);
}

export async function renderAdminPayments() {
  setTopbarTitle('پرداخت‌ها');
  let search = '';
  let status = '';
  let page = 1;
  const body = el('div');
  renderView([
    pageHead({ icon: '🧾', title: 'پرداخت‌ها', subtitle: 'تاریخچهٔ خرید اشتراک و تمدیدهای دستی' }),
    adminTabs('admin/payments'),
    body,
  ]);

  async function load() {
    body.replaceChildren(el('div.empty', {}, [el('span.empty__icon', { text: '⏳' }), el('p', { text: 'در حال دریافت پرداخت‌ها…' })]));
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

    const searchInput = el('input', { id: 'admin-pay-search', type: 'search', value: search, placeholder: 'نام معلم یا نام کاربری…' });
    const statusSelect = el('select', { id: 'admin-pay-status' }, [
      el('option', { value: '', text: 'همهٔ وضعیت‌ها', selected: status === '' }),
      el('option', { value: 'paid', text: 'پرداخت‌شده', selected: status === 'paid' }),
      el('option', { value: 'pending', text: 'در انتظار', selected: status === 'pending' }),
      el('option', { value: 'failed', text: 'ناموفق', selected: status === 'failed' }),
      el('option', { value: 'canceled', text: 'لغو‌شده', selected: status === 'canceled' }),
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

    const pager = payload.pages > 1
      ? el('div.row', { style: { marginTop: '10px' } }, [
        button('قبلی', { kind: 'ghost', icon: '→', disabled: page <= 1, onClick: () => { page -= 1; void load(); } }),
        el('span.small.muted', { text: `صفحهٔ ${fa(payload.page)} از ${fa(payload.pages)}` }),
        button('بعدی', { kind: 'ghost', icon: '←', disabled: page >= payload.pages, onClick: () => { page += 1; void load(); } }),
      ])
      : null;

    body.replaceChildren(
      card({ title: `پرداخت‌ها (${fa(payload.total ?? 0)})`, icon: '📋' }, [
        form,
        payload.items?.length
          ? el('div.payment-list', {}, payload.items.map(paymentCard))
          : emptyState({ icon: '🧾', title: 'پرداختی با این فیلتر پیدا نشد' }),
        pager,
      ]),
    );
  }

  await load();
  return undefined;
}
