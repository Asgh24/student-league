/**
 * The staged-edit scores table used by the individual league page. Edits are
 * kept locally per row and committed in a single request when the row's check
 * button is pressed, so a failure can never corrupt the stored totals.
 */

import { api } from '../api.js';
import { el } from '../dom.js';
import { errorMessage } from '../format.js';
import { matches, normalizeFa } from '../normalize.js';
import { notify } from '../ui.js';
import { button, chip, fa, iconButton, ratioChip } from './common.js';
import {
  addColumn,
  addStudent,
  askCustomDelta,
  deleteColumn,
  editColumn,
  showProfile,
} from './scoresActions.js';

function compareNames(a, b) {
  return normalizeFa(a).localeCompare(normalizeFa(b), 'fa');
}

export function createScoresTable({ leagueId, columns, students, reload }) {
  const staged = new Map();
  const search = { value: '' };

  const tbody = el('tbody');
  const footer = el('div.row', { style: { marginTop: '10px' } });
  const pendingInfo = el('span.small.muted');
  const clearButton = button('لغو تغییرات', { kind: 'ghost', icon: '↩️', onClick: () => { staged.clear(); paint(); } });

  const stagedFor = (studentId) => staged.get(studentId) ?? new Map();
  const stagedSum = (studentId) => [...stagedFor(studentId).values()].reduce((acc, value) => acc + value, 0);
  const hasPending = () => [...staged.values()].some((entry) => entry.size > 0);

  function stage(studentId, columnId, delta) {
    const map = new Map(stagedFor(studentId));
    const next = (map.get(columnId) ?? 0) + delta;
    if (next === 0) map.delete(columnId);
    else map.set(columnId, next);
    if (map.size === 0) staged.delete(studentId);
    else staged.set(studentId, map);
    paint();
  }

  async function commitRow(row) {
    const changes = [...stagedFor(row.id).entries()].map(([columnId, delta]) => ({ columnId, delta }));
    if (changes.length === 0) return;
    try {
      const result = await api.post(`/leagues/${leagueId}/scores/commit`, { studentId: row.id, changes, reason: '' });
      staged.delete(row.id);
      notify.ok(`${fa(result.applied)} تغییر برای «${row.name}» ثبت شد`);
      reload();
    } catch (error) {
      notify.error(errorMessage(error));
    }
  }

  function headerCell(column) {
    return el('th.score-th', {}, [
      el('div', {}, [
        el('span', { text: column.name }),
        el('span.chip.chip--muted', { text: `گام ${fa(column.step)}` }),
      ]),
      el('div.row', { style: { justifyContent: 'center', gap: '3px' } }, [
        iconButton('✏️', { label: `ویرایش ستون ${column.name}`, size: 'xs', onClick: () => editColumn(column, reload) }),
        iconButton('🗑️', { label: `حذف ستون ${column.name}`, size: 'xs', danger: true, onClick: () => deleteColumn(leagueId, column, reload) }),
      ]),
    ]);
  }

  function scoreCell(row, column) {
    const delta = stagedFor(row.id).get(column.id) ?? 0;
    const base = Number(row.scores?.[column.id] ?? 0);
    const value = base + delta;
    const sign = delta > 0 ? '+' : '−';
    // The button always shows the resulting value so the column width never
    // changes while editing; the delta rides along as a floating badge.
    const title = delta
      ? `${column.name}: ${fa(base)} → ${fa(value)} (${sign}${fa(Math.abs(delta))})`
      : `ثبت مقدار دلخواه ${column.name}`;
    return el('td.score-td', {}, [
      el('span.score-cell', {}, [
        iconButton('−', { label: `کاهش ${column.name}`, size: 'xs', onClick: () => stage(row.id, column.id, -column.step) }),
        el(`button.score-value${delta ? '.is-staged' : ''}`, {
          type: 'button',
          title,
          text: fa(value),
          dataset: delta ? { delta: `${sign}${fa(Math.abs(delta))}` } : undefined,
          onclick: async () => {
            const custom = await askCustomDelta(column);
            if (custom !== null) stage(row.id, column.id, custom);
          },
        }),
        iconButton('+', { label: `افزایش ${column.name}`, size: 'xs', onClick: () => stage(row.id, column.id, column.step) }),
      ]),
    ]);
  }

  function actionCell(row) {
    // Only the two most-used actions live in the row: committing the staged
    // edits and opening the student's page. Every other action moved into the
    // profile dialog so the row stays narrow enough to fit without scrolling.
    return el('td.actions-td', {}, [
      el('span.row', { style: { justifyContent: 'center', gap: '2px' } }, [
        iconButton('✓', { label: 'ثبت تغییرات این ردیف', kind: 'soft', size: 'xs', onClick: () => commitRow(row) }),
        iconButton('👤', {
          label: 'پرونده دانش‌آموز',
          size: 'xs',
          onClick: () => showProfile(row, { columns, leagueId, reload }),
        }),
      ]),
    ]);
  }

  function rowNode(row) {
    const stagedTotal = stagedSum(row.id);
    const total = Number(row.total ?? 0) + stagedTotal;
    const medals = row.championships ? ` ${row.title?.icon ?? '🏅'}`.repeat(Math.min(row.championships, 3)) : '';
    const cells = [
      el('td.col-rank', { text: fa(row.rank ?? '') }),
      el('td.name-cell', {}, [
        el('div', {}, [el('strong', { text: row.name }), medals ? el('span', { text: medals }) : null]),
        el('div.row', { style: { gap: '4px' } }, [
          ratioChip(row.attended ?? 0, row.recorded ?? 0),
          row.title?.title ? chip(row.title.title, 'muted') : null,
          row.teamName ? chip(row.teamName) : null,
        ]),
      ]),
    ];
    for (const column of columns) cells.push(scoreCell(row, column));
    cells.push(el('td.total-cell', {}, [
      el('span', { text: fa(total) }),
      stagedTotal
        ? el('span.chip.chip--amber', { text: `${stagedTotal > 0 ? '+' : '−'}${fa(Math.abs(stagedTotal))}` })
        : null,
    ]));
    cells.push(actionCell(row));
    return el(`tr${row.rank <= 3 ? `.rank-${row.rank}` : ''}`, {}, cells);
  }

  function visibleRows() {
    const query = search.value.trim();
    const rows = query ? students.filter((row) => matches(row.name, query)) : [...students];
    rows.sort((a, b) => (Number(b.total) + stagedSum(b.id) - Number(a.total) - stagedSum(a.id)) || compareNames(a.name, b.name));
    return rows;
  }

  function paint() {
    const rows = visibleRows();
    tbody.replaceChildren();
    if (rows.length === 0) {
      tbody.appendChild(el('tr', {}, [
        el('td', { colspan: String(columns.length + 4) }, [
          el('div.empty', {}, [
            el('span.empty__icon', { text: '🔍', 'aria-hidden': 'true' }),
            el('p', { text: 'دانش‌آموزی یافت نشد' }),
          ]),
        ]),
      ]));
    }
    for (const row of rows) tbody.appendChild(rowNode(row));
    pendingInfo.textContent = hasPending() ? 'تغییرات ثبت‌نشده دارید؛ هر ردیف را با ✓ ثبت کنید.' : '';
    clearButton.disabled = !hasPending();
    footer.replaceChildren(
      el('span.small.muted', { text: `نمایش ${fa(rows.length)} از ${fa(students.length)} دانش‌آموز` }),
      el('span.spacer'),
      pendingInfo,
      clearButton,
    );
  }

  const searchInput = el('input', {
    type: 'search',
    placeholder: 'جست‌وجوی نام (ی و ک عربی همسان‌سازی می‌شوند)',
    'aria-label': 'جست‌وجوی دانش‌آموز',
    oninput: (event) => {
      search.value = event.target.value;
      paint();
    },
  });

  const table = el('table.grid-table');
  table.appendChild(el('thead', {}, [
    el('tr', {}, [
      el('th.col-rank', { text: '#' }),
      el('th.col-name', { text: 'دانش‌آموز' }),
      ...columns.map(headerCell),
      el('th.col-total', { text: 'مجموع' }),
      el('th.col-actions', { text: 'عملیات' }),
    ]),
  ]));
  table.appendChild(tbody);

  const toolbar = el('div.row', { style: { marginBottom: '10px' } }, [
    el('div', { style: { flex: '1 1 220px' } }, [searchInput]),
    button('افزودن دانش‌آموز', { kind: 'soft', icon: '➕', onClick: () => addStudent(leagueId, reload) }),
    button('افزودن ستون', { kind: 'soft', icon: '📋', onClick: () => addColumn(leagueId, reload) }),
  ]);

  paint();

  return el('div', {}, [
    toolbar,
    el('div.table-wrap', {}, [table]),
    footer,
    el('p.small.muted', { style: { marginTop: '6px' }, text: 'برای ثبت مقدار دلخواه روی عدد امتیاز بزنید.' }),
  ]);
}
