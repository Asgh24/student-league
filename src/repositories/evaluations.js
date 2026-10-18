import { roundTo } from '../lib/numbers.js';
import { isoNow } from '../lib/http.js';
import { sortByName } from './leagues.js';

/** Row shape shared by the teacher list and the student list. */
const EVALUATION_COLUMNS = `
  e.id, e.league_id AS leagueId, e.subject, e.title, e.level, e.grade, e.kind,
  e.scale_min AS scaleMin, e.scale_max AS scaleMax,
  e.held_on AS heldOn, e.note, e.column_id AS columnId,
  e.created_at AS createdAt, e.updated_at AS updatedAt
`;

const AGGREGATES = `
  (SELECT COUNT(*) FROM evaluation_scores es WHERE es.evaluation_id = e.id AND (es.score IS NOT NULL OR es.label <> '')) AS gradedCount,
  (SELECT COUNT(*) FROM students s WHERE s.league_id = e.league_id) AS studentCount,
  (SELECT AVG(es.score) FROM evaluation_scores es WHERE es.evaluation_id = e.id AND es.score IS NOT NULL) AS average,
  (SELECT MIN(es.score) FROM evaluation_scores es WHERE es.evaluation_id = e.id AND es.score IS NOT NULL) AS minScore,
  (SELECT MAX(es.score) FROM evaluation_scores es WHERE es.evaluation_id = e.id AND es.score IS NOT NULL) AS maxScore
`;

function decorate(row) {
  if (!row) return null;
  return {
    ...row,
    average: roundTo(row.average),
    minScore: row.minScore === null || row.minScore === undefined ? null : row.minScore,
    maxScore: row.maxScore === null || row.maxScore === undefined ? null : row.maxScore,
  };
}

/** Evaluations of a league, newest first, optionally filtered by subject and date. */
export function listEvaluations(db, leagueId, { subject = null, from = null, to = null, limit = 200, offset = 0 } = {}) {
  const where = ['e.league_id = ?'];
  const params = [leagueId];
  if (subject) {
    where.push('e.subject = ?');
    params.push(subject);
  }
  if (from) {
    where.push('e.held_on >= ?');
    params.push(from);
  }
  if (to) {
    where.push('e.held_on <= ?');
    params.push(to);
  }
  const rows = db.prepare(`
    SELECT ${EVALUATION_COLUMNS}, ${AGGREGATES}
    FROM evaluations e
    WHERE ${where.join(' AND ')}
    ORDER BY e.held_on DESC, e.id DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);
  return rows.map(decorate);
}

/** Count of evaluations matching the same filters (for pagination). */
export function countEvaluations(db, leagueId, { subject = null, from = null, to = null } = {}) {
  const where = ['league_id = ?'];
  const params = [leagueId];
  if (subject) {
    where.push('subject = ?');
    params.push(subject);
  }
  if (from) {
    where.push('held_on >= ?');
    params.push(from);
  }
  if (to) {
    where.push('held_on <= ?');
    params.push(to);
  }
  return db.prepare(`SELECT COUNT(*) AS n FROM evaluations WHERE ${where.join(' AND ')}`).get(...params).n;
}

/** Headline numbers of the evaluations page. */
export function leagueEvaluationStats(db, leagueId) {
  const row = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM evaluations WHERE league_id = ?) AS count,
      (SELECT COUNT(DISTINCT subject) FROM evaluations WHERE league_id = ?) AS subjectCount,
      (SELECT COUNT(*) FROM students WHERE league_id = ?) AS studentCount,
      (SELECT COUNT(*) FROM evaluation_scores es JOIN evaluations e ON e.id = es.evaluation_id
        WHERE e.league_id = ? AND (es.score IS NOT NULL OR es.label <> '')) AS gradedCount,
      (SELECT AVG(es.score) FROM evaluation_scores es JOIN evaluations e ON e.id = es.evaluation_id
        WHERE e.league_id = ? AND es.score IS NOT NULL) AS average
  `).get(leagueId, leagueId, leagueId, leagueId, leagueId);
  return {
    count: row.count ?? 0,
    subjectCount: row.subjectCount ?? 0,
    studentCount: row.studentCount ?? 0,
    gradedCount: row.gradedCount ?? 0,
    average: roundTo(row.average),
  };
}

/** Distinct subjects used by a league, for the filter dropdown. */
export function listSubjects(db, leagueId) {
  return db.prepare('SELECT DISTINCT subject FROM evaluations WHERE league_id = ? ORDER BY subject ASC')
    .all(leagueId)
    .map((row) => row.subject);
}

/** Titles already used in the league, so the form can offer suggestions. */
export function listTitles(db, leagueId) {
  return db.prepare('SELECT DISTINCT title FROM evaluations WHERE league_id = ? ORDER BY id DESC LIMIT 40')
    .all(leagueId)
    .map((row) => row.title);
}

export function findEvaluation(db, evaluationId) {
  return decorate(db.prepare(`
    SELECT ${EVALUATION_COLUMNS}, ${AGGREGATES}
    FROM evaluations e WHERE e.id = ?
  `).get(evaluationId));
}

