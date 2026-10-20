import { badRequest, notFound } from '../lib/errors.js';
import { normalizeFa } from '../lib/normalize.js';
import { roundTo } from '../lib/numbers.js';
import { getColumns, getLeague, readSettings, writeSettings } from '../repositories/leagues.js';
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
import { applyScoreDelta } from './scoring.js';

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

/**
 * Points awarded per qualitative level. The numeric «عالی» band shares the top
 * value with «خیلی خوب»: a full mark and 18/20 both count as excellent.
 */
const LEVEL_SETTING_KEYS = {
  excellent: 'evalPointsExcellent',
  good: 'evalPointsGood',
  fair: 'evalPointsFair',
  'needs-work': 'evalPointsNeedsWork',
};

/** Public shape of the scoring settings for the teacher UI. */
export function scoringPayload(settings) {
  return {
    enabled: settings.evalPointsEnabled,
    excellent: settings.evalPointsExcellent,
    good: settings.evalPointsGood,
    fair: settings.evalPointsFair,
    needsWork: settings.evalPointsNeedsWork,
  };
}

/**
 * League points for one mark, using the league's scoring settings. Returns 0
 * when scoring is disabled, the mark is empty or the evaluation has no column.
 */
export function pointsForMark(settings, evaluation, mark) {
  if (!settings.evalPointsEnabled) return 0;
  const band = evaluation.kind === 'descriptive'
    ? (mark.label ? descriptiveLevel(mark.label) : null)
    : numericBand(mark.score, evaluation.scaleMax);
  if (!band) return 0;
  const key = band.key === 'very-good' ? 'excellent' : band.key;
  const value = Number(settings[LEVEL_SETTING_KEYS[key]] ?? 0);
  return Number.isFinite(value) ? Math.trunc(value) : 0;
}

function awardReason(evaluation) {
  return `ارزشیابی «${evaluation.title}»`;
}

/** Applies one points delta for a mark, if both the student and column still exist. */
function applyAward(db, evaluation, studentId, columnId, delta, actor) {
  if (!delta || !columnId) return;
  const student = db.prepare('SELECT * FROM students WHERE id = ? AND league_id = ?').get(studentId, evaluation.leagueId);
  const column = db.prepare('SELECT * FROM columns WHERE id = ? AND league_id = ?').get(columnId, evaluation.leagueId);
  if (!student || !column) return;
  applyScoreDelta(db, {
    leagueId: evaluation.leagueId,
    student,
    column,
    delta,
    reason: awardReason(evaluation),
    actor,
  });
}

/**
 * Brings the points awarded by one evaluation in line with its current marks and
 * the league settings. Only the difference is applied, so calling it twice (or
 * after an unrelated edit) never double counts.
 */
export function reconcileEvaluationAwards(db, evaluationId, actor = null) {
  const run = db.transaction(() => {
    const evaluation = findEvaluation(db, evaluationId);
    if (!evaluation) return;
    const settings = readSettings(db, evaluation.leagueId);
    const rows = db.prepare(`
      SELECT id, student_id AS studentId, score, label,
             awarded_points AS awardedPoints, awarded_column_id AS awardedColumnId
      FROM evaluation_scores WHERE evaluation_id = ?
    `).all(evaluationId);
    const update = db.prepare('UPDATE evaluation_scores SET awarded_points = ?, awarded_column_id = ? WHERE id = ?');

    for (const row of rows) {
      const points = evaluation.columnId ? pointsForMark(settings, evaluation, row) : 0;
      const columnId = points ? evaluation.columnId : null;
      const previousPoints = Number(row.awardedPoints ?? 0);
      const previousColumnId = row.awardedColumnId ?? null;
      if (previousPoints === points && previousColumnId === columnId) continue;

      if (previousPoints) applyAward(db, evaluation, row.studentId, previousColumnId, -previousPoints, actor);
      if (points) applyAward(db, evaluation, row.studentId, columnId, points, actor);
      update.run(points, columnId, row.id);
    }
  });
  run();
}

