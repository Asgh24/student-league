/**
 * Row and column actions of the individual league table: dialogs, the student
 * profile drawer, championships and column management. Kept apart from the
 * table renderer so each module stays small and has a single focus.
 */

import { api } from '../api.js';
import { el } from '../dom.js';
import { errorMessage } from '../format.js';
import { confirmDialog, formDialog, notify, openModal } from '../ui.js';
import { button, fa, faDateTime } from './common.js';

/** Prompts for a custom point delta; resolves to a number or null. */
export async function askCustomDelta(column) {
  const values = await formDialog({
    title: `امتیاز دلخواه — ${column.name}`,
    submitLabel: 'افزودن به فهرست تغییرات',
    fields: [
      { name: 'delta', label: 'مقدار تغییر (مثبت یا منفی)', type: 'number', value: column.step, required: true },
    ],
  });
  if (!values) return null;
  const delta = Number(values.delta);
  if (!Number.isFinite(delta) || delta === 0 || Math.abs(delta) > 100000) {
    notify.error('مقدار تغییر باید عددی غیرصفر و منطقی باشد');
    return null;
  }
  return Math.trunc(delta);
}

/**
 * One-field quick add used by the inline «نام دانش‌آموز جدید…» row above the
 * scores table. Resolves to `true` when the student was created.
 */
export async function quickAddStudent(leagueId, name, reload) {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) {
    notify.error('نام دانش‌آموز را وارد کنید');
    return false;
  }
  try {
    await api.post(`/leagues/${leagueId}/students`, { name: trimmed });
    notify.ok(`«${trimmed}» افزوده شد`);
    reload();
    return true;
  } catch (error) {
    notify.error(errorMessage(error));
    return false;
  }
}

export async function addStudent(leagueId, reload) {
  const values = await formDialog({
    title: 'افزودن دانش‌آموز',
    description: 'می‌توانید برای دانش‌آموز حساب کاربری بسازید تا کارنامه خود را ببیند.',
    submitLabel: 'افزودن',
    fields: [
      { name: 'name', label: 'نام و نام خانوادگی', type: 'text', required: true },
      { name: 'username', label: 'نام کاربری (اختیاری)', type: 'text', placeholder: 'مثلاً ali.rezaei' },
      { name: 'password', label: 'گذرواژه (اختیاری)', type: 'text', placeholder: 'حداقل ۶ نویسه' },
    ],
  });
  if (!values) return;
  const body = { name: values.name.trim() };
  const username = values.username.trim();
  const password = values.password.trim();
  if (username || password) {
    if (username.length < 3) {
      notify.error('نام کاربری باید حداقل ۳ نویسه باشد');
      return;
    }
    if (password.length < 6) {
      notify.error('گذرواژه باید حداقل ۶ نویسه باشد');
      return;
    }
    body.username = username;
    body.password = password;
  }
  try {
    await api.post(`/leagues/${leagueId}/students`, body);
    notify.ok('دانش‌آموز افزوده شد');
    reload();
  } catch (error) {
    notify.error(errorMessage(error));
  }
}

export async function editStudent(row, reload) {
  const values = await formDialog({
    title: 'ویرایش نام دانش‌آموز',
    submitLabel: 'ذخیره',
    fields: [{ name: 'name', label: 'نام', type: 'text', value: row.name, required: true }],
  });
  if (!values) return;
  try {
    await api.patch(`/students/${row.id}`, { name: values.name.trim() });
    notify.ok('نام ذخیره شد');
    reload();
  } catch (error) {
    notify.error(errorMessage(error));
  }
}

export async function deleteStudent(row, reload) {
  const agreed = await confirmDialog({
    title: 'حذف دانش‌آموز',
    message: `«${row.name}» و همه امتیازها و تاریخچه او حذف می‌شود. ادامه می‌دهید؟`,
    confirmLabel: 'حذف',
    danger: true,
  });
  if (!agreed) return;
  try {
    await api.del(`/students/${row.id}`);
    notify.ok('دانش‌آموز حذف شد');
    reload();
  } catch (error) {
    notify.error(errorMessage(error));
  }
}

export async function addChampionship(row, reload) {
  const values = await formDialog({
    title: 'ثبت قهرمانی',
    submitLabel: 'ثبت مدال',
    fields: [
      { name: 'title', label: 'عنوان', type: 'text', value: 'قهرمانی', required: true },
      { name: 'rank', label: 'رتبه', type: 'number', value: 1, min: 1, max: 10, required: true },
    ],
  });
  if (!values) return;
  try {
    await api.post(`/students/${row.id}/championships`, { title: values.title.trim(), rank: Number(values.rank) || 1 });
    notify.ok('عنوان و مدال ثبت شد');
    reload();
  } catch (error) {
    notify.error(errorMessage(error));
  }
}

