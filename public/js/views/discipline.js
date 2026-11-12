/** Independent daily discipline sheet with bulk actions, reasons and history. */

import { api } from '../api.js';
import { el } from '../dom.js';
import { errorMessage } from '../format.js';
import { renderView, setLeaguePill, setTopbarTitle } from '../shell.js';
import { setLeagueId } from '../store.js';
import { emptyState, notify } from '../ui.js';
import { backToWorkbench, button, card, chip, fa, faDate, grid, loadingNode, pageHead, statCard } from './common.js';

const STATUS_LABELS = { orderly: 'منظم', disorderly: 'بی‌نظمی' };
const STATUS_KIND = { orderly: 'ok', disorderly: 'bad' };

function shiftIso(iso, days) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function ratioChip(orderly, recorded) {
  if (!recorded) return el('span.chip.chip--muted', { text: 'بدون ثبت' });
  const percent = Math.round((orderly / recorded) * 100);
  const kind = percent >= 90 ? 'ok' : percent >= 70 ? 'amber' : 'bad';
  return el(`span.chip.chip--${kind}`, { text: `نظم ${fa(percent)}٪` });
}

function statusButtons(student, onSet) {
  const row = el('span.row', { style: { gap: '4px', justifyContent: 'center', flexWrap: 'wrap' } });
  for (const status of ['orderly', 'disorderly']) {
    const active = student.status === status;
    row.appendChild(el(`button.chip.chip--button${active ? `.chip--${STATUS_KIND[status]}` : ''}`, {
      type: 'button',
      text: STATUS_LABELS[status],
      'aria-pressed': active ? 'true' : 'false',
      title: `${student.name} — ${STATUS_LABELS[status]}`,
      onclick: () => onSet(student.studentId, status),
    }));
  }
  if (student.status) {
    row.appendChild(el('button.chip.chip--button.chip--muted', {
      type: 'button',
      text: 'پاک',
      title: `حذف وضعیت انضباط ${student.name}`,
      onclick: () => onSet(student.studentId, null),
    }));
  }
  return el('td', {}, [row]);
}

function noteInput(student, onNote) {
  return el('input', {
    type: 'text',
    value: student.note ?? '',
    maxLength: 500,
    placeholder: student.status ? 'علت یا توضیح (اختیاری)' : 'ابتدا وضعیت را انتخاب کنید',
    disabled: student.status ? undefined : true,
    'aria-label': `علت انضباط ${student.name}`,
    onchange: (event) => onNote(student.studentId, event.target.value),
  });
}

function sheetTable(items, onSet, onNote) {
  const table = el('table.grid-table');
  table.appendChild(el('thead', {}, [
    el('tr', {}, [
      el('th', { text: '#' }),
      el('th', { text: 'دانش‌آموز' }),
      el('th', { text: 'نسبت نظم' }),
      el('th', { text: 'وضعیت' }),
      el('th', { text: 'علت / توضیح' }),
    ]),
  ]));
  const tbody = el('tbody');
  items.forEach((student, index) => {
    tbody.appendChild(el('tr', {}, [
      el('td', { text: fa(index + 1) }),
      el('td.name-cell', {}, [
        el('strong', { text: student.name }),
        student.status ? chip(STATUS_LABELS[student.status], STATUS_KIND[student.status]) : chip('ثبت‌نشده', 'muted'),
      ]),
      el('td', {}, [ratioChip(student.orderly, student.recorded)]),
      statusButtons(student, onSet),
      el('td', {}, [noteInput(student, onNote)]),
    ]));
  });
  table.appendChild(tbody);
  return el('div.table-wrap', {}, [table]);
}

function historyCard(history) {
  if (!history.length) return card({ title: 'تاریخچه انضباط', icon: '🗂️' }, [el('p.small.muted', { text: 'هنوز انضباطی ثبت نشده است.' })]);
  const table = el('table.grid-table');
  table.appendChild(el('thead', {}, [
    el('tr', {}, [
      el('th', { text: 'تاریخ' }),
      el('th', { text: 'منظم' }),
      el('th', { text: 'بی‌نظمی' }),
      el('th', { text: 'کل' }),
    ]),
  ]));
  const tbody = el('tbody');
  for (const row of history) {
    tbody.appendChild(el('tr', {}, [
      el('td', { text: faDate(row.day) }),
      el('td', { text: fa(row.orderly) }),
      el('td', { text: fa(row.disorderly) }),
      el('td', { text: fa(row.total) }),
    ]));
  }
  table.appendChild(tbody);
  return card({ title: 'تاریخچه انضباط', icon: '🗂️' }, [el('div.table-wrap', {}, [table])]);
}