/** Re-applies the awards of every evaluation of a league (used when settings change). */
export function reconcileLeagueAwards(db, leagueId, actor = null) {
  const ids = db.prepare('SELECT id FROM evaluations WHERE league_id = ?').all(leagueId);
  const run = db.transaction(() => {
    for (const row of ids) reconcileEvaluationAwards(db, row.id, actor);
  });
  run();
}

/** Reverses the points of all marks of an evaluation without touching the marks. */
function reverseEvaluationAwards(db, evaluation, actor) {
  const rows = db.prepare(`
    SELECT student_id AS studentId, awarded_points AS awardedPoints, awarded_column_id AS awardedColumnId
    FROM evaluation_scores WHERE evaluation_id = ?
  `).all(evaluation.id);
  for (const row of rows) {
    const points = Number(row.awardedPoints ?? 0);
    if (points) applyAward(db, evaluation, row.studentId, row.awardedColumnId, -points, actor);
  }
}

/**
 * Clearing a mark deletes its row, so the reconciliation below cannot see it
 * anymore. This reverses the award of rows that disappeared during a save.
 */
function reverseRemovedAwards(db, evaluation, previousRows, actor) {
  const alive = new Set(
    db.prepare('SELECT student_id AS studentId FROM evaluation_scores WHERE evaluation_id = ?')
      .all(evaluation.id)
      .map((row) => row.studentId),
  );
  for (const row of previousRows) {
    const points = Number(row.awardedPoints ?? 0);
    if (!alive.has(row.studentId) && points) {
      applyAward(db, evaluation, row.studentId, row.awardedColumnId, -points, actor);
    }
  }
}

/** Persists the scoring settings and updates the points already awarded. */
export function updateScoringForLeague(db, leagueId, input, actor = null) {
  const run = db.transaction(() => {
    writeSettings(db, leagueId, {
      evalPointsEnabled: input.enabled,
      evalPointsExcellent: input.excellent,
      evalPointsGood: input.good,
      evalPointsFair: input.fair,
      evalPointsNeedsWork: input.needsWork,
    });
    reconcileLeagueAwards(db, leagueId, actor);
    return scoringPayload(readSettings(db, leagueId));
  });
  return run();
}

export function createForTeacher(db, leagueId, teacherId, input) {
  const columnId = input.columnId ?? resolveColumnId(db, leagueId, input.subject);
  return createEvaluation(db, leagueId, teacherId, { ...input, columnId });
}

export function updateForTeacher(db, leagueId, evaluationId, input, actor = null) {
  const patch = { ...input };
  if (patch.subject !== undefined) {
    patch.columnId = resolveColumnId(db, leagueId, patch.subject);
  }
  const updated = updateEvaluation(db, evaluationId, patch);
  if (!updated) throw notFound('ارزشیابی یافت نشد');
  reconcileEvaluationAwards(db, evaluationId, actor);
  return findEvaluation(db, evaluationId);
}

export function removeForTeacher(db, evaluationId, actor = null) {
  const evaluation = findEvaluation(db, evaluationId);
  if (evaluation) {
    const run = db.transaction(() => {
      reverseEvaluationAwards(db, evaluation, actor);
      deleteEvaluation(db, evaluationId);
    });
    run();
  }
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
    scoring: scoringPayload(settings),
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
  return {
    evaluation,
    students: evaluationStudents(db, evaluationId, leagueId),
    scoring: scoringPayload(readSettings(db, leagueId)),
  };
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

export function saveScores(db, evaluationId, leagueId, rows, actor = null) {
  const evaluation = requireEvaluation(db, evaluationId, leagueId);
  const marks = rows.map((row) => normalizeMark(evaluation, row));
  const run = db.transaction(() => {
    const previous = db.prepare(`
      SELECT student_id AS studentId, awarded_points AS awardedPoints, awarded_column_id AS awardedColumnId
      FROM evaluation_scores WHERE evaluation_id = ?
    `).all(evaluationId);
    const students = upsertEvaluationScores(db, evaluationId, leagueId, marks);
    reverseRemovedAwards(db, evaluation, previous, actor);
    reconcileEvaluationAwards(db, evaluationId, actor);
    return { evaluation: findEvaluation(db, evaluationId), students };
  });
  return run();
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