export async function removeChampionship(row, reload) {
  const agreed = await confirmDialog({
    title: 'حذف قهرمانی',
    message: `آخرین مدال «${row.name}» حذف شود؟`,
    confirmLabel: 'حذف',
    danger: true,
  });
  if (!agreed) return;
  try {
    await api.del(`/students/${row.id}/championships`);
    notify.ok('مدال حذف شد');
    reload();
  } catch (error) {
    notify.error(errorMessage(error));
  }
}

export async function recordWithReason(row, columns, leagueId, reload) {
  if (columns.length === 0) {
    notify.error('ابتدا یک ستون امتیاز بسازید');
    return;
  }
  const values = await formDialog({
    title: `ثبت امتیاز با دلیل — ${row.name}`,
    submitLabel: 'ثبت',
    fields: [
      {
        name: 'columnId',
        label: 'ستون',
        type: 'select',
        value: columns[0].id,
        options: columns.map((column) => ({ value: column.id, label: `${column.name} (گام ${column.step})` })),
      },
      { name: 'delta', label: 'مقدار تغییر', type: 'number', value: columns[0].step, required: true },
      { name: 'reason', label: 'دلیل', type: 'text', placeholder: 'مثلاً پاسخ درست به سؤال کلاس' },
    ],
  });
  if (!values) return;
  const delta = Number(values.delta);
  if (!Number.isFinite(delta) || delta === 0) {
    notify.error('مقدار تغییر باید عددی غیرصفر باشد');
    return;
  }
  try {
    await api.post(`/leagues/${leagueId}/scores/record`, {
      studentId: row.id,
      columnId: Number(values.columnId),
      delta: Math.trunc(delta),
      reason: values.reason.trim(),
    });
    notify.ok('امتیاز با دلیل ثبت شد');
    reload();
  } catch (error) {
    notify.error(errorMessage(error));
  }
}

async function changeStudentPassword(row) {
  const values = await formDialog({
    title: `تغییر گذرواژه — ${row.name}`,
    description: 'گذرواژهٔ جدید را معلم تعیین می‌کند. گذرواژهٔ فارسی (مثلاً «رمزمن») هم پذیرفته می‌شود.',
    submitLabel: 'ذخیره گذرواژه',
    fields: [
      { name: 'password', label: 'گذرواژه جدید', type: 'text', required: true, placeholder: 'حداقل ۶ نویسه' },
    ],
  });
  if (!values) return;
  const password = values.password.trim();
  if (password.length < 6) {
    notify.error('گذرواژه باید حداقل ۶ نویسه باشد');
    return;
  }
  try {
    await api.post(`/students/${row.id}/password`, { password });
    notify.ok('گذرواژه دانش‌آموز تغییر کرد');
  } catch (error) {
    notify.error(errorMessage(error));
  }
}

