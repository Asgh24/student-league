/**
 * «شماره‌ها» — parent and student mobile numbers of the league.
 *
 * Every row saves on its own («ذخیره»), and a bulk action stores all edited
 * rows at once. Numbers are normalized and validated before they leave the
 * browser, and again by the API.
 */

import { api } from '../api.js';
import { el } from '../dom.js';
import { errorMessage } from '../format.js';
import { renderView, setLeaguePill, setTopbarTitle } from '../shell.js';
import { setLeagueId } from '../store.js';
import { emptyState, notify } from '../ui.js';
import { backToWorkbench, button, card, fa, loadingNode, pageHead, statCard } from './common.js';

const MOBILE_PATTERN = /^09\d{9}$/;

/** Mirrors `src/lib/phone.js` so the teacher gets an error before the request. */
export function normalizeMobile(value) {
  let text = String(value ?? '')
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[\s\-().]/g, '');
  if (text.startsWith('+98')) text = `0${text.slice(3)}`;
  else if (text.startsWith('0098')) text = `0${text.slice(4)}`;
  else if (text.startsWith('98') && text.length === 12) text = `0${text.slice(2)}`;
  else if (/^9\d{9}$/.test(text)) text = `0${text}`;
  return MOBILE_PATTERN.test(text) ? text : '';
}

