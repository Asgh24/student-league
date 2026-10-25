/** Student weekly class schedule: read-only, one row per weekday. */

import { api } from '../../api.js';
import { el } from '../../dom.js';
import { errorMessage } from '../../format.js';
import { renderView, setTopbarTitle } from '../../shell.js';
import { emptyState } from '../../ui.js';
import { card, fa, loadingNode, pageHead } from '../common.js';
import { studentTabs } from './tabs.js';

export async function renderStudentSchedule() {
  setTopbarTitle('برنامه هفتگی');
  const body = el('div', {}, [loadingNode()]);
  renderView([body]);

  let data;
  try {
    data = await api.get('/student/schedule');
  } catch (error) {
    body.replaceChildren(emptyState({ icon: '⚠️', title: 'دریافت برنامه هفتگی ناموفق بود', hint: errorMessage(error) }));
    return undefined;
  }

  const days = data.days ?? [];
  const periods = Number(data.periods) || 0;
  const slotMap = new Map((data.slots ?? []).map((slot) => [`${slot.dayIndex}:${slot.period}`, slot]));

  // Same orientation as the teacher grid: days are rows so the week does not
  // need a wide horizontal scroll on the student's phone.
  const table = el('table.grid-table');
  table.appendChild(el('thead', {}, [
    el('tr', {}, [
      el('th', { text: 'روز' }),
      ...Array.from({ length: periods }, (_, period) => el('th', { text: `زنگ ${fa(period + 1)}` })),
    ]),
  ]));
  const tbody = el('tbody');
  for (const day of days) {
    const row = el('tr', {}, [
      el('td', { text: day.label, style: { fontWeight: '700', whiteSpace: 'nowrap' } }),
    ]);
    for (let period = 0; period < periods; period += 1) {
      const slot = slotMap.get(`${day.index}:${period}`);
      row.appendChild(el('td', {}, slot
        ? [
            el('div', { text: slot.subject }),
            slot.note ? el('div.small.muted', { text: slot.note }) : null,
          ]
        : [el('span.muted', { text: '—' })]));
    }
    tbody.appendChild(row);
  }
  table.appendChild(tbody);

  const hasSlots = (data.slots ?? []).length > 0;

  body.replaceChildren(
    pageHead({ icon: '📅', title: 'برنامه هفتگی', subtitle: 'برنامهٔ کلاس شما در این هفته' }),
    studentTabs('student/schedule'),
    card({ title: 'جدول هفتگی', icon: '📅' }, [
      el('p.small.muted', { text: 'هر ردیف یک روز هفته است و هر ستون یک زنگ. خانه‌های خالی بدون درس هستند.' }),
      hasSlots
        ? el('div.table-wrap', {}, [table])
        : emptyState({ icon: '📅', title: 'برنامه‌ای برای این کلاس ثبت نشده است', hint: 'برنامه توسط معلم تنظیم می‌شود.' }),
    ]),
  );
  return undefined;
}
