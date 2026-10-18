import { badRequest, notFound } from '../lib/errors.js';
import { normalizeFa } from '../lib/normalize.js';
import { roundTo } from '../lib/numbers.js';
import { getColumns, getLeague, readSettings } from '../repositories/leagues.js';
import {
  countEvaluations,
  createEvaluation,
  deleteEvaluation,
  evaluationStudents,
  findEvaluation,
  leagueEvaluationStats,
  listEvaluations,
  listSubjects,
  listTitles,
  studentEvaluations,
  updateEvaluation,
  upsertEvaluationScores,
} from '../repositories/evaluations.js';

/** Iranian school levels and the grades each of them contains. */
export const SCHOOL_LEVELS = ['پیش‌دبستانی', 'ابتدایی', 'متوسطهٔ اول', 'متوسطهٔ دوم'];

export const GRADES_BY_LEVEL = {
  'پیش‌دبستانی': [],
  'ابتدایی': ['اول', 'دوم', 'سوم', 'چهارم', 'پنجم', 'ششم'],
  'متوسطهٔ اول': ['هفتم', 'هشتم', 'نهم'],
  'متوسطهٔ دوم': ['دهم', 'یازدهم', 'دوازدهم'],
};

export const GRADES = Object.values(GRADES_BY_LEVEL).flat();

export const EVALUATION_KINDS = [
  { key: 'numeric', label: 'کمی (نمرهٔ ۰ تا ۲۰)' },
  { key: 'descriptive', label: 'توصیفی (بدون نمرهٔ عددی)' },
];

/** Qualitative levels used by descriptive evaluations. */
export const DESCRIPTIVE_LEVELS = [
  { key: 'excellent', label: 'خیلی خوب', icon: '🌟' },
  { key: 'good', label: 'خوب', icon: '👍' },
  { key: 'fair', label: 'قابل قبول', icon: '🙂' },
  { key: 'needs-work', label: 'نیاز به تلاش', icon: '🎯' },
];

export function descriptiveLevel(key) {
  return DESCRIPTIVE_LEVELS.find((level) => level.key === key) ?? null;
}

/**
 * Bands a numeric mark using the usual Iranian convention (based on the ratio to
 * the maximum): 20 = عالی، ۱۸+ = خیلی خوب، ۱۵+ = خوب، ۱۰+ = قابل قبول.
 */
export function numericBand(score, scaleMax = 20) {
  if (score === null || score === undefined) return null;
  const max = Number(scaleMax) || 20;
  const ratio = Number(score) / max;
  if (ratio >= 1) return { key: 'excellent', label: 'عالی', icon: '🌟' };
  if (ratio >= 0.9) return { key: 'very-good', label: 'خیلی خوب', icon: '💎' };
  if (ratio >= 0.75) return { key: 'good', label: 'خوب', icon: '👍' };
  if (ratio >= 0.5) return { key: 'fair', label: 'قابل قبول', icon: '🙂' };
  return { key: 'needs-work', label: 'نیاز به تلاش', icon: '🎯' };
}

/** Finds the league score column whose name matches the subject (link only). */
export function resolveColumnId(db, leagueId, subject) {
  const wanted = normalizeFa(subject);
  if (!wanted) return null;
  const column = getColumns(db, leagueId).find((item) => normalizeFa(item.name) === wanted);
  return column ? column.id : null;
}

export function createForTeacher(db, leagueId, teacherId, input) {
  const columnId = input.columnId ?? resolveColumnId(db, leagueId, input.subject);
  return createEvaluation(db, leagueId, teacherId, { ...input, columnId });
}

export function updateForTeacher(db, leagueId, evaluationId, input) {
  const patch = { ...input };
  if (patch.subject !== undefined) {
    patch.columnId = resolveColumnId(db, leagueId, patch.subject);
  }
  const updated = updateEvaluation(db, evaluationId, patch);
  if (!updated) throw notFound('ارزشیابی یافت نشد');
  return updated;
}

export function removeForTeacher(db, evaluationId) {
  deleteEvaluation(db, evaluationId);
  return { ok: true };
}

