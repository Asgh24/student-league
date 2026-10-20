/** Mark sheet of one evaluation: per-student mark, bulk fill and save. */

import { api } from '../api.js';
import { el } from '../dom.js';
import { errorMessage } from '../format.js';
import { bandFor, bandKind, DESCRIPTIVE_LEVELS } from '../evaluationMeta.js';
import { notify } from '../ui.js';
import { button, card, chip, fa, faDate } from './common.js';

/**
 * Builds the grading card. `onSaved` receives the API payload (evaluation +
 * students) so the page can refresh its list and stats without a reload.
 */
export function gradingCard({ leagueId, detail, onSaved, onClose }) {
  const { evaluation, students } = detail;
  const inputs = new Map();
  const bandCells = new Map();
  const descriptive = evaluation.kind === 'descriptive';

  function markOf(studentId) {
    const control = inputs.get(studentId);
    if (!control) return { score: null, label: '' };
    if (descriptive) return { score: null, label: control.value };
    return { score: control.value === '' ? null : Number(control.value), label: '' };
  }

  function paintBand(studentId) {
    const cell = bandCells.get(studentId);
    if (!cell) return;
    const band = bandFor(evaluation, markOf(studentId));
    cell.replaceChildren(...(band ? [chip(`${band.icon} ${band.label}`, bandKind(band.key))] : [el('span.muted.small', { text: '—' })]));
  }

  function controlFor(student) {
    if (descriptive) {
      const select = el('select', { 'aria-label': `سطح ${student.name}` }, [
        el('option', { value: '', text: 'ثبت نشده' }),
        ...DESCRIPTIVE_LEVELS.map((level) => el('option', { value: level.key, text: level.label })),
      ]);
      select.value = student.label ?? '';
      return select;
    }
    return el('input', {
      type: 'number',
      min: evaluation.scaleMin,
      max: evaluation.scaleMax,
      step: '0.25',
      value: student.score === null || student.score === undefined ? '' : String(student.score),
      'aria-label': `نمره ${student.name}`,
    });
  }

  const rows = [];
  for (const student of students) {
    const control = controlFor(student);
    control.addEventListener('input', () => paintBand(student.studentId));
    control.addEventListener('change', () => paintBand(student.studentId));
    inputs.set(student.studentId, control);

    const bandCell = el('td');
    bandCells.set(student.studentId, bandCell);
    rows.push(el('tr', {}, [
      el('td.name-cell', { text: student.name }),
      el('td', {}, [control]),
      bandCell,
    ]));
    paintBand(student.studentId);
  }

  function fill(value) {
    for (const student of students) {
      const control = inputs.get(student.studentId);
      if (!control) continue;
      if (descriptive) control.value = value;
      else control.value = value === null ? '' : String(value);
      paintBand(student.studentId);
    }
  }

  async function save() {
    const scores = students.map((student) => {
      const mark = markOf(student.studentId);
      return { studentId: student.studentId, score: mark.score, label: mark.label };
    });
    try {
      const payload = await api.put(`/leagues/${leagueId}/evaluations/${evaluation.id}/scores`, { scores });
      notify.ok('نمرات ذخیره شد');
      onSaved(payload);
    } catch (error) {
      notify.error(errorMessage(error));
    }
  }

  const bulk = descriptive
    ? DESCRIPTIVE_LEVELS.map((level) => button(level.label, { kind: 'ghost', icon: level.icon, onClick: () => fill(level.key) }))
    : [
      button(`نمرهٔ کامل (${fa(evaluation.scaleMax)})`, { kind: 'ghost', icon: '💯', onClick: () => fill(evaluation.scaleMax) }),
      button('صفر', { kind: 'ghost', icon: '0️⃣', onClick: () => fill(evaluation.scaleMin) }),
    ];
  bulk.push(button('پاک کردن همه', { kind: 'ghost', icon: '🧹', onClick: () => fill(null) }));

  const marked = students.filter((student) => (descriptive ? student.label : student.score !== null && student.score !== undefined)).length;

  const table = el('div.table-wrap', {}, [
    el('table.grid-table', {}, [
      el('thead', {}, [el('tr', {}, [el('th', { text: 'دانش‌آموز' }), el('th', { text: 'نمره' }), el('th', { text: 'سطح' })])]),
      el('tbody', {}, rows),
    ]),
  ]);

  return card({
    title: `نمرات ${evaluation.subject} — ${evaluation.title}`,
    icon: '📝',
    actions: [
      button('ذخیره نمرات', { kind: 'soft', icon: '💾', onClick: save }),
      button('بستن', { kind: 'ghost', icon: '✖️', onClick: onClose }),
    ],
  }, [
    el('div.row', { style: { gap: '6px', flexWrap: 'wrap' } }, [
      evaluation.level ? chip(`🏫 ${evaluation.level}`, 'muted') : null,
      evaluation.grade ? chip(`🎓 پایه ${evaluation.grade}`, 'muted') : null,
      chip(`📅 ${faDate(evaluation.heldOn)}`, 'muted'),
      chip(descriptive ? '📝 توصیفی' : `⚖️ مقیاس ${fa(evaluation.scaleMin)} تا ${fa(evaluation.scaleMax)}`),
      chip(`ثبت‌شده ${fa(marked)} از ${fa(students.length)}`, marked === students.length ? 'ok' : 'amber'),
      chip(detail.scoring?.enabled && evaluation.columnId ? '🔗 طبق تنظیمات به امتیاز لیگ منتقل می‌شود' : 'بدون اثر روی امتیاز لیگ', detail.scoring?.enabled && evaluation.columnId ? 'ok' : 'muted'),
    ]),
    el('div.row', { style: { gap: '6px', flexWrap: 'wrap', margin: '10px 0' } }, bulk),
    students.length ? table : el('p.muted.small', { text: 'دانش‌آموزی در این لیگ ثبت نشده است.' }),
  ]);
}
