/** Homework list with per-student completion tracking. */

import { api } from '../api.js';
import { el } from '../dom.js';
import { errorMessage } from '../format.js';
import { renderView, setLeaguePill, setTopbarTitle } from '../shell.js';
import { setLeagueId } from '../store.js';
import { confirmDialog, emptyState, formDialog, notify, openModal } from '../ui.js';
import { backToWorkbench, button, card, chip, fa, faDate, grid, iconButton, loadingNode, pageHead } from './common.js';

const STATUS_OPTIONS = [
  { value: 'done', label: '✅ انجام شد', chipKind: 'ok' },
  { value: 'not_done', label: '⏳ انجام نشده', chipKind: 'muted' },
  { value: 'incomplete', label: '📝 ناقص', chipKind: 'amber' },
  { value: 'absent', label: '🚫 غایب', chipKind: 'bad' },
  { value: 'not_brought', label: '🎒 نیاورده', chipKind: 'bad' },
];

function statusLabel(status) {
  return STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status;
}

/** Score columns of the class, used by the per-homework column picker. */
function columnOptions(columns, selectedId) {
  return columns.map((column) => ({
    value: column.id,
    label: column.name,
    selected: String(column.id) === String(selectedId),
  }));
}

/** Default column shown in the create dialog: انضباطی, else the first column. */
function defaultColumnId(columns) {
  return columns.find((column) => column.name === 'انضباطی')?.id ?? columns[0]?.id ?? null;
}

function scoringHint(penalty) {
  const fine = Number(penalty) || 0;
  return fine > 0
    ? `انجام‌شده: +امتیاز، غایب: −امتیاز، انجام‌نشده/ناقص/نیاورده: −${fa(fine)} امتیاز`
    : 'انجام‌شده: +امتیاز، غایب: −امتیاز، انجام‌نشده/ناقص/نیاورده: بدون تغییر';
}

function homeworkFields(columns, { item = null, points = 10 } = {}) {
  const selectedColumn = item?.columnId ?? defaultColumnId(columns);
  const penalty = Number(item?.penaltyPoints) || 0;
  return [
    { name: 'title', label: 'عنوان', type: 'text', required: true, placeholder: 'مثلاً تمرین فصل سوم', value: item?.title ?? '' },
    { name: 'description', label: 'توضیح', type: 'textarea', placeholder: 'شرح تکلیف برای دانش‌آموزان', value: item?.description ?? '' },
    { name: 'dueDate', label: 'مهلت (شمسی، اختیاری)', type: 'jalali-date', allowEmpty: true, value: item?.dueDate ?? '' },
    { name: 'points', label: 'امتیاز انجام تکلیف', type: 'number', min: 0, max: 10000, step: 1, value: item?.points ?? points, hint: 'انجام‌شده: +امتیاز، غایب: −امتیاز' },
    {
      name: 'columnId',
      label: 'ستون امتیازی لیگ',
      type: 'select',
      value: selectedColumn ?? '',
      options: columns.length
        ? columnOptions(columns, selectedColumn)
        : [{ value: '', label: 'ستون پیش‌فرض (انضباطی)' }],
      hint: 'امتیاز این تکلیف در ستون انتخاب‌شده ثبت می‌شود؛ تغییر ستون، امتیازهای قبلی را هم منتقل می‌کند.',
    },
    {
      name: 'penaltyEnabled',
      label: 'جریمه برای ناقص / نیاورده / انجام‌نشده',
      type: 'checkbox',
      checked: penalty > 0,
    },
    {
      name: 'penaltyPoints',
      label: 'میزان جریمه (امتیاز)',
      type: 'number',
      min: 0,
      max: 10000,
      step: 1,
      value: penalty,
      hint: 'اگر تیک جریمه خورده باشد، این مقدار از امتیاز دانش‌آموز کم می‌شود.',
    },
  ];
}

function valuesToPayload(values) {
  const penaltyEnabled = Boolean(values.penaltyEnabled);
  return {
    title: values.title.trim(),
    description: values.description.trim(),
    dueDate: values.dueDate || null,
    points: Number(values.points) || 0,
    penaltyPoints: penaltyEnabled ? (Number(values.penaltyPoints) || 0) : 0,
    columnId: values.columnId ? Number(values.columnId) : null,
  };
}

