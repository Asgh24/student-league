/** Student homework: read-only list of class assignments with own status. */

import { api } from '../../api.js';
import { el } from '../../dom.js';
import { errorMessage } from '../../format.js';
import { renderView, setTopbarTitle } from '../../shell.js';
import { emptyState } from '../../ui.js';
import { card, chip, fa, faDate, grid, loadingNode, pageHead, statCard } from '../common.js';
import { studentTabs } from './tabs.js';

function statusChip(status) {
  return status === 'done'
    ? chip('✅ انجام‌شده', 'ok')
    : chip('⏳ انجام‌نشده', 'muted');
}

export async function renderStudentHomework() {
  setTopbarTitle('تکالیف من');
  const body = el('div', {}, [loadingNode()]);
  renderView([body]);

  let data;
  try {
    data = await api.get('/student/homework');
  } catch (error) {
    body.replaceChildren(emptyState({ icon: '⚠️', title: 'دریافت تکالیف ناموفق بود', hint: errorMessage(error) }));
    return undefined;
  }

  const items = data.items ?? [];
  const doneCount = items.filter((item) => item.status === 'done').length;
  const pendingCount = items.length - doneCount;

  const list = el('div');
  if (items.length === 0) {
    list.appendChild(emptyState({
      icon: '📚',
      title: 'هنوز تکلیفی ثبت نشده است',
      hint: 'وقتی معلم تکلیف جدیدی بگذارد، همین‌جا نمایش داده می‌شود.',
    }));
  }
  for (const item of items) {
    list.appendChild(el('div.timeline-item', {}, [
      el('div', { style: { flex: '1' } }, [
        el('div', {}, [
          el('strong', { text: item.title }),
          item.dueDate ? chip(`مهلت ${faDate(item.dueDate)}`, 'amber') : null,
        ]),
        item.description ? el('div.small.muted', { text: item.description }) : null,
        el('div.row', { style: { gap: '6px', marginTop: '4px' } }, [
          statusChip(item.status),
        ]),
      ]),
    ]));
  }

  body.replaceChildren(
    pageHead({
      icon: '📚',
      title: 'تکالیف من',
      subtitle: 'تکالیف کلاس شما و وضعیت انجام‌دادن آن‌ها',
    }),
    studentTabs('student/homework'),
    grid('grid--stats', [
      statCard({ label: 'تکالیف', value: fa(items.length), icon: '📚' }),
      statCard({ label: 'انجام‌شده', value: fa(doneCount), kind: 'ok', icon: '✅' }),
      statCard({ label: 'باقی‌مانده', value: fa(pendingCount), kind: pendingCount ? 'warn' : 'ok', icon: '⏳' }),
    ]),
    card({ title: 'فهرست تکالیف', icon: '📋' }, [list]),
  );
  return undefined;
}
