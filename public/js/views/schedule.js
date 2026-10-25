/** Weekly class schedule grid (Saturday → Friday) editable in one save. */

import { api } from '../api.js';
import { el } from '../dom.js';
import { errorMessage } from '../format.js';
import { renderView, setLeaguePill, setTopbarTitle } from '../shell.js';
import { setLeagueId } from '../store.js';
import { emptyState, notify } from '../ui.js';
import { backToWorkbench, button, card, fa, loadingNode, pageHead } from './common.js';

export async function renderSchedule({ params }) {
  const leagueId = Number(params.id);
  setLeagueId(leagueId);
  setTopbarTitle('برنامه هفتگی');
  const body = el('div', {}, [loadingNode()]);
  renderView([body]);

  async function load() {
    body.replaceChildren(loadingNode());
    let league;
    let payload;
    try {
      [league, payload] = await Promise.all([
        api.get(`/leagues/${leagueId}`),
        api.get(`/leagues/${leagueId}/schedule`),
      ]);
    } catch (error) {
      body.replaceChildren(emptyState({ icon: '⚠️', title: 'دریافت برنامه هفتگی ناموفق بود', hint: errorMessage(error) }));
      return;
    }
    setLeaguePill({ name: league.league.name });

    const days = payload.days ?? [];
    const periods = Number(payload.periods) || 7;
    const slotMap = new Map();
    for (const slot of payload.slots ?? []) {
      slotMap.set(`${slot.dayIndex}:${slot.period}`, { subject: slot.subject ?? '', note: slot.note ?? '' });
    }

    const inputs = [];
    const table = el('table.grid-table');
    table.appendChild(el('thead', {}, [
      el('tr', {}, [
        el('th', { text: 'روز' }),
        ...Array.from({ length: periods }, (_, period) => el('th', { text: `زنگ ${fa(period + 1)}` })),
      ]),
    ]));

    // One row per weekday and one column per period: the whole week stays
    // readable without a long horizontal scan across seven day columns.
    const tbody = el('tbody');
    for (const day of days) {
      const row = el('tr', {}, [el('td', { text: day.label, style: { fontWeight: '700', whiteSpace: 'nowrap' } })]);
      for (let period = 0; period < periods; period += 1) {
        const current = slotMap.get(`${day.index}:${period}`) ?? { subject: '', note: '' };
        const subject = el('input', {
          type: 'text',
          value: current.subject,
          placeholder: 'درس',
          'aria-label': `${day.label} زنگ ${period + 1} درس`,
          style: { minWidth: '110px' },
        });
        const note = el('input', {
          type: 'text',
          value: current.note,
          placeholder: 'یادداشت',
          'aria-label': `${day.label} زنگ ${period + 1} یادداشت`,
          style: { minWidth: '90px', marginTop: '4px', fontSize: '0.8rem' },
        });
        inputs.push({ dayIndex: day.index, period, subject, note });
        row.appendChild(el('td', {}, [subject, note]));
      }
      tbody.appendChild(row);
    }
    table.appendChild(tbody);

    async function save() {
      const slots = inputs
        .map((entry) => ({
          dayIndex: entry.dayIndex,
          period: entry.period,
          subject: entry.subject.value.trim(),
          note: entry.note.value.trim(),
        }))
        .filter((slot) => slot.subject || slot.note);
      try {
        await api.put(`/leagues/${leagueId}/schedule`, { slots });
        notify.ok('برنامه هفتگی ذخیره شد');
        await load();
      } catch (error) {
        notify.error(errorMessage(error));
      }
    }

    body.replaceChildren(
      pageHead({
        icon: '🗂️',
        title: 'برنامه هفتگی',
        subtitle: `${league.league.name} · دانش‌آموزان این برنامه را در پنل خود می‌بینند`,
        actions: [
          button('ذخیره برنامه', { icon: '💾', onClick: save }),
          el('a.btn.btn--ghost', { href: `#/teacher/league/${leagueId}`, text: '↩️ لیگ' }),
          backToWorkbench(),
        ],
      }),
      card({ title: 'جدول هفتگی', icon: '📅' }, [
        el('p.small.muted', { text: 'هر ردیف یک روز هفته است و هر ستون یک زنگ. خانه‌های خالی ذخیره نمی‌شوند؛ برای حذف یک درس، متن آن را پاک کنید.' }),
        el('div.table-wrap', {}, [table]),
      ]),
    );
  }

  await load();
  return undefined;
}
