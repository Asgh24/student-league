/** Shared presentation for the teacher and student manual report-card views. */

import { el } from '../dom.js';
import { emptyState, statCard } from '../ui.js';
import { card, chip, fa, faDate } from './common.js';

export const REPORT_CARD_LEVELS = [
  { value: 'very_good', label: 'خیلی خوب', icon: '🌟' },
  { value: 'good', label: 'خوب', icon: '👍' },
  { value: 'acceptable', label: 'قابل قبول', icon: '🙂' },
  { value: 'needs_improvement', label: 'نیاز به تلاش بیشتر', icon: '🎯' },
];

export function levelLabel(value) {
  return REPORT_CARD_LEVELS.find((level) => level.value === value)?.label ?? '';
}

function scoreText(evaluation) {
  if (evaluation.kind === 'descriptive') {
    return evaluation.band?.label || evaluation.label || '—';
  }
  if (evaluation.score === null || evaluation.score === undefined) return '—';
  return `${fa(evaluation.score)}${evaluation.band?.label ? ` · ${evaluation.band.label}` : ''}`;
}

function evaluationRow(evaluation) {
  return el('tr', {}, [
    el('td', {}, [
      el('strong', { text: evaluation.subject }),
      el('div.small.muted', { text: evaluation.title }),
    ]),
    el('td', { text: faDate(evaluation.heldOn) }),
    el('td', {}, [
      el('span', { text: scoreText(evaluation) }),
      evaluation.rank ? el('span.chip.chip--muted', { text: `رتبه ${fa(evaluation.rank)}` }) : null,
    ]),
    el('td', { text: evaluation.average === null || evaluation.average === undefined ? '—' : fa(evaluation.average) }),
    el('td', { text: evaluation.awardedPoints ? `+${fa(evaluation.awardedPoints)}` : '—' }),
  ]);
}

/**
 * The bottom panel requested by the teacher: evaluation achievements, league
 * points/rank, championships, attendance and the current score columns.
 */
export function renderPerformancePanel(performance) {
  if (!performance) return null;
  const league = performance.league ?? {};
  const attendance = performance.attendance ?? {};
  const evaluations = performance.evaluations ?? [];
  const championships = performance.championships ?? [];
  const columns = performance.columns ?? [];
  const attendanceRatio = attendance.recorded
    ? Math.round((attendance.attended / attendance.recorded) * 100)
    : null;

  const evaluationCard = card({ title: 'دستاوردهای ارزشیابی', icon: '📝' }, [
    evaluations.length
      ? el('div.table-wrap', {}, [
        el('table.grid-table', {}, [
          el('thead', {}, [
            el('tr', {}, [
              el('th', { text: 'درس / ارزشیابی' }),
              el('th', { text: 'تاریخ' }),
              el('th', { text: 'نتیجه' }),
              el('th', { text: 'میانگین کلاس' }),
              el('th', { text: 'امتیاز' }),
            ]),
          ]),
          el('tbody', {}, evaluations.map(evaluationRow)),
        ]),
      ])
      : emptyState({
        icon: '📝',
        title: 'هنوز ارزشیابی ثبت نشده',
        hint: 'نمره‌های بخش ارزشیابی پس از ثبت، همین‌جا نمایش داده می‌شوند.',
      }),
  ]);

  const championshipCard = card({ title: 'قهرمانی‌ها و نشان‌ها', icon: '🏆' }, [
    championships.length
      ? el('div.report-card-badges', {}, championships.map((item) => chip(
        `${item.rank === 1 ? '🥇' : item.rank === 2 ? '🥈' : '🥉'} ${item.title}`,
        item.rank === 1 ? 'ok' : 'muted',
      )))
      : el('p.muted.small', { text: 'هنوز قهرمانی یا نشانی ثبت نشده است.' }),
    (performance.manualAchievements ?? []).length
      ? el('div.report-card-achievements', {}, performance.manualAchievements.map((item) => el('div.report-card-achievement', {}, [
        el('span', { text: item.icon || '🏆' }),
        el('div', {}, [
          el('strong', { text: item.title }),
          item.description ? el('div.small.muted', { text: item.description }) : null,
        ]),
        item.points ? chip(`+${fa(item.points)}`, 'ok') : null,
      ])))
      : null,
  ]);

  const columnsCard = card({ title: 'امتیازهای لیگ', icon: '📊' }, [
    columns.length
      ? el('div.report-card-columns', {}, columns.map((column) => el('div.report-card-column', {}, [
        el('span', { text: column.name }),
        el('strong', { text: fa(column.value) }),
      ])))
      : el('p.muted.small', { text: 'ستون امتیازی برای این لیگ تعریف نشده است.' }),
  ]);

  return el('div.report-card-performance', {}, [
    el('div.grid.grid--stats', {}, [
      statCard({ label: 'امتیاز فعلی لیگ', value: fa(league.points ?? 0), icon: league.titleIcon ?? '🏅' }),
      statCard({
        label: 'رتبه در کلاس',
        value: league.rank ? `${fa(league.rank)} از ${fa(league.totalStudents ?? 0)}` : '—',
        icon: '🥇',
      }),
      statCard({ label: 'عنوان فعلی', value: league.title || '—', icon: '🎖️' }),
      statCard({
        label: 'حضور در کلاس',
        value: attendanceRatio === null ? 'ثبت نشده' : `${fa(attendanceRatio)}٪`,
        kind: attendanceRatio !== null && attendanceRatio < 70 ? 'bad' : 'ok',
        icon: '🗓️',
      }),
      statCard({ label: 'امتیاز ارزشیابی‌ها', value: fa(performance.evaluationPoints ?? 0), icon: '✨' }),
    ]),
    evaluationCard,
    el('div.report-card-performance__two', {}, [championshipCard, columnsCard]),
    el('p.small.muted', {
      text: `حضور: ${fa(attendance.attended ?? 0)} روز حاضر/با تأخیر از ${fa(attendance.recorded ?? 0)} روز ثبت‌شده — غایب: ${fa(attendance.absent ?? 0)} روز`,
    }),
  ]);
}