export function createEvaluation(db, leagueId, teacherId, data) {
  const now = isoNow();
  const info = db.prepare(`
    INSERT INTO evaluations
      (league_id, teacher_id, subject, title, level, grade, kind, scale_min, scale_max, held_on, note, column_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    leagueId,
    teacherId,
    data.subject,
    data.title,
    data.level ?? '',
    data.grade ?? '',
    data.kind ?? 'numeric',
    data.scaleMin ?? 0,
    data.scaleMax ?? 20,
    data.heldOn,
    data.note ?? '',
    data.columnId ?? null,
    now,
    now,
  );
  return findEvaluation(db, Number(info.lastInsertRowid));
}

export function updateEvaluation(db, evaluationId, patch) {
  const current = findEvaluation(db, evaluationId);
  if (!current) return null;
  db.prepare(`
    UPDATE evaluations
    SET subject = ?, title = ?, level = ?, grade = ?, kind = ?, scale_min = ?, scale_max = ?,
        held_on = ?, note = ?, column_id = ?, updated_at = ?
    WHERE id = ?
  `).run(
    patch.subject ?? current.subject,
    patch.title ?? current.title,
    patch.level ?? current.level,
    patch.grade ?? current.grade,
    patch.kind ?? current.kind,
    patch.scaleMin ?? current.scaleMin,
    patch.scaleMax ?? current.scaleMax,
    patch.heldOn ?? current.heldOn,
    patch.note ?? current.note,
    patch.columnId === undefined ? current.columnId : patch.columnId,
    isoNow(),
    evaluationId,
  );
  return findEvaluation(db, evaluationId);
}

export function deleteEvaluation(db, evaluationId) {
  db.prepare('DELETE FROM evaluations WHERE id = ?').run(evaluationId);
}

/** Every student of the league with their mark on this evaluation (may be null). */
export function evaluationStudents(db, evaluationId, leagueId) {
  const rows = db.prepare(`
    SELECT s.id AS studentId, s.name AS name,
           es.score AS score, COALESCE(es.label, '') AS label,
           COALESCE(es.note, '') AS note, es.updated_at AS updatedAt
    FROM students s
    LEFT JOIN evaluation_scores es ON es.student_id = s.id AND es.evaluation_id = ?
    WHERE s.league_id = ?
  `).all(evaluationId, leagueId);
  return sortByName(rows);
}

/**
 * Replaces the marks of an evaluation in one transaction. A row with neither a
 * score nor a label removes the mark (that is what "پاک کردن" does).
 */
export function upsertEvaluationScores(db, evaluationId, leagueId, rows) {
  const run = db.transaction(() => {
    const students = new Set(db.prepare('SELECT id FROM students WHERE league_id = ?').all(leagueId).map((row) => row.id));
    const insert = db.prepare(`
      INSERT INTO evaluation_scores (evaluation_id, student_id, score, label, note, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (evaluation_id, student_id) DO UPDATE SET
        score = excluded.score, label = excluded.label, note = excluded.note, updated_at = excluded.updated_at
    `);
    const remove = db.prepare('DELETE FROM evaluation_scores WHERE evaluation_id = ? AND student_id = ?');
    const now = isoNow();
    for (const row of rows) {
      if (!students.has(row.studentId)) continue;
      const score = row.score === undefined || row.score === null ? null : Number(row.score);
      const label = row.label ?? '';
      if (score === null && !label) remove.run(evaluationId, row.studentId);
      else insert.run(evaluationId, row.studentId, score, label, row.note ?? '', now);
    }
  });
  run();
  return evaluationStudents(db, evaluationId, leagueId);
}

/**
 * The marks a student can see: their own mark plus class aggregates (average and
 * rank). No other student is ever identified.
 */
export function studentEvaluations(db, studentId, leagueId) {
  const rows = db.prepare(`
    SELECT ${EVALUATION_COLUMNS},
           es.score AS score, COALESCE(es.label, '') AS label, COALESCE(es.note, '') AS note,
           es.updated_at AS gradedAt,
           (SELECT COUNT(*) FROM evaluation_scores x WHERE x.evaluation_id = e.id AND (x.score IS NOT NULL OR x.label <> '')) AS gradedCount,
           (SELECT COUNT(*) FROM students s WHERE s.league_id = e.league_id) AS studentCount,
           (SELECT AVG(x.score) FROM evaluation_scores x WHERE x.evaluation_id = e.id AND x.score IS NOT NULL) AS average,
           (SELECT MAX(x.score) FROM evaluation_scores x WHERE x.evaluation_id = e.id AND x.score IS NOT NULL) AS topScore,
           (SELECT COUNT(*) FROM evaluation_scores x WHERE x.evaluation_id = e.id AND x.score > es.score) AS aboveMe
    FROM evaluations e
    LEFT JOIN evaluation_scores es ON es.evaluation_id = e.id AND es.student_id = ?
    WHERE e.league_id = ?
    ORDER BY e.held_on DESC, e.id DESC
  `).all(studentId, leagueId);
  return rows.map(({ aboveMe, ...row }) => ({
    ...row,
    average: roundTo(row.average),
    rank: row.score === null || row.score === undefined ? null : (aboveMe ?? 0) + 1,
  }));
}
