/**
 * Student league history: a teacher-style league switcher plus a read-only
 * result sheet for the selected membership. Old leagues keep their scores,
 * final ranking, medals and published report cards after a roster transfer.
 */

import { api } from '../../api.js';
import { el } from '../../dom.js';
import { errorMessage } from '../../format.js';
import { renderView, setLeaguePill, setTopbarTitle } from '../../shell.js';
import { emptyState } from '../../ui.js';
import { card, chip, fa, faDate, faDateTime, grid, loadingNode, pageHead, statCard, tableWrap } from '../common.js';
import { sessionCard } from './reportSessions.js';
import { studentTabs } from './tabs.js';

function leagueChip(item, active, onSelect) {
  const label = `${item.leagueName} · ${item.leagueStatus === 'completed' ? 'پایان‌یافته' : 'فعال'}${item.isCurrent ? ' · فعلی' : ''}`;
  return el(`button.chip.chip--button${active ? '.chip--ok' : ''}`, {
    type: 'button',
    text: label,
    'aria-pressed': active ? 'true' : 'false',
    onclick: onSelect,
  });
}

function rankingTable(data) {
  const table = el('table.grid-table');
  table.appendChild(el('thead', {}, [
    el('tr', {}, [el('th', { text: 'رتبه' }), el('th', { text: 'دانشآموز' }), el('th', { text: 'امتیاز' }), el('th', { text: 'عنوان' })]),
  ]));
  const tbody = el('tbody');
  for (const row of data.ranking) {
    tbody.appendChild(el(`tr${row.isMe ? '.is-me' : ''}`, {}, [
      el('td.col-rank', { text: fa(row.rank) }),
      el('td.name-cell', { text: row.name }),
      el('td.total-cell', { text: fa(row.total) }),
      el('td', { text: row.title ?? '' }),
    ]));
  }
  table.appendChild(tbody);
  return tableWrap(table);
}

function subjectsTable(data) {
  const table = el('table.grid-table');
  table.appendChild(el('thead', {}, [
    el('tr', {}, [el('th', { text: 'درس / ستون' }), el('th', { text: 'امتیاز' })]),
  ]));
  const tbody = el('tbody');
  for (const item of data.items) {
    tbody.appendChild(el('tr', {}, [
      el('td.name-cell', { text: item.name }),
      el('td.total-cell', { text: fa(item.value) }),
    ]));
  }
  table.appendChild(tbody);
  return tableWrap(table);
}

function renderResult(host, data) {
  const sessions = data.sessions ?? [];
  const reportCards = data.reportCards ?? [];
  const medals = data.medals ?? [];
  host.replaceChildren(
    grid('grid--stats', [
      statCard({ label: 'امتیاز کل', value: fa(data.total), icon: '⭐' }),
      statCard({ label: 'رتبه', value: `${fa(data.rank ?? 0)} از ${fa(data.totalStudents ?? 0)}`, icon: '🏆' }),
      statCard({ label: 'مدالهای این لیگ', value: fa(medals.length), icon: '🥇' }),
      statCard({ label: 'ثبتهای امتیاز', value: fa(data.sessionCount), icon: '🗂️' }),
    ]),
    card({ title: 'نمرات به تفکیک درس', icon: '📋' }, [
      data.items.length
        ? subjectsTable(data)
        : emptyState({ icon: '📋', title: 'امتیازی در این لیگ ثبت نشده است' }),
    ]),
    card({ title: data.leagueStatus === 'completed' ? 'نتیجه نهایی لیگ' : 'ردهبندی فعلی', icon: '🏅' }, [
      data.ranking.length
        ? rankingTable(data)
        : emptyState({ icon: '🏅', title: 'ردهبندیای وجود ندارد' }),
      el('p.small.muted', { text: 'برای لیگهای پایانیافته، جدول ذخیرهشدهٔ هنگام اتمام لیگ نمایش داده میشود.' }),
    ]),
    card({ title: `کارنامهٔ جلسهها (${fa(data.sessionCount)})`, icon: '🗂️' }, [
      sessions.length
        ? el('div.session-list', {}, sessions.map((session) => sessionCard(session, { grade: data.grade })))
        : emptyState({ icon: '🗂️', title: 'ثبتی برای این لیگ وجود ندارد' }),
    ]),
    card({ title: 'کارنامههای دستی منتشرشده', icon: '📊' }, [
      reportCards.length
        ? el('div', {}, reportCards.map((item) => el('div.timeline-item', {}, [
          el('div', {}, [
            el('strong', { text: item.semester }),
            item.level ? chip(item.level.label ?? item.level, 'ok') : null,
          ]),
          el('div.small.muted', { text: `درصد کل: ${fa(item.totalPercent)} · بهروزشده ${faDateTime(item.updatedAt)}` }),
        ])))
        : emptyState({ icon: '📊', title: 'کارنامه دستی منتشرشده‌ای برای این لیگ نیست' }),
    ]),
    medals.length
      ? card({ title: 'مدالهای کسبشده', icon: '🏅' }, [
        el('div', {}, medals.map((medal) => el('div.timeline-item', {}, [
          el('span.badge-emoji', { text: medal.rank === 1 ? '🥇' : medal.rank === 2 ? '🥈' : '🥉' }),
          el('div', {}, [
            el('strong', { text: medal.title }),
            el('div.small.muted', { text: faDate(medal.createdAt) }),
          ]),
        ]))),
      ])
      : null,
    el('p.small.muted', { text: 'نتایج لیگهای پیشین فقط خواندنیاند و تغییری در آنها ذخیره نمیشود.' }),
  );
}