/** Everything the teacher page needs: list, filters, aggregates and form options. */
export function listForTeacher(db, leagueId, query = {}) {
  const league = getLeague(db, leagueId);
  const settings = readSettings(db, leagueId);
  return {
    league: { id: leagueId, name: league?.name ?? '', grade: settings.grade ?? '' },
    items: listEvaluations(db, leagueId, query),
    total: countEvaluations(db, leagueId, query),
    stats: leagueEvaluationStats(db, leagueId),
    subjects: listSubjects(db, leagueId),
    titles: listTitles(db, leagueId),
    columns: getColumns(db, leagueId).map((column) => ({ id: column.id, name: column.name, step: column.step })),
    options: {
      levels: SCHOOL_LEVELS,
      grades: GRADES,
      gradesByLevel: GRADES_BY_LEVEL,
      kinds: EVALUATION_KINDS,
      descriptive: DESCRIPTIVE_LEVELS,
    },
  };
}

export function requireEvaluation(db, evaluationId, leagueId) {
  const evaluation = findEvaluation(db, evaluationId);
  if (!evaluation || evaluation.leagueId !== leagueId) throw notFound('ارزشیابی یافت نشد');
  return evaluation;
}

export function detailForTeacher(db, evaluationId, leagueId) {
  const evaluation = requireEvaluation(db, evaluationId, leagueId);
  return { evaluation, students: evaluationStudents(db, evaluationId, leagueId) };
}

/** Normalizes one submitted mark against the evaluation kind and scale. */
function normalizeMark(evaluation, row) {
  const studentId = Number(row.studentId);
  if (!Number.isFinite(studentId)) throw badRequest('INVALID_STUDENT', 'دانش‌آموز نامعتبر است');

  if (evaluation.kind === 'descriptive') {
    const label = String(row.label ?? '').trim();
    if (label && !descriptiveLevel(label)) throw badRequest('INVALID_LABEL', 'سطح توصیفی نامعتبر است');
    return { studentId, score: null, label, note: row.note ?? '' };
  }

  const raw = row.score;
  const score = raw === null || raw === undefined || raw === '' ? null : Number(raw);
  if (score !== null) {
    if (!Number.isFinite(score)) throw badRequest('INVALID_SCORE', 'نمره نامعتبر است');
    if (score < evaluation.scaleMin || score > evaluation.scaleMax) {
      throw badRequest('INVALID_SCORE', `نمره باید بین ${evaluation.scaleMin} و ${evaluation.scaleMax} باشد`);
    }
  }
  return { studentId, score, label: '', note: row.note ?? '' };
}

export function saveScores(db, evaluationId, leagueId, rows) {
  const evaluation = requireEvaluation(db, evaluationId, leagueId);
  const marks = rows.map((row) => normalizeMark(evaluation, row));
  const students = upsertEvaluationScores(db, evaluationId, leagueId, marks);
  return { evaluation: findEvaluation(db, evaluationId), students };
}

/** The student's own marks plus class aggregates (no other student is named). */
export function listForStudent(db, student, { limit = 200 } = {}) {
  const rows = studentEvaluations(db, student.id, student.leagueId).slice(0, limit);
  const items = rows.map((row) => ({
    ...row,
    band: row.kind === 'descriptive' ? descriptiveLevel(row.label) : numericBand(row.score, row.scaleMax),
  }));

  const numeric = items.filter((row) => typeof row.score === 'number');
  const average = numeric.length ? roundTo(numeric.reduce((acc, row) => acc + row.score, 0) / numeric.length) : null;

  const buckets = new Map();
  for (const row of numeric) {
    const bucket = buckets.get(row.subject) ?? { subject: row.subject, total: 0, count: 0 };
    bucket.total += row.score;
    bucket.count += 1;
    buckets.set(row.subject, bucket);
  }
  const subjects = [...buckets.values()]
    .map((bucket) => ({ subject: bucket.subject, average: roundTo(bucket.total / bucket.count), count: bucket.count }))
    .sort((a, b) => b.average - a.average || a.subject.localeCompare(b.subject, 'fa'));

  return {
    items,
    stats: {
      count: items.length,
      graded: numeric.length,
      average,
      bestSubject: subjects[0]?.subject ?? null,
      subjects,
    },
  };
}
