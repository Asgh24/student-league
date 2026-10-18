/**
 * Student report card: profile band, subject/date filters, one line per recorded
 * score session (subject + teacher topic + derived quality), the per-subject
 * totals table and a bar chart.
 */

import { api } from '../../api.js';
import { el } from '../../dom.js';
import { errorMessage } from '../../format.js';
import { renderBars } from '../../charts.js';
import { renderView, setLeaguePill, setTopbarTitle } from '../../shell.js';
import { state } from '../../store.js';
import { emptyState } from '../../ui.js';
import { card, fa, faDate, grid, loadingNode, pageHead, statCard } from '../common.js';
import { reportFilters, sessionCard } from './reportSessions.js';
import { studentTabs } from './tabs.js';

const EMPTY_FILTERS = { columnId: '', from: '', to: '' };

function queryString(filters) {
  const params = new URLSearchParams();
  if (filters.columnId) params.set('columnId', String(filters.columnId));
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

function profileBand(data) {
  return el('div.report-band', {}, [
    el('div.report-band__title', {}, [
      el('span.report-band__avatar', { text: '🧑‍🎓', 'aria-hidden': 'true' }),
      el('strong', { text: data.name }),
    ]),
    el('div.report-band__facts', {}, [
      el('span', { text: `لیگ: ${data.leagueName}` }),
      el('span', { text: `امتیاز: ${fa(data.total)}` }),
      el('span', { text: `رتبه: ${fa(data.rank ?? 0)}` }),
      data.grade ? el('span', { text: `پایه: ${data.grade}` }) : null,
      el('span', { text: `📅 ${faDate(new Date().toISOString())}` }),
    ]),
  ]);
}

function filterSummary(data) {
  const parts = [];
  if (data.filters.columnId) {
    const column = (data.columns ?? []).find((item) => item.id === data.filters.columnId);
    if (column) parts.push(`درس: ${column.name}`);
  }
  if (data.filters.from) parts.push(`از ${faDate(data.filters.from)}`);
  if (data.filters.to) parts.push(`تا ${faDate(data.filters.to)}`);
  return parts.length ? parts.join(' · ') : 'همه ثبت‌ها';
}

function sessionsSection(data) {
  const title = `کارنامهٔ جلسه‌ها (${fa(data.sessionCount)})`;
  if (data.sessions.length === 0) {
    return card({ title, icon: '🗂️' }, [
      emptyState({ icon: '🗂️', title: 'در این بازه ثبتی وجود ندارد', hint: 'فیلترها را تغییر دهید یا منتظر ثبت امتیاز بمانید.' }),
    ]);
  }
  const list = el('div.session-list');
  for (const session of data.sessions) {
    list.appendChild(sessionCard(session, { grade: data.grade }));
  }
  return card({ title, icon: '🗂️' }, [el('p.small.muted', { text: filterSummary(data) }), list]);
}

function totalsTable(data) {
  const table = el('table.grid-table');
  table.appendChild(el('thead', {}, [
    el('tr', {}, [el('th', { text: 'درس / ستون' }), el('th', { text: 'امتیاز' }), el('th', { text: 'سهم از کل' })]),
  ]));
  const max = Math.max(1, ...data.items.map((item) => Math.abs(item.value)));
  const tbody = el('tbody');
  for (const item of data.items) {
    tbody.appendChild(el('tr', {}, [
      el('td.name-cell', { text: item.name }),
      el('td.total-cell', { text: fa(item.value) }),
      el('td', {}, [
        el('div.meter', {}, [el('span', { style: { width: `${Math.round((Math.abs(item.value) / max) * 100)}%` } })]),
      ]),
    ]));
  }
  table.appendChild(tbody);
  return el('div.table-wrap', {}, [table]);
}

export async function renderReportCard() {
  setTopbarTitle('کارنامه من');
  let filters = { ...EMPTY_FILTERS };
  const body = el('div', {}, [loadingNode()]);
  renderView([body]);

  async function load() {
    body.replaceChildren(loadingNode());

    let data;
    try {
      data = await api.get(`/student/report-card${queryString(filters)}`);
    } catch (error) {
      body.replaceChildren(emptyState({ icon: '⚠️', title: 'دریافت کارنامه ناموفق بود', hint: errorMessage(error) }));
      return;
    }

    setLeaguePill({ name: data.leagueName });
    const canvas = el('canvas', { 'aria-label': 'نمودار امتیاز درس‌ها' });
    const hasItems = data.items.length > 0;

    body.replaceChildren(
      pageHead({ icon: '📄', title: 'کارنامه من', subtitle: 'امتیازهای ثبت‌شده به تفکیک درس و جلسه' }),
      studentTabs('student/report-card'),
      profileBand(data),
      card({ title: 'فیلترها', icon: '🔎' }, [
        reportFilters({
          columns: data.columns ?? [],
          filters: data.filters ?? filters,
          onApply: (next) => {
            filters = next;
            void load();
          },
          onReset: () => {
            filters = { ...EMPTY_FILTERS };
            void load();
          },
        }),
        el('p.small.muted', { text: 'بازهٔ تاریخ بر اساس تاریخ محلی سامانه اعمال می‌شود.' }),
      ]),
      grid('grid--stats', [
        statCard({ label: 'امتیاز کل', value: fa(data.total), icon: '⭐' }),
        statCard({ label: 'رتبه', value: `${fa(data.rank ?? 0)} از ${fa(data.totalStudents ?? 0)}`, icon: '🏆' }),
        statCard({ label: 'عنوان', value: `${data.title?.icon ?? ''} ${data.title?.title ?? ''}`, icon: '🎖️' }),
        statCard({ label: 'پایه', value: data.grade || '—', icon: '🎓' }),
        statCard({ label: 'ثبت‌ها در این بازه', value: fa(data.sessionCount), icon: '🗂️' }),
      ]),
      sessionsSection(data),
      card({ title: 'مجموع امتیاز هر درس', icon: '📋' }, [
        hasItems
          ? totalsTable(data)
          : emptyState({ icon: '📋', title: 'درسی برای نمایش وجود ندارد' }),
      ]),
      card({ title: 'نمودار درس‌ها', icon: '📊' }, [
        hasItems
          ? el('div.chart-box', {}, [canvas])
          : emptyState({ icon: '📊', title: 'داده‌ای برای نمودار نیست' }),
      ]),
    );

    if (hasItems) {
      renderBars(canvas, data.items.map((item) => item.name), data.items.map((item) => item.value), {
        persianDigits: state.persianDigits,
      });
    }
  }

  await load();
  return undefined;
}
