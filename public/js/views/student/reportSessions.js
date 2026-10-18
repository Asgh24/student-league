/**
 * Filter bar and "session" cards for the student report card. A session is one
 * recorded score change (subject + the teacher's topic/reason + derived quality)
 * and reads like a line of a term report.
 */

import { el } from '../../dom.js';
import { button, chip, fa, faDate } from '../common.js';

const QUALITY_KIND = {
  excellent: 'gold',
  'very-good': 'ok',
  good: 'amber',
  fair: 'muted',
  none: 'muted',
  negative: 'bad',
};

/** Coloured label describing a derived quality rating. */
export function qualityChip(quality) {
  const kind = QUALITY_KIND[quality?.key] ?? 'muted';
  const text = `${quality?.icon ?? ''} ${quality?.label ?? ''}`.trim();
  return chip(text, kind);
}

/**
 * Subject + Gregorian date-range filter. Dates are Gregorian `<input
 * type="date">` values (matching the attendance and homework screens); the
 * applied Jalali equivalent is shown next to the list.
 */
export function reportFilters({ columns = [], filters = {}, onApply, onReset }) {
  const select = el('select', { id: 'rc-column' }, [
    el('option', { value: '', text: 'همه دروس' }),
    ...columns.map((column) => el('option', { value: String(column.id), text: column.name })),
  ]);
  select.value = filters.columnId ? String(filters.columnId) : '';

  const from = el('input', { id: 'rc-from', type: 'date', value: filters.from ?? '' });
  const to = el('input', { id: 'rc-to', type: 'date', value: filters.to ?? '' });

  function apply() {
    onApply({
      columnId: select.value ? Number(select.value) : '',
      from: from.value || '',
      to: to.value || '',
    });
  }

  return el('div.filter-bar', {}, [
    el('div.field', {}, [el('label', { for: 'rc-column', text: 'درس' }), select]),
    el('div.field', {}, [el('label', { for: 'rc-from', text: 'از تاریخ (میلادی)' }), from]),
    el('div.field', {}, [el('label', { for: 'rc-to', text: 'تا تاریخ (میلادی)' }), to]),
    el('div.field', {}, [
      el('span.muted.small', { text: 'برای بازه باز، یک طرف را خالی بگذارید.' }),
      el('div.row', {}, [
        button('اعمال فیلتر', { icon: '🔎', kind: 'soft', onClick: apply }),
        button('پاک کردن', { icon: '🧹', kind: 'ghost', onClick: () => onReset() }),
      ]),
    ]),
  ]);
}

/** One recorded change rendered as a report-card line. */
export function sessionCard(session, { grade = '' } = {}) {
  const sign = session.delta < 0 ? '−' : '+';
  return el('article.session-card', {}, [
    el('div.session-card__head', {}, [
      el('h3.session-card__title', {
        text: session.topic ? `${session.columnName} — ${session.topic}` : session.columnName,
      }),
      el(`span.session-card__points${session.delta < 0 ? '.is-negative' : '.is-positive'}`, {
        text: `${sign}${fa(Math.abs(session.delta))}`,
      }),
    ]),
    el('div.session-card__meta', {}, [
      grade ? chip(`🎓 پایه ${grade}`, 'muted') : null,
      chip(`📅 ${faDate(session.createdAt)}`, 'muted'),
      qualityChip(session.quality),
      session.actorName ? chip(`🧑‍🏫 ${session.actorName}`, 'muted') : null,
    ]),
  ]);
}