async function createHomework(leagueId, reload, columns) {
  const values = await formDialog({
    title: 'تکلیف جدید',
    submitLabel: 'ثبت تکلیف',
    fields: homeworkFields(columns),
  });
  if (!values) return;
  try {
    await api.post(`/leagues/${leagueId}/homework`, valuesToPayload(values));
    notify.ok('تکلیف ثبت شد');
    reload();
  } catch (error) {
    notify.error(errorMessage(error));
  }
}

async function editHomework(item, reload, columns) {
  const values = await formDialog({
    title: 'ویرایش تکلیف',
    submitLabel: 'ذخیره',
    fields: homeworkFields(columns, { item }),
  });
  if (!values) return;
  try {
    await api.patch(`/homework/${item.id}`, valuesToPayload(values));
    notify.ok('تکلیف ذخیره شد');
    reload();
  } catch (error) {
    notify.error(errorMessage(error));
  }
}

async function deleteHomework(item, reload) {
  const agreed = await confirmDialog({
    title: 'حذف تکلیف',
    message: `تکلیف «${item.title}» و وضعیت انجام آن حذف شود؟ امتیازهای ثبت‌شده‌ی آن هم پس گرفته می‌شود.`,
    confirmLabel: 'حذف',
    danger: true,
  });
  if (!agreed) return;
  try {
    await api.del(`/homework/${item.id}`);
    notify.ok('تکلیف حذف شد');
    reload();
  } catch (error) {
    notify.error(errorMessage(error));
  }
}

async function openStatus(item, reload) {
  const body = el('div', {}, [el('p.small.muted', { text: 'در حال بارگذاری…' })]);
  const modal = openModal({ title: `وضعیت تکلیف: ${item.title}`, body });

  async function refresh() {
    try {
      const payload = await api.get(`/homework/${item.id}/status`);
      const points = payload.homework?.points ?? item.points ?? 0;
      const penalty = payload.homework?.penaltyPoints ?? item.penaltyPoints ?? 0;
      const columnName = payload.homework?.columnName ?? item.columnName ?? '';
      const list = el('div');
      for (const student of payload.items) {
        const select = el('select', { 'aria-label': `وضعیت ${student.name}` });
        for (const option of STATUS_OPTIONS) {
          select.appendChild(el('option', {
            value: option.value,
            text: option.label,
            selected: option.value === student.status,
          }));
        }
        select.addEventListener('change', async () => {
          try {
            await api.post(`/homework/${item.id}/status`, { studentId: student.studentId, status: select.value });
            await refresh();
            reload();
          } catch (error) {
            notify.error(errorMessage(error));
          }
        });
        list.appendChild(el('div.row', { style: { justifyContent: 'space-between', borderBottom: '1px solid var(--line)', padding: '6px 0' } }, [
          el('span', { text: student.name }),
          select,
        ]));
      }
      modal.setContent([
        el('h2.modal__title', { text: `وضعیت تکلیف: ${item.title}` }),
        el('p.small.muted', {
          text: `⭐ ${fa(points)} امتیاز${columnName ? ` در ستون «${columnName}»` : ''} — ${scoringHint(penalty)}`,
        }),
        el('div.row', { style: { flexWrap: 'wrap' } }, STATUS_OPTIONS.map((option) => (
          button(`همه: ${option.label}`, { kind: 'soft', onClick: () => bulk(option.value, refresh, reload) })
        ))),
        list,
      ]);
    } catch (error) {
      modal.setContent([el('h2.modal__title', { text: 'خطا' }), el('p', { text: errorMessage(error) })]);
    }
  }

  async function bulk(status, refresh, reload) {
    try {
      await api.post(`/homework/${item.id}/status/bulk`, { status });
      notify.ok(`وضعیت همه: ${statusLabel(status)} ثبت شد`);
      await refresh();
      reload();
    } catch (error) {
      notify.error(errorMessage(error));
    }
  }

  await refresh();
}