export async function renderStudentLeagueHistory() {
  setTopbarTitle('سوابق لیگهای من');
  setLeaguePill(null);
  const body = el('div', {}, [loadingNode()]);
  renderView([body]);

  let data;
  try {
    data = await api.get('/student/leagues');
  } catch (error) {
    body.replaceChildren(emptyState({ icon: '⚠️', title: 'دریافت سوابق ناموفق بود', hint: errorMessage(error) }));
    return undefined;
  }

  const items = data.items ?? [];
  if (items.length === 0) {
    body.replaceChildren(
      pageHead({ icon: '🏆', title: 'سوابق لیگهای من' }),
      studentTabs('student/leagues'),
      emptyState({ icon: '🏆', title: 'هنوز لیگی ثبت نشده است', hint: 'پس از عضویت در اولین لیگ، نتایج آن در اینجا نمایش داده میشود.' }),
    );
    return undefined;
  }

  const switcher = el('div.row');
  const detail = el('div', {}, [loadingNode()]);

  async function loadResult(leagueId) {
    detail.replaceChildren(loadingNode());
    try {
      const result = await api.get(`/student/leagues/${leagueId}/results`);
      renderResult(detail, result);
    } catch (error) {
      detail.replaceChildren(emptyState({ icon: '⚠️', title: 'دریافت نتیجه لیگ ناموفق بود', hint: errorMessage(error) }));
    }
  }

  for (const item of items) {
    switcher.appendChild(leagueChip(item, false, () => {
      for (const node of switcher.children) {
        const active = node.dataset.leagueId === String(item.leagueId);
        node.classList.toggle('chip--ok', active);
        node.setAttribute('aria-pressed', active ? 'true' : 'false');
      }
      void loadResult(item.leagueId);
    }));
    switcher.lastChild.dataset.leagueId = String(item.leagueId);
  }

  const first = items.find((item) => item.leagueStatus === 'completed') ?? items[0];
  for (const node of switcher.children) {
    const active = node.dataset.leagueId === String(first.leagueId);
    node.classList.toggle('chip--ok', active);
    node.setAttribute('aria-pressed', active ? 'true' : 'false');
  }

  body.replaceChildren(
    pageHead({
      icon: '🏆',
      title: 'سوابق لیگهای من',
      subtitle: 'مشاهدهٔ نتایج لیگهای فعلی و پیشین (فقط خواندنی)',
      actions: [el('a.btn.btn--ghost', { href: '#/student', text: '↩️ بازگشت به میزکار' })],
    }),
    studentTabs('student/leagues'),
    card({ title: 'لیگهای من', icon: '🔄' }, [switcher]),
    detail,
  );

  await loadResult(first.leagueId);
  return undefined;
}
