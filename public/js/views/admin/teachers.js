/** Admin teacher list: trials, subscriptions, search and manual renewal. */

import { api } from '../../api.js';
import { el } from '../../dom.js';
import { errorMessage } from '../../format.js';
import { renderView, setTopbarTitle } from '../../shell.js';
import { emptyState, formDialog, notify } from '../../ui.js';
import { button, card, fa, faDate, faDateTime, field, pageHead } from '../common.js';
import { adminTabs, statusChip } from './common.js';

function teacherCard(teacher, onGrant) {
  const access = teacher.subscription ?? { status: 'expired', daysLeft: 0 };
  return el('div.admin-row', {}, [
    el('div.admin-row__main', {}, [
      el('div.row', {}, [
        el('strong', { text: teacher.displayName }),
        statusChip(access.status),
        el('span.small.muted', { text: `@${teacher.username}` }),
      ]),
      el('p.small.muted', {
        text: `${fa(teacher.leagueCount)} لیگ · ${fa(teacher.studentCount)} دانش‌آموز · عضویت از ${faDate(teacher.createdAt)}`,
      }),
      el('p.small.muted', {
        text: [
          teacher.trialEndsAt ? `پایان آزمایشی: ${faDate(teacher.trialEndsAt)}` : null,
          teacher.subscriptionEndsAt ? `پایان اشتراک: ${faDate(teacher.subscriptionEndsAt)}` : null,
          teacher.lastPaidAt ? `آخرین پرداخت: ${faDateTime(teacher.lastPaidAt)}` : 'بدون پرداخت',
        ].filter(Boolean).join(' · '),
      }),
    ]),
    el('div.admin-row__actions', {}, [
      access.daysLeft !== null ? el('span.chip.chip--muted', { text: access.daysLeft === null ? 'نامحدود' : `${fa(access.daysLeft)} روز` }) : el('span.chip.chip--muted', { text: 'نامحدود' }),
      button('تمدید دستی', { kind: 'soft', icon: '➕', onClick: () => onGrant(teacher) }),
    ]),
  ]);
}

export async function renderAdminTeachers() {
  setTopbarTitle('مدیریت معلمان');
  let search = '';
  let status = '';
  const body = el('div');
  renderView([
    pageHead({ icon: '👩‍🏫', title: 'مدیریت معلمان', subtitle: 'دورهٔ آزمایشی، اشتراک و تمدید دستی' }),
    adminTabs('admin/teachers'),
    body,
  ]);

  async function load() {
    body.replaceChildren(el('div.empty', {}, [el('span.empty__icon', { text: '⏳' }), el('p', { text: 'در حال دریافت معلمان…' })]));
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (status) params.set('status', status);
    let payload;
    try {
      payload = await api.get(`/admin/teachers${params.toString() ? `?${params.toString()}` : ''}`);
    } catch (error) {
      body.replaceChildren(emptyState({ icon: '⚠️', title: 'دریافت معلمان ناموفق بود', hint: errorMessage(error) }));
      return;
    }

    const searchInput = el('input', { id: 'admin-teacher-search', type: 'search', value: search, placeholder: 'نام یا نام کاربری…' });
    const statusSelect = el('select', { id: 'admin-teacher-status' }, [
      el('option', { value: '', text: 'همهٔ وضعیت‌ها', selected: status === '' }),
      el('option', { value: 'active', text: 'فعال / نامحدود', selected: status === 'active' }),
      el('option', { value: 'trial', text: 'دورهٔ آزمایشی', selected: status === 'trial' }),
      el('option', { value: 'expired', text: 'منقضی', selected: status === 'expired' }),
    ]);
    const filterForm = el('form.filter-bar', {}, [
      field('جستجو', searchInput),
      field('وضعیت', statusSelect),
      el('div.field', {}, [el('label', { text: ' ' }), button('اعمال فیلتر', { icon: '🔎', type: 'submit' })]),
    ]);
    filterForm.addEventListener('submit', (event) => {
      event.preventDefault();
      search = searchInput.value.trim();
      status = statusSelect.value;
      void load();
    });

    const create = button('ساخت معلم', { icon: '➕', onClick: createTeacher });
    const counts = payload.counts ?? {};
    body.replaceChildren(
      card({
        title: 'فیلتر و ساخت حساب',
        icon: '🔎',
        actions: [create],
      }, [
        filterForm,
        el('div.row', {}, [
          el('span.chip.chip--muted', { text: `کل: ${fa(counts.total ?? 0)}` }),
          el('span.chip.chip--ok', { text: `فعال: ${fa(counts.activeTotal ?? 0)}` }),
          el('span.chip.chip--amber', { text: `آزمایشی: ${fa(counts.trial ?? 0)}` }),
          el('span.chip.chip--bad', { text: `منقضی: ${fa(counts.expired ?? 0)}` }),
        ]),
      ]),
      card({ title: `معلمان (${fa(payload.total ?? 0)})`, icon: '📋' }, [
        payload.items?.length
          ? el('div.admin-list', {}, payload.items.map((teacher) => teacherCard(teacher, grant)))
          : emptyState({ icon: '👩‍🏫', title: 'معلمی با این فیلتر پیدا نشد' }),
      ]),
    );
  }

  async function createTeacher() {
    const values = await formDialog({
      title: 'ساخت حساب معلم',
      description: 'گذرواژه را به معلم تحویل دهید؛ خودش می‌تواند بعداً آن را تغییر دهد.',
      submitLabel: 'ساخت حساب',
      fields: [
        { name: 'displayName', label: 'نام نمایشی', required: true },
        { name: 'username', label: 'نام کاربری', required: true },
        { name: 'password', label: 'گذرواژه', type: 'password', required: true, hint: 'حداقل ۸ نویسه' },
        {
          name: 'trialDays',
          label: 'دورهٔ آزمایشی',
          type: 'select',
          value: '14',
          options: [
            { value: '0', label: 'بدون دورهٔ آزمایشی' },
            { value: '7', label: '۷ روز' },
            { value: '14', label: '۱۴ روز' },
            { value: '30', label: '۳۰ روز' },
            { value: '90', label: '۹۰ روز' },
          ],
        },
      ],
    });
    if (!values) return;
    try {
      await api.post('/admin/teachers', {
        displayName: values.displayName.trim(),
        username: values.username.trim(),
        password: values.password,
        trialDays: Number(values.trialDays),
      });
      notify.ok('حساب معلم ساخته شد');
      await load();
    } catch (error) {
      notify.error(errorMessage(error));
    }
  }

  async function grant(teacher) {
    const values = await formDialog({
      title: `تمدید اشتراک ${teacher.displayName}`,
      description: 'روزها به انتهای اشتراک فعلی اضافه می‌شوند (یا از امروز محاسبه می‌شوند).',
      submitLabel: 'ثبت تمدید',
      fields: [
        { name: 'days', label: 'تعداد روز', type: 'number', min: '1', max: '3650', value: '30', required: true },
        { name: 'note', label: 'یادداشت (اختیاری)', type: 'text', placeholder: 'مثلاً پرداخت نقدی' },
      ],
    });
    if (!values) return;
    try {
      const payload = await api.post(`/admin/teachers/${teacher.id}/subscription`, {
        days: Number(values.days),
        note: values.note.trim(),
      });
      notify.ok(`اشتراک تا ${faDate(payload.subscription.endsAt)} تمدید شد`);
      await load();
    } catch (error) {
      notify.error(errorMessage(error));
    }
  }

  await load();
  return undefined;
}
