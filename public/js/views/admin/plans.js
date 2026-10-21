/** Admin-editable subscription plans. */

import { api } from '../../api.js';
import { el } from '../../dom.js';
import { errorMessage } from '../../format.js';
import { renderView, setTopbarTitle } from '../../shell.js';
import { confirmDialog, emptyState, formDialog, notify } from '../../ui.js';
import { button, card, fa, pageHead } from '../common.js';
import { adminTabs, money } from './common.js';

function planCard(plan, { edit, toggle, remove }) {
  return el(`div.admin-row${plan.active ? '' : '.is-muted'}`, {}, [
    el('div.admin-row__main', {}, [
      el('div.row', {}, [
        el('strong', { text: plan.name }),
        el(`span.chip.chip--${plan.active ? 'ok' : 'muted'}`, { text: plan.active ? 'فعال' : 'غیرفعال' }),
      ]),
      el('p', {}, [
        el('strong', { text: `${money(plan.price)} تومان` }),
        el('span.small.muted', { text: ` · ${fa(plan.days)} روز` }),
      ]),
      plan.description ? el('p.small.muted', { text: plan.description }) : null,
      el('p.small.muted', { text: `ترتیب نمایش: ${fa(plan.sortOrder)}` }),
    ]),
    el('div.admin-row__actions', {}, [
      button('ویرایش', { kind: 'ghost', icon: '✏️', onClick: () => edit(plan) }),
      button(plan.active ? 'غیرفعال' : 'فعال', { kind: plan.active ? 'ghost' : 'soft', icon: plan.active ? '⏸️' : '▶️', onClick: () => toggle(plan) }),
      button('حذف', { kind: 'danger', icon: '🗑️', onClick: () => remove(plan) }),
    ]),
  ]);
}

export async function renderAdminPlans() {
  setTopbarTitle('طرح‌های اشتراک');
  const body = el('div');
  renderView([
    pageHead({ icon: '🛍️', title: 'طرح‌های اشتراک', subtitle: 'قیمت و مدت هر طرح را آزادانه تغییر دهید' }),
    adminTabs('admin/plans'),
    body,
  ]);

  async function load() {
    body.replaceChildren(el('div.empty', {}, [el('span.empty__icon', { text: '⏳' }), el('p', { text: 'در حال دریافت طرح‌ها…' })]));
    let payload;
    try {
      payload = await api.get('/admin/plans');
    } catch (error) {
      body.replaceChildren(emptyState({ icon: '⚠️', title: 'دریافت طرح‌ها ناموفق بود', hint: errorMessage(error) }));
      return;
    }
    body.replaceChildren(card({
      title: `طرح‌ها (${fa(payload.items?.length ?? 0)})`,
      icon: '🏷️',
      actions: [button('طرح جدید', { icon: '➕', onClick: create })],
    }, [
      el('p.small.muted', { text: 'مبالغ به تومان ذخیره می‌شوند. خرید فقط برای طرح‌های فعال ممکن است.' }),
      payload.items?.length
        ? el('div.admin-list', {}, payload.items.map((plan) => planCard(plan, { edit, toggle, remove })))
        : emptyState({ icon: '🏷️', title: 'هنوز طرحی ساخته نشده است' }),
    ]));
  }

  function fields(plan = {}) {
    return [
      { name: 'name', label: 'نام طرح', required: true, value: plan.name ?? '' },
      { name: 'days', label: 'مدت (روز)', type: 'number', min: '1', max: '3650', required: true, value: String(plan.days ?? 30) },
      { name: 'price', label: 'قیمت (تومان)', type: 'number', min: '0', required: true, value: String(plan.price ?? 0) },
      { name: 'description', label: 'توضیح', type: 'textarea', value: plan.description ?? '' },
      {
        name: 'active',
        label: 'وضعیت',
        type: 'select',
        value: plan.active === false ? '0' : '1',
        options: [{ value: '1', label: 'فعال' }, { value: '0', label: 'غیرفعال' }],
      },
      { name: 'sortOrder', label: 'ترتیب نمایش', type: 'number', min: '0', max: '999', value: String(plan.sortOrder ?? 0) },
    ];
  }

  async function create() {
    const values = await formDialog({ title: 'طرح اشتراک جدید', submitLabel: 'ساخت طرح', fields: fields() });
    if (!values) return;
    try {
      await api.post('/admin/plans', {
        name: values.name.trim(),
        days: Number(values.days),
        price: Number(values.price),
        description: values.description.trim(),
        active: values.active === '1',
        sortOrder: Number(values.sortOrder),
      });
      notify.ok('طرح ساخته شد');
      await load();
    } catch (error) {
      notify.error(errorMessage(error));
    }
  }

  async function edit(plan) {
    const values = await formDialog({ title: `ویرایش ${plan.name}`, submitLabel: 'ذخیره', fields: fields(plan) });
    if (!values) return;
    try {
      await api.patch(`/admin/plans/${plan.id}`, {
        name: values.name.trim(),
        days: Number(values.days),
        price: Number(values.price),
        description: values.description.trim(),
        active: values.active === '1',
        sortOrder: Number(values.sortOrder),
      });
      notify.ok('طرح به‌روزرسانی شد');
      await load();
    } catch (error) {
      notify.error(errorMessage(error));
    }
  }

  async function toggle(plan) {
    try {
      await api.patch(`/admin/plans/${plan.id}`, { active: !plan.active });
      notify.ok(plan.active ? 'طرح غیرفعال شد' : 'طرح فعال شد');
      await load();
    } catch (error) {
      notify.error(errorMessage(error));
    }
  }

  async function remove(plan) {
    const agreed = await confirmDialog({
      title: 'حذف طرح',
      message: `طرح «${plan.name}» از فروشگاه حذف (غیرفعال) می‌شود. پرداخت‌های قبلی دست‌نخورده می‌مانند.`,
      confirmLabel: 'حذف طرح',
      danger: true,
    });
    if (!agreed) return;
    try {
      await api.del(`/admin/plans/${plan.id}`);
      notify.ok('طرح غیرفعال شد');
      await load();
    } catch (error) {
      notify.error(errorMessage(error));
    }
  }

  await load();
  return undefined;
}