export async function showProfile(row, { columns = [], leagueId = null, reload = () => {} } = {}) {
  const body = el('div', {}, [el('p.small.muted', { text: 'در حال بارگذاری…' })]);
  const modal = openModal({ title: `پرونده ${row.name}`, body });
  try {
    const payload = await api.get(`/students/${row.id}`);
    const student = payload.student;
    const info = el('div');
    const rows = [
      ['امتیاز کل', fa(student.total)],
      ['رتبه', `${fa(student.rank)} از ${fa(student.totalStudents)}`],
      ['عنوان', `${student.title?.icon ?? ''} ${student.title?.title ?? ''}`],
      ['حضور', student.recorded ? `${fa(student.attended)} از ${fa(student.recorded)} روز` : 'بدون ثبت'],
      ['تیم', student.team ? student.team.name : 'بدون تیم'],
      ['حساب کاربری', student.hasLogin ? 'دارد' : 'ندارد'],
    ];
    for (const [label, value] of rows) {
      info.appendChild(el('p', {}, [el('strong', { text: `${label}: ` }), el('span', { text: value })]));
    }

    const table = el('table.grid-table');
    const tbody = el('tbody');
    for (const item of student.reportCard) {
      tbody.appendChild(el('tr', {}, [
        el('td.name-cell', { text: item.name }),
        el('td.total-cell', { text: fa(item.value) }),
      ]));
    }
    table.appendChild(tbody);

    const history = el('div', { style: { marginTop: '10px' } });
    history.appendChild(el('h3', { text: 'آخرین تغییرات' }));
    if (student.history.length === 0) history.appendChild(el('p.muted.small', { text: 'تاریخچه‌ای ثبت نشده است.' }));
    for (const item of student.history.slice(0, 10)) {
      history.appendChild(el('div.timeline-item', {}, [
        el(`span.timeline-item__delta${item.delta < 0 ? '.is-negative' : '.is-positive'}`, {
          text: `${item.delta > 0 ? '+' : '−'}${fa(Math.abs(item.delta))}`,
        }),
        el('div', {}, [
          el('div', { text: item.columnName }),
          el('div.small.muted', { text: `${item.reason || 'بدون دلیل'} · ${faDateTime(item.createdAt)}` }),
        ]),
      ]));
    }

    // Student-level operations live here instead of on every row, which keeps
    // the league table narrow. The dialog closes first so its focus trap does
    // not fight with the dialog the action opens.
    const actions = el('div', { style: { marginTop: '12px' } }, [
      el('h3', { text: 'اقدام‌ها' }),
      el('div.row', { style: { flexWrap: 'wrap', gap: '8px' } }, [
        button('ویرایش نام', { kind: 'ghost', icon: '✏️', onClick: () => { modal.close(); editStudent(row, reload); } }),
        button('افزودن قهرمانی', { kind: 'ghost', icon: '🏆', onClick: () => { modal.close(); addChampionship(row, reload); } }),
        button('حذف آخرین قهرمانی', { kind: 'ghost', icon: '🎗️', onClick: () => { modal.close(); removeChampionship(row, reload); } }),
        button('ثبت امتیاز با دلیل', { kind: 'ghost', icon: '📝', onClick: () => { modal.close(); recordWithReason(row, columns, leagueId, reload); } }),
        student.hasLogin
          ? button('تغییر گذرواژه', { kind: 'ghost', icon: '🔑', onClick: () => { modal.close(); changeStudentPassword(row); } })
          : null,
        button('حذف دانش‌آموز', { kind: 'danger', icon: '✕', onClick: () => { modal.close(); deleteStudent(row, reload); } }),
      ]),
    ]);

    modal.setContent([
      el('h2.modal__title', { text: `پرونده ${row.name}` }),
      info,
      el('div.table-wrap', {}, [table]),
      history,
      actions,
    ]);
  } catch (error) {
    modal.setContent([el('h2.modal__title', { text: `پرونده ${row.name}` }), el('p', { text: errorMessage(error) })]);
  }
}

/* ------------------------------------------------------------------ columns */

export async function addColumn(leagueId, reload) {
  const values = await formDialog({
    title: 'افزودن ستون امتیاز',
    submitLabel: 'افزودن ستون',
    fields: [
      { name: 'name', label: 'نام ستون', type: 'text', required: true, placeholder: 'مثلاً ورزش' },
      { name: 'step', label: 'گام امتیاز', type: 'number', value: 25, min: 1, max: 1000, required: true },
    ],
  });
  if (!values) return;
  try {
    await api.post(`/leagues/${leagueId}/columns`, { name: values.name.trim(), step: Number(values.step) || 25 });
    notify.ok('ستون افزوده شد');
    reload();
  } catch (error) {
    notify.error(errorMessage(error));
  }
}

export async function editColumn(column, reload) {
  const values = await formDialog({
    title: `ویرایش ستون «${column.name}»`,
    submitLabel: 'ذخیره',
    fields: [
      { name: 'name', label: 'نام ستون', type: 'text', value: column.name, required: true },
      { name: 'step', label: 'گام امتیاز', type: 'number', value: column.step, min: 1, max: 1000, required: true },
    ],
  });
  if (!values) return;
  try {
    await api.patch(`/columns/${column.id}`, { name: values.name.trim(), step: Number(values.step) || column.step });
    notify.ok('ستون ذخیره شد');
    reload();
  } catch (error) {
    notify.error(errorMessage(error));
  }
}

export async function deleteColumn(leagueId, column, reload) {
  const values = await formDialog({
    title: `حذف ستون «${column.name}»`,
    description: 'امتیازهای این ستون می‌توانند به ستون بعدی منتقل شوند یا کامل حذف شوند.',
    submitLabel: 'حذف ستون',
    fields: [
      {
        name: 'mode',
        label: 'سرنوشت امتیازها',
        type: 'select',
        value: 'keep',
        options: [
          { value: 'keep', label: 'انتقال امتیازها به ستون بعدی (حفظ امتیاز کل)' },
          { value: 'discard', label: 'حذف امتیازهای این ستون' },
        ],
      },
    ],
  });
  if (!values) return;
  try {
    await api.del(`/leagues/${leagueId}/columns/${column.id}?mode=${encodeURIComponent(values.mode)}`);
    notify.ok('ستون حذف شد');
    reload();
  } catch (error) {
    notify.error(errorMessage(error));
  }
}
