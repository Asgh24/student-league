/** Student attendance: personal ratio summary and the day-by-day record. */

import { api } from '../../api.js';
import { el } from '../../dom.js';
import { errorMessage } from '../../format.js';
import { renderView, setTopbarTitle } from '../../shell.js';
import { emptyState } from '../../ui.js';
import { card, chip, fa, faDate, grid, loadingNode, pageHead, ratioChip, STATUS_KIND, STATUS_LABELS, statCard } from '../common.js';
import { studentTabs } from './tabs.js';

export async function renderStudentAttendance() {
  setTopbarTitle('حضور و غیاب من');
  const body = el('div', {}, [loadingNode()]);
  renderView([body]);

  let data;
  try {
    data = await api.get('/student/attendance?limit=100');
  } catch (error) {
    body.replaceChildren(emptyState({ icon: '⚠️', title: 'دریافت حضور و غیاب ناموفق بود', hint: errorMessage(error) }));
    return undefined;
  }

  const summary = data.summary ?? { recorded: 0, present: 0, late: 0, absent: 0, attended: 0 };

  const table = el('table.grid-table');
  table.appendChild(el('thead', {}, [
    el('tr', {}, [el('th', { text: 'تاریخ' }), el('th', { text: 'وضعیت' })]),
  ]));
  const tbody = el('tbody');
  for (const item of data.items ?? []) {
    tbody.appendChild(el('tr', {}, [
      el('td', { text: faDate(item.day) }),
      el('td', {}, [chip(STATUS_LABELS[item.status] ?? item.status, STATUS_KIND[item.status] ?? 'muted')]),
    ]));
  }
  table.appendChild(tbody);

  body.replaceChildren(
    pageHead({ icon: '🗓️', title: 'حضور و غیاب من', subtitle: 'فقط رکوردهای شخصی شما نمایش داده می‌شود' }),
    studentTabs('student/attendance'),
    grid('grid--stats', [
      statCard({ label: 'روزهای ثبت‌شده', value: fa(summary.recorded), icon: '🗓️' }),
      statCard({ label: 'حاضر', value: fa(summary.present), kind: 'ok', icon: '✅' }),
      statCard({ label: 'تأخیر', value: fa(summary.late), kind: 'warn', icon: '⏰' }),
      statCard({ label: 'غایب', value: fa(summary.absent), kind: 'bad', icon: '❌' }),
    ]),
    card({ title: 'خلاصه حضور من', icon: '📈' }, [
      el('div.row', {}, [ratioChip(summary.attended, summary.recorded)]),
      el('p.small.muted', { text: 'نسبت حضور = روزهای حاضر + تأخیر تقسیم بر روزهای ثبت‌شده.' }),
    ]),
    card({ title: 'ریز حضور', icon: '📋' }, [
      (data.items ?? []).length === 0
        ? emptyState({ icon: '🗓️', title: 'رکورد حضوری ثبت نشده است' })
        : el('div.table-wrap', {}, [table]),
    ]),
  );
  return undefined;
}
