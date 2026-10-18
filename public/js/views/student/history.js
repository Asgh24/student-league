/** Student change history: chronological list of own point changes with reasons. */

import { api } from '../../api.js';
import { el } from '../../dom.js';
import { errorMessage } from '../../format.js';
import { renderView, setTopbarTitle } from '../../shell.js';
import { emptyState } from '../../ui.js';
import { card, fa, faDateTime, loadingNode, pageHead } from '../common.js';
import { studentTabs } from './tabs.js';

export async function renderStudentHistory() {
  setTopbarTitle('تاریخچه امتیازها');
  const body = el('div', {}, [loadingNode()]);
  renderView([body]);

  let data;
  try {
    data = await api.get('/student/history?limit=100');
  } catch (error) {
    body.replaceChildren(emptyState({ icon: '⚠️', title: 'دریافت تاریخچه ناموفق بود', hint: errorMessage(error) }));
    return undefined;
  }

  const list = el('div');
  if ((data.items ?? []).length === 0) {
    list.appendChild(emptyState({ icon: '📜', title: 'هنوز تغییری ثبت نشده است' }));
  }
  for (const item of data.items ?? []) {
    list.appendChild(el('div.timeline-item', {}, [
      el(`span.timeline-item__delta${item.delta < 0 ? '.is-negative' : '.is-positive'}`, {
        text: `${item.delta > 0 ? '+' : '−'}${fa(Math.abs(item.delta))}`,
      }),
      el('div', { style: { flex: '1' } }, [
        el('div', {}, [
          el('strong', { text: item.columnName }),
          item.actorName ? el('span.small.muted', { text: ` · ${item.actorName}` }) : null,
        ]),
        el('div', { text: item.reason || 'بدون دلیل ثبت‌شده' }),
        el('div.small.muted', { text: `${faDateTime(item.createdAt)} · امتیاز کل پس از تغییر: ${fa(item.totalAfter)}` }),
      ]),
    ]));
  }

  const total = el('p.small.muted', { text: `مجموع تغییرات ثبت‌شده: ${fa(data.total ?? 0)}` });

  body.replaceChildren(
    pageHead({ icon: '📜', title: 'تاریخچه امتیازها', subtitle: 'همه تغییرات امتیاز شما به ترتیب زمانی' }),
    studentTabs('student/history'),
    card({ title: 'تغییرات من', icon: '📋' }, [total, list]),
  );
  return undefined;
}