export async function renderHomework({ params }) {
  const leagueId = Number(params.id);
  setLeagueId(leagueId);
  setTopbarTitle('تکالیف');
  const body = el('div', {}, [loadingNode()]);
  renderView([body]);

  async function load() {
    body.replaceChildren(loadingNode());
    let league;
    let payload;
    let columns = [];
    try {
      [league, payload, columns] = await Promise.all([
        api.get(`/leagues/${leagueId}`),
        api.get(`/leagues/${leagueId}/homework`),
        // The column picker is optional: keep the page usable when the
        // teacher has no score permission.
        api.get(`/leagues/${leagueId}/columns`).then((res) => res.items ?? []).catch(() => []),
      ]);
    } catch (error) {
      body.replaceChildren(emptyState({ icon: '⚠️', title: 'دریافت تکالیف ناموفق بود', hint: errorMessage(error) }));
      return;
    }
    setLeaguePill({ name: league.league.name });
    const items = payload.items ?? [];

    const list = el('div');
    if (items.length === 0) {
      list.appendChild(emptyState({ icon: '📚', title: 'هنوز تکلیفی ثبت نشده است', hint: 'با دکمه «تکلیف جدید» شروع کنید.' }));
    }
    for (const item of items) {
      list.appendChild(el('div.timeline-item', {}, [
        el('div', { style: { flex: '1' } }, [
          el('div', {}, [
            el('strong', { text: item.title }),
            item.dueDate ? chip(`مهلت ${faDate(item.dueDate)}`, 'amber') : null,
          ]),
          item.description ? el('div.small.muted', { text: item.description }) : null,
          el('div.row', { style: { gap: '6px', marginTop: '4px' } }, [
            chip(`⭐ ${fa(item.points ?? 0)} امتیاز`, 'muted'),
            chip(`📊 ${item.columnName || 'ستون پیش‌فرض'}`, 'muted'),
            item.penaltyPoints > 0 ? chip(`جریمه ${fa(item.penaltyPoints)} امتیاز`, 'bad') : null,
            chip(`✅ ${fa(item.doneCount)} انجام‌شده`, 'ok'),
            chip(`⏳ ${fa(item.pendingCount)} باقی‌مانده`, 'muted'),
            item.absentCount ? chip(`🚫 ${fa(item.absentCount)} غایب`, 'bad') : null,
            item.incompleteCount ? chip(`📝 ${fa(item.incompleteCount)} ناقص`, 'amber') : null,
            item.notBroughtCount ? chip(`🎒 ${fa(item.notBroughtCount)} نیاورده`, 'bad') : null,
          ]),
        ]),
        el('span.row', { style: { gap: '3px' } }, [
          iconButton('👥', { label: 'وضعیت دانش‌آموزان', kind: 'soft', onClick: () => openStatus(item, load) }),
          iconButton('✏️', { label: 'ویرایش تکلیف', onClick: () => editHomework(item, load, columns) }),
          iconButton('✕', { label: 'حذف تکلیف', danger: true, onClick: () => deleteHomework(item, load) }),
        ]),
      ]));
    }

    body.replaceChildren(
      pageHead({
        icon: '📚',
        title: 'تکالیف',
        subtitle: league.league.name,
        actions: [
          button('تکلیف جدید', { icon: '➕', onClick: () => createHomework(leagueId, load, columns) }),
          el('a.btn.btn--ghost', { href: `#/teacher/league/${leagueId}`, text: '↩️ لیگ' }),
          backToWorkbench(),
        ],
      }),
      grid('grid--stats', [
        el('div.stat', {}, [el('div.stat__value', { text: fa(items.length) }), el('div.stat__label', { text: '📚 تکالیف' })]),
        el('div.stat', {}, [
          el('div.stat__value', { text: fa(items.reduce((acc, item) => acc + item.doneCount, 0)) }),
          el('div.stat__label', { text: '✅ انجام‌شده' }),
        ]),
        el('div.stat', {}, [
          el('div.stat__value', { text: fa(items.reduce((acc, item) => acc + item.pendingCount, 0)) }),
          el('div.stat__label', { text: '⏳ باقی‌مانده' }),
        ]),
      ]),
      card({ title: 'فهرست تکالیف', icon: '📋' }, [list]),
    );
  }

  await load();
  return undefined;
}
