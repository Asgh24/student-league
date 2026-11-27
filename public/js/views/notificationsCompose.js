/** Compose page for teachers (a league notice) and the site management (broadcast). */

import { api } from '../api.js';
import { el } from '../dom.js';
import { errorMessage } from '../format.js';
import { refreshNotificationsBadge } from '../notifications.js';
import { renderView, setTopbarTitle } from '../shell.js';
import { isAdmin, state } from '../store.js';
import { emptyState, notify } from '../ui.js';
import { button, card, chip, fa, faDateTime, field, loadingNode, pageHead } from './common.js';

const CATEGORY_OPTIONS = [
  ['info', '📢 اطلاعیه'],
  ['success', '✅ خبر خوب'],
  ['warning', '⚠️ هشدار'],
  ['urgent', '🚨 فوری'],
];

function radioGroup(name, options) {
  const inputs = new Map();
  const host = el('div.notif-audience');
  for (const option of options) {
    const input = el('input', {
      type: 'radio',
      name,
      value: option.value,
      checked: option.checked === true,
    });
    inputs.set(option.value, input);
    host.appendChild(el('label.radio', {}, [
      input,
      el('span', {}, [
        el('span', { text: option.label }),
        option.hint ? el('span.muted.small', { text: option.hint }) : null,
      ]),
    ]));
  }
  return {
    node: host,
    inputs,
    value: () => [...inputs.entries()].find(([, input]) => input.checked)?.[0] ?? options[0].value,
  };
}

function studentPicker(students) {
  const host = el('div.notif-picker');
  const boxes = new Map();
  if (students.length === 0) {
    host.appendChild(el('p.muted.small', { text: 'هنوز دانش‌آموزی در این لیگ ثبت نشده است.' }));
    return { node: host, selectedIds: () => [] };
  }
  for (const student of students) {
    const box = el('input', { type: 'checkbox', value: String(student.id) });
    boxes.set(student.id, box);
    host.appendChild(el('label.notif-picker__row', {}, [
      box,
      el('span.notif-picker__name', { text: student.name }),
      el('span.row', {}, [
        student.hasLogin ? chip('حساب کاربری', 'ok') : chip('بدون حساب', 'muted'),
        student.hasParentPhone ? chip('شماره والد', 'amber') : null,
      ]),
    ]));
  }
  return {
    node: host,
    selectedIds: () => [...boxes.entries()].filter(([, box]) => box.checked).map(([id]) => id),
  };
}

function sentRow(item) {
  const row = el('article.notif-sent');
  row.appendChild(el('div.notif-sent__head', {}, [
    el('strong', { text: item.title }),
    chip(item.audienceLabel ?? ''),
    item.sms ? chip('📱 پیامک', 'amber') : null,
  ]));
  row.appendChild(el('div.notif-sent__meta', {}, [
    el('span', { text: faDateTime(item.createdAt) }),
    el('span', { text: `گیرندگان: ${fa(item.recipientCount)}` }),
    el('span', { text: `خوانده‌شده: ${fa(item.readCount)}` }),
  ]));
  if (item.sms) {
    row.appendChild(el('div.notif-sent__meta', {}, [
      el('span', {
        text: `پیامک — ارسال: ${fa(item.sms.sent ?? 0)} · صف: ${fa(item.sms.queued ?? 0)} · ناموفق: ${fa(item.sms.failed ?? 0)} · بدون شماره: ${fa(item.sms.skipped ?? 0)}`,
      }),
    ]));
  }
  return row;
}