export async function renderContacts({ params }) {
  const leagueId = Number(params.id);
  setTopbarTitle('شماره‌های والدین و دانش‌آموزان');
  setLeagueId(leagueId);

  const body = el('div', {}, [loadingNode()]);
  renderView([body]);

  let payload;
  try {
    payload = await api.get(`/leagues/${leagueId}/contacts`);
  } catch (error) {
    body.replaceChildren(
      pageHead({ icon: '📱', title: 'شماره‌ها', actions: [backToWorkbench()] }),
      emptyState({ icon: '⚠️', title: 'دریافت شماره‌ها ناموفق بود', hint: errorMessage(error) }),
    );
    return undefined;
  }

  setLeaguePill({ name: payload?.league?.name ?? '' });
  const rows = (payload?.items ?? []).map((item) => ({
    ...item,
    parentPhone: normalizeMobile(item.parentPhone) || item.parentPhone || '',
    studentPhone: normalizeMobile(item.studentPhone) || item.studentPhone || '',
  }));

  const statsNode = el('div.grid.grid--stats');
  const search = el('input', { type: 'search', placeholder: 'جست‌وجوی نام دانش‌آموز…', 'aria-label': 'جست‌وجوی دانش‌آموز' });
  const saveAllButton = button('ذخیره همه تغییرات', { icon: '💾', kind: 'soft', disabled: true, onClick: () => saveAll() });

  function stats() {
    const withParent = rows.filter((row) => normalizeMobile(row.parentPhone)).length;
    const withStudent = rows.filter((row) => normalizeMobile(row.studentPhone)).length;
    statsNode.replaceChildren(
      statCard({ label: 'دانش‌آموزان', value: fa(rows.length), icon: '🧑‍🎓' }),
      statCard({ label: 'شماره والدین', value: fa(withParent), kind: 'ok', icon: '👨‍👩‍👧' }),
      statCard({ label: 'شماره دانش‌آموز', value: fa(withStudent), icon: '📱' }),
      statCard({ label: 'بدون شماره والد', value: fa(rows.length - withParent), kind: withParent === rows.length ? 'ok' : 'warn', icon: '⚠️' }),
    );
  }

  function draftOf(row) {
    return {
      parentPhone: row.draftParent ?? row.parentPhone,
      studentPhone: row.draftStudent ?? row.studentPhone,
    };
  }

  function rowChanged(row) {
    const draft = draftOf(row);
    return draft.parentPhone.trim() !== row.parentPhone || draft.studentPhone.trim() !== row.studentPhone;
  }

  function refreshDirty() {
    const anyDirty = rows.some((row) => rowChanged(row));
    saveAllButton.disabled = !anyDirty;
    for (const row of rows) {
      row.saveButton.disabled = !rowChanged(row) || row.busy;
      row.status.textContent = rowChanged(row) ? 'ذخیره نشده' : 'ذخیره‌شده';
      row.status.className = `chip ${rowChanged(row) ? 'chip--amber' : 'chip--muted'}`;
    }
  }

  async function persist(row) {
    if (row.busy || !rowChanged(row)) return false;
    const draft = draftOf(row);
    const parentRaw = draft.parentPhone.trim();
    const studentRaw = draft.studentPhone.trim();
    const parentPhone = parentRaw ? normalizeMobile(parentRaw) : '';
    const studentPhone = studentRaw ? normalizeMobile(studentRaw) : '';
    if (parentRaw && !parentPhone) {
      notify.error('شماره والد باید با ۰۹ شروع شود و ۱۱ رقم باشد');
      row.parentInput.focus();
      return false;
    }
    if (studentRaw && !studentPhone) {
      notify.error('شماره دانش‌آموز باید با ۰۹ شروع شود و ۱۱ رقم باشد');
      row.studentInput.focus();
      return false;
    }

    row.busy = true;
    refreshDirty();
    try {
      const response = await api.patch(`/leagues/${leagueId}/contacts/${row.id}`, { parentPhone, studentPhone });
      const saved = response?.student;
      row.parentPhone = saved?.parentPhone ?? parentPhone;
      row.studentPhone = saved?.studentPhone ?? studentPhone;
      row.hasParentPhone = Boolean(row.parentPhone);
      row.draftParent = null;
      row.draftStudent = null;
      row.parentInput.value = row.parentPhone;
      row.studentInput.value = row.studentPhone;
      return true;
    } catch (error) {
      notify.error(errorMessage(error));
      return false;
    } finally {
      row.busy = false;
      refreshDirty();
      stats();
    }
  }

  async function saveAll() {
    const dirty = rows.filter((row) => rowChanged(row));
    if (dirty.length === 0) return;
    saveAllButton.disabled = true;
    let saved = 0;
    for (const row of dirty) {
      if (await persist(row)) saved += 1;
    }
    if (saved) notify.ok(`${fa(saved)} شماره ذخیره شد`);
    refreshDirty();
  }

  function renderRows() {
    const query = search.value.trim().toLowerCase();
    const table = el('table.grid-table.contacts-table');
    table.appendChild(el('thead', {}, [
      el('tr', {}, [
        el('th', { text: 'دانش‌آموز' }),
        el('th', { text: 'شماره والد' }),
        el('th', { text: 'شماره دانش‌آموز' }),
        el('th', { text: 'وضعیت' }),
        el('th', { text: 'ذخیره' }),
      ]),
    ]));
    const tbody = el('tbody');
    for (const row of rows) {
      if (query && !row.name.toLowerCase().includes(query)) continue;
      const draft = draftOf(row);
      row.parentInput = el('input.contacts-input', {
        type: 'tel',
        dir: 'ltr',
        value: draft.parentPhone,
        placeholder: '۰۹۱۲۳۴۵۶۷۸۹',
        'aria-label': `شماره والد ${row.name}`,
        inputmode: 'tel',
        maxlength: '20',
      });
      row.studentInput = el('input.contacts-input', {
        type: 'tel',
        dir: 'ltr',
        value: draft.studentPhone,
        placeholder: '۰۹۱۲۳۴۵۶۷۸۹',
        'aria-label': `شماره دانش‌آموز ${row.name}`,
        inputmode: 'tel',
        maxlength: '20',
      });
      row.status = el('span.chip.chip--muted', { text: 'ذخیره‌شده' });
      row.saveButton = button('ذخیره', { kind: 'ghost', icon: '💾', disabled: !rowChanged(row), onClick: () => persist(row).then((ok) => ok && notify.ok('شماره ذخیره شد')) });

      const onEdit = () => {
        row.draftParent = row.parentInput.value;
        row.draftStudent = row.studentInput.value;
        row.status.textContent = rowChanged(row) ? 'ذخیره نشده' : 'ذخیره‌شده';
        row.status.className = `chip ${rowChanged(row) ? 'chip--amber' : 'chip--muted'}`;
        row.saveButton.disabled = !rowChanged(row);
        saveAllButton.disabled = !rows.some((item) => rowChanged(item));
      };
      row.parentInput.addEventListener('input', onEdit);
      row.studentInput.addEventListener('input', onEdit);

      tbody.appendChild(el('tr', {}, [
        el('td.name-cell', {}, [
          el('strong', { text: row.name }),
          row.hasLogin ? el('span.chip.chip--muted', { text: 'حساب دارد' }) : null,
        ]),
        el('td', {}, [row.parentInput]),
        el('td', {}, [row.studentInput]),
        el('td', {}, [row.status]),
        el('td.actions-td', {}, [row.saveButton]),
      ]));
    }
    table.appendChild(tbody);
    return el('div.table-wrap', {}, [table]);
  }

  function repaint() {
    stats();
    const list = renderRows();
    refreshDirty();
    body.replaceChildren(
      pageHead({
        icon: '📱',
        title: 'شماره‌های والدین و دانش‌آموزان',
        subtitle: 'این شماره‌ها در گزارش روزانهٔ والدین استفاده می‌شوند.',
        actions: [saveAllButton, backToWorkbench()],
      }),
      statsNode,
      card({ title: 'ثبت شماره‌ها', icon: '✍️' }, [
        el('div.row', { style: { justifyContent: 'space-between', flexWrap: 'wrap' } }, [
          search,
          el('span.small.muted', { text: 'خالی گذاشتن یعنی «ثبت نشده». شماره با ۰۹ و ۱۱ رقم.' }),
        ]),
        list,
      ]),
    );
  }

  search.addEventListener('input', () => {
    const list = renderRows();
    const host = body.querySelector('.table-wrap');
    if (host) host.replaceWith(list);
    refreshDirty();
  });
  repaint();
  return undefined;
}