export async function renderDiscipline({ params }) {
  const leagueId = Number(params.id);
  setLeagueId(leagueId);
  setTopbarTitle('انضباط');
  const body = el('div', {}, [loadingNode()]);
  renderView([body]);

  let day = null;

  async function load() {
    body.replaceChildren(loadingNode());
    let league;
    let sheet;
    let history;
    try {
      const query = day ? `?date=${encodeURIComponent(day)}` : '';
      [league, sheet, history] = await Promise.all([
        api.get(`/leagues/${leagueId}`),
        api.get(`/leagues/${leagueId}/discipline${query}`),
        api.get(`/leagues/${leagueId}/discipline/history?limit=30`),
      ]);
    } catch (error) {
      body.replaceChildren(emptyState({ icon: '⚠️', title: 'دریافت برگه انضباط ناموفق بود', hint: errorMessage(error) }));
      return;
    }
    setLeaguePill({ name: league.league.name });
    day = sheet.date;

    async function save(record) {
      try {
        await api.post(`/leagues/${leagueId}/discipline`, { date: day, records: [record] });
        await load();
      } catch (error) {
        notify.error(errorMessage(error));
      }
    }

    const setStatus = (studentId, status) => save({ studentId, status });
    const setNote = (studentId, note) => {
      const student = sheet.items.find((item) => item.studentId === studentId);
      if (!student?.status) return;
      return save({ studentId, status: student.status, note });
    };

    async function bulk(status) {
      try {
        await api.post(`/leagues/${leagueId}/discipline/bulk`, { date: day, status });
        notify.ok(`وضعیت «${STATUS_LABELS[status]}» برای همه دانش‌آموزان ثبت شد`);
        await load();
      } catch (error) {
        notify.error(errorMessage(error));
      }
    }

    const dateInput = el('input', {
      type: 'date',
      value: day,
      id: 'discipline-date',
      onchange: (event) => {
        day = event.target.value || day;
        void load();
      },
    });

    body.replaceChildren(
      pageHead({
        icon: '📏',
        title: 'انضباط',
        subtitle: league.league.name,
        actions: [
          el('a.btn.btn--ghost', { href: `#/teacher/league/${leagueId}`, text: '↩️ لیگ' }),
          backToWorkbench(),
        ],
      }),
      grid('grid--stats', [
        statCard({ label: 'منظم', value: fa(sheet.counters.orderly), kind: 'ok', icon: '✅' }),
        statCard({ label: 'بی‌نظمی', value: fa(sheet.counters.disorderly), kind: 'bad', icon: '⚠️' }),
        statCard({ label: 'ثبت‌نشده', value: fa(sheet.counters.unmarked), icon: '❔' }),
      ]),
      card({ title: `برگه ${faDate(day)}`, icon: '📋' }, [
        el('div.grid.grid--two', {}, [
          el('div.field', {}, [el('label', { for: 'discipline-date', text: 'تاریخ (میلادی، معادل شمسی نمایش داده می‌شود)' }), dateInput]),
          el('div', {}, [
            el('p.small.muted', { text: `معادل شمسی: ${faDate(day)}` }),
            el('div.row', {}, [
              button('روز قبل', { kind: 'ghost', icon: '⬅️', onClick: () => { day = shiftIso(day, -1); void load(); } }),
              button('امروز', { kind: 'ghost', icon: '📅', onClick: () => { day = sheet.today; void load(); } }),
              button('روز بعد', { kind: 'ghost', icon: '➡️', onClick: () => { day = shiftIso(day, 1); void load(); } }),
            ]),
          ]),
        ]),
        el('div.row', { style: { margin: '10px 0' } }, [
          button('همه منظم', { icon: '✅', onClick: () => bulk('orderly') }),
          button('همه بی‌نظمی', { kind: 'danger', icon: '⚠️', onClick: () => bulk('disorderly') }),
        ]),
        sheet.items.length === 0
          ? emptyState({ icon: '🧑‍🎓', title: 'دانش‌آموزی در این لیگ نیست', hint: 'ابتدا از صفحه لیگ دانش‌آموز اضافه کنید.' })
          : sheetTable(sheet.items, setStatus, setNote),
        el('p.small.muted', {
          style: { marginTop: '8px' },
          text: 'انضباط مستقل از حضور و غیاب است و به‌طور خودکار امتیازی کم یا زیاد نمی‌کند. علت نوشته‌شده در گزارش روزانه والدین نمایش داده می‌شود.',
        }),
      ]),
      historyCard(history.items ?? []),
    );
  }

  await load();
  return undefined;
}