export function renderNotificationsCompose() {
  const admin = isAdmin();
  setTopbarTitle(admin ? 'ارسال اعلان همگانی' : 'ارسال اعلان');

  const backHref = admin ? 'admin/notifications' : 'teacher/notifications';
  const head = pageHead({
    icon: '✍️',
    title: admin ? 'ارسال اعلان همگانی' : 'ارسال اعلان به دانش‌آموزان',
    subtitle: admin
      ? 'یک اطلاعیه برای همه کاربران سایت یا یک گروه از آن‌ها بفرستید'
      : 'دانش‌آموزان لیگ فعال، در صندوق اعلان‌های خود پیام شما را می‌بینند',
    actions: [el(`a.btn.btn--ghost`, { href: `#/${backHref}`, text: '↩️ صندوق اعلان‌ها' })],
  });

  const sentHost = el('div.notif-sent-list');
  const leagueId = Number(state.leagueId);

  if (!admin && (!Number.isInteger(leagueId) || leagueId <= 0)) {
    renderView([
      head,
      emptyState({
        icon: '🏆',
        title: 'ابتدا یک لیگ را باز کنید',
        hint: 'اعلان معلم به دانش‌آموزان یک لیگ فرستاده می‌شود؛ از میزکار یکی از لیگ‌ها را انتخاب کنید.',
      }),
    ]);
    return undefined;
  }

  const titleInput = el('input', { id: 'notif-title', maxlength: '120', placeholder: 'مثلاً: آزمون ریاضی فردا' });
  const bodyInput = el('textarea', { id: 'notif-body', rows: '5', maxlength: '2000', placeholder: 'متن کامل اعلان…' });
  const categorySelect = el('select', { id: 'notif-category' }, CATEGORY_OPTIONS.map(([value, label]) => el('option', { value, text: label })));
  const linkInput = el('input', { id: 'notif-link', maxlength: '200', placeholder: 'teacher/league/12/homework (اختیاری)' });
  const pinnedBox = el('input', { id: 'notif-pinned', type: 'checkbox' });
  const statusHost = el('div.notif-status');

  const audience = admin
    ? radioGroup('notif-audience', [
      { value: 'all', label: 'همه کاربران سایت', checked: true, hint: 'معلمان، دانش‌آموزان و همیاران' },
      { value: 'teachers', label: 'فقط معلمان' },
      { value: 'students', label: 'فقط دانش‌آموزان' },
    ])
    : radioGroup('notif-audience', [
      { value: 'all', label: 'همه دانش‌آموزان این لیگ', checked: true },
      { value: 'selected', label: 'دانش‌آموزان انتخابی' },
    ]);

  const pickerHost = el('div');
  let picker = null;
  const smsBox = el('input', { id: 'notif-sms', type: 'checkbox' });

  const form = el('form.notif-form', { novalidate: 'true' });
  form.appendChild(field('عنوان اعلان', titleInput));
  form.appendChild(field('متن اعلان', bodyInput));
  form.appendChild(field('نوع اعلان', categorySelect));
  form.appendChild(field(
    'گیرندگان',
    audience.node,
    admin ? '' : 'فقط دانش‌آموزانی که حساب کاربری دارند اعلان درون‌سایتی می‌گیرند.',
  ));

  if (!admin) {
    pickerHost.hidden = true;
    form.appendChild(pickerHost);
    form.appendChild(el('label.checkbox', {}, [
      smsBox,
      el('span', { text: 'همین متن برای والدینِ دارای شماره، پیامک هم بشود' }),
    ]));
    form.appendChild(el('p.muted.small', {
      text: 'پیامک از حساب sms.ir همین معلم ارسال می‌شود. والدین بدون حساب کاربری فقط از این راه مطلع می‌شوند.',
    }));
  }

  form.appendChild(field('لینک داخلی (اختیاری)', linkInput, 'مثلاً صفحه تکالیف یا کارنامه؛ با کلیک روی اعلان باز می‌شود.'));
  form.appendChild(el('label.checkbox', {}, [pinnedBox, el('span', { text: 'سنجاق‌کردن اعلان در بالای صندوق' })]));
  form.appendChild(statusHost);

  const submit = button('ارسال اعلان', { icon: '📨', kind: 'primary', type: 'submit' });
  form.appendChild(el('div.row', {}, [submit]));

  function syncAudience() {
    const value = audience.value();
    if (!admin) pickerHost.hidden = value !== 'selected';
  }
  for (const input of audience.inputs.values()) input.addEventListener('change', syncAudience);
  syncAudience();

  async function loadAudience() {
    if (admin) return;
    pickerHost.replaceChildren(loadingNode('در حال دریافت دانش‌آموزان…'));
    try {
      const payload = await api.get(`/leagues/${leagueId}/notifications/audience`);
      picker = studentPicker(payload?.students ?? []);
      pickerHost.replaceChildren(picker.node);
      const counts = payload?.counts ?? {};
      form.insertBefore(el('p.muted.small', {
        text: `${fa(counts.students ?? 0)} دانش‌آموز؛ ${fa(counts.withLogin ?? 0)} دارای حساب کاربری و ${fa(counts.withParentPhone ?? 0)} دارای شماره والد.`,
      }), pickerHost);
    } catch (error) {
      pickerHost.replaceChildren(emptyState({ icon: '⚠️', title: 'دریافت فهرست دانش‌آموزان ناموفق بود', hint: errorMessage(error) }));
    }
  }

  async function loadSent() {
    sentHost.replaceChildren(loadingNode());
    try {
      const path = admin ? '/admin/notifications' : `/leagues/${leagueId}/notifications`;
      const payload = await api.get(path);
      const items = payload?.items ?? [];
      if (items.length === 0) {
        sentHost.replaceChildren(el('p.muted.small', { text: 'هنوز اعلانی از این بخش ارسال نشده است.' }));
        return;
      }
      sentHost.replaceChildren(...items.map(sentRow));
    } catch (error) {
      sentHost.replaceChildren(emptyState({ icon: '⚠️', title: 'دریافت تاریخچه ارسال ناموفق بود', hint: errorMessage(error) }));
    }
  }

  async function submitForm() {
    const payload = {
      title: titleInput.value.trim(),
      body: bodyInput.value.trim(),
      category: categorySelect.value,
      audience: audience.value(),
      link: linkInput.value.trim(),
      pinned: pinnedBox.checked,
    };
    if (payload.title.length < 2) {
      notify.error('عنوان اعلان را وارد کنید');
      titleInput.focus();
      return;
    }
    if (payload.body.length < 2) {
      notify.error('متن اعلان را وارد کنید');
      bodyInput.focus();
      return;
    }
    if (!admin) {
      payload.studentIds = picker ? picker.selectedIds() : [];
      payload.sendSms = smsBox.checked;
      if (payload.audience === 'selected' && payload.studentIds.length === 0) {
        notify.error('حداقل یک دانش‌آموز انتخاب کنید');
        return;
      }
    }

    submit.disabled = true;
    statusHost.replaceChildren();
    try {
      const path = admin ? '/admin/notifications' : `/leagues/${leagueId}/notifications`;
      const result = await api.post(path, payload);
      const recipients = result?.recipients ?? {};
      const lines = [];
      if (admin) lines.push(`برای ${fa(recipients.users ?? 0)} کاربر ارسال شد`);
      else lines.push(`برای ${fa(recipients.accounts ?? 0)} حساب دانش‌آموزی ثبت شد`);
      if (result?.sms) {
        lines.push(`پیامک — ارسال: ${fa(result.sms.sent ?? 0)} · صف: ${fa(result.sms.queued ?? 0)} · ناموفق: ${fa(result.sms.failed ?? 0)}`);
      }
      statusHost.appendChild(el('div.notif-status__ok', { text: `✅ ${lines.join(' — ')}` }));
      notify.ok('اعلان ارسال شد');
      bodyInput.value = '';
      linkInput.value = '';
      await refreshNotificationsBadge();
      await loadSent();
    } catch (error) {
      statusHost.appendChild(el('div.notif-status__bad', { text: errorMessage(error) }));
      notify.error(errorMessage(error));
    } finally {
      submit.disabled = false;
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void submitForm();
  });

  const formCard = card({ title: admin ? 'اطلاعیه همگانی' : 'اعلان جدید', icon: '🔔' }, [form]);
  const historyCard = card({ title: 'ارسال‌های اخیر', icon: '🗂️' }, [sentHost]);

  renderView([head, el('div.grid.grid--two', {}, [formCard, historyCard])]);
  void loadAudience();
  void loadSent();
  return undefined;
}
