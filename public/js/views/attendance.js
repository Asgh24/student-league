/** Daily attendance sheet with bulk actions, ratios and league history. */

import { api } from '../api.js';
import { el } from '../dom.js';
import { errorMessage } from '../format.js';
import { renderView, setLeaguePill, setTopbarTitle } from '../shell.js';
import { setLeagueId } from '../store.js';
import { emptyState, notify } from '../ui.js';
import { backToWorkbench, button, card, chip, fa, faDate, grid, loadingNode, pageHead, ratioChip, STATUS_KIND, STATUS_LABELS, statCard } from './common.js';

function shiftIso(iso, days) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function statusButtons(student, onSet) {
  const row = el('span.row', { style: { gap: '4px', justifyContent: 'center' } });
  for (const status of ['present', 'absent', 'late']) {
    const active = student.status === status;
    row.appendChild(el(`button.chip.chip--button${active ? `.chip--${STATUS_KIND[status]}` : ''}`, {
      type: 'button',
      text: STATUS_LABELS[status],
      'aria-pressed': active ? 'true' : 'false',
      title: `${student.name} — ${STATUS_LABELS[status]}`,
      onclick: () => onSet(student.studentId, status),
    }));
  }
  return el('td', {}, [row]);
}

function sheetTable(items, onSet) {
  const table = el('table.grid-table');
  table.appendChild(el('thead', {}, [
    el('tr', {}, [
      el('th', { text: '#' }),
      el('th', { text: 'دانش‌آموز' }),
      el('th', { text: 'نسبت حضور' }),
      el('th', { text: 'وضعیت' }),
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
      el('td', {}, [ratioChip(student.attended, student.recorded)]),
      statusButtons(student, onSet),
    ]));
  });
  table.appendChild(tbody);
  return el('div.table-wrap', {}, [table]);
}

function historyCard(history) {
  if (!history.length) return card({ title: 'تاریخچه حضور', icon: '🗂️' }, [el('p.small.muted', { text: 'هنوز حضوری ثبت نشده است.' })]);
  const table = el('table.grid-table');
  table.appendChild(el('thead', {}, [
    el('tr', {}, [
      el('th', { text: 'تاریخ' }),
      el('th', { text: 'حاضر' }),
      el('th', { text: 'غایب' }),
      el('th', { text: 'تأخیر' }),
      el('th', { text: 'کل' }),
    ]),
  ]));
  const tbody = el('tbody');
  for (const row of history) {
    tbody.appendChild(el('tr', {}, [
      el('td', { text: faDate(row.day) }),
      el('td', { text: fa(row.present) }),
      el('td', { text: fa(row.absent) }),
      el('td', { text: fa(row.late) }),
      el('td', { text: fa(row.total) }),
    ]));
  }
  table.appendChild(tbody);
  return card({ title: 'تاریخچه حضور', icon: '🗂️' }, [el('div.table-wrap', {}, [table])]);
}

export async function renderAttendance({ params }) {
  const leagueId = Number(params.id);
  setLeagueId(leagueId);
  setTopbarTitle('حضور و غیاب');
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
        api.get(`/leagues/${leagueId}/attendance${query}`),
        api.get(`/leagues/${leagueId}/attendance/history?limit=30`),
      ]);
    } catch (error) {
      body.replaceChildren(emptyState({ icon: '⚠️', title: 'دریافت برگه حضور ناموفق بود', hint: errorMessage(error) }));
      return;
    }
    setLeaguePill({ name: league.league.name });
    day = sheet.date;

    async function setStatus(studentId, status) {
      try {
        await api.post(`/leagues/${leagueId}/attendance`, { date: day, records: [{ studentId, status }] });
        await load();
      } catch (error) {
        notify.error(errorMessage(error));
      }
    }

    async function bulk(status) {
      try {
        await api.post(`/leagues/${leagueId}/attendance/bulk`, { date: day, status });
        notify.ok('وضعیت همه دانش‌آموزان ثبت شد');
        await load();
      } catch (error) {
        notify.error(errorMessage(error));
      }
    }

    const dateInput = el('input', {
      type: 'date',
      value: day,
      id: 'attendance-date',
      onchange: (event) => {
        day = event.target.value || day;
        void load();
      },
    });

    body.replaceChildren(
      pageHead({
        icon: '🗓️',
        title: 'حضور و غیاب',
        subtitle: league.league.name,
        actions: [
          el('a.btn.btn--ghost', { href: `#/teacher/league/${leagueId}`, text: '↩️ لیگ' }),
          backToWorkbench(),
        ],
      }),
      grid('grid--stats', [
        statCard({ label: 'حاضر', value: fa(sheet.counters.present), kind: 'ok', icon: '✅' }),
        statCard({ label: 'غایب', value: fa(sheet.counters.absent), kind: 'bad', icon: '❌' }),
        statCard({ label: 'تأخیر', value: fa(sheet.counters.late), kind: 'warn', icon: '⏰' }),
        statCard({ label: 'ثبت‌نشده', value: fa(sheet.counters.unmarked), icon: '❔' }),
      ]),
      card({ title: `برگه ${faDate(day)}`, icon: '📋' }, [
        el('div.grid.grid--two', {}, [
          el('div.field', {}, [el('label', { for: 'attendance-date', text: 'تاریخ (میلادی، معادل شمسی نمایش داده می‌شود)' }), dateInput]),
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
          button('همه حاضر', { icon: '✅', onClick: () => bulk('present') }),
          button('همه غایب', { kind: 'danger', icon: '❌', onClick: () => bulk('absent') }),
          button('همه با تأخیر', { kind: 'amber', icon: '⏰', onClick: () => bulk('late') }),
        ]),
        sheet.items.length === 0
          ? emptyState({ icon: '🧑‍🎓', title: 'دانش‌آموزی در این لیگ نیست', hint: 'ابتدا از صفحه لیگ دانش‌آموز اضافه کنید.' })
          : sheetTable(sheet.items, setStatus),
        el('p.small.muted', { style: { marginTop: '8px' }, text: 'امتیاز منفی تأخیر و غیبت، در صورت تنظیم، روی ستون انضباطی اعمال می‌شود.' }),
      ]),
      historyCard(history.items ?? []),
    );
  }

  await load();
  return undefined;
}
