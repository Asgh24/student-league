/** Student league leaderboard (names, points and rank only). */

import { api } from '../../api.js';
import { el } from '../../dom.js';
import { errorMessage } from '../../format.js';
import { renderView, setTopbarTitle } from '../../shell.js';
import { emptyState } from '../../ui.js';
import { card, chip, fa, loadingNode, pageHead } from '../common.js';
import { studentTabs } from './tabs.js';

export async function renderStudentRanking() {
  setTopbarTitle('رده‌بندی کلاس');
  const body = el('div', {}, [loadingNode()]);
  renderView([body]);

  let data;
  try {
    data = await api.get('/student/ranking');
  } catch (error) {
    body.replaceChildren(emptyState({ icon: '⚠️', title: 'دریافت رده‌بندی ناموفق بود', hint: errorMessage(error) }));
    return undefined;
  }

  const table = el('table.grid-table');
  table.appendChild(el('thead', {}, [
    el('tr', {}, [
      el('th', { text: '#' }),
      el('th', { text: 'نام' }),
      el('th', { text: 'عنوان' }),
      el('th', { text: 'امتیاز' }),
    ]),
  ]));
  const tbody = el('tbody');
  for (const item of data.items ?? []) {
    tbody.appendChild(el(`tr${item.rank <= 3 ? `.rank-${item.rank}` : ''}`, {}, [
      el('td', { text: fa(item.rank) }),
      el('td.name-cell', {}, [
        el('strong', { text: item.name }),
        item.isMe ? chip('شما', 'ok') : null,
      ]),
      el('td', { text: item.title }),
      el('td.total-cell', { text: fa(item.total) }),
    ]));
  }
  table.appendChild(tbody);

  body.replaceChildren(
    pageHead({ icon: '🏅', title: 'رده‌بندی کلاس', subtitle: `${fa(data.total ?? 0)} دانش‌آموز` }),
    studentTabs('student/ranking'),
    card({ title: 'جدول رده‌بندی', icon: '📋' }, [
      (data.items ?? []).length === 0
        ? emptyState({ icon: '🏅', title: 'هنوز دانش‌آموزی در لیگ نیست' })
        : el('div.table-wrap', {}, [table]),
      el('p.small.muted', { text: 'فقط نام، امتیاز و رتبه هم‌کلاسی‌ها نمایش داده می‌شود؛ اطلاعات حضور و تاریخچه خصوصی است.' }),
    ]),
  );
  return undefined;
}
