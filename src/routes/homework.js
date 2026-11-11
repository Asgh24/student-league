import { Router } from 'express';
import { badRequest } from '../lib/errors.js';
import { isoNow } from '../lib/http.js';
import { schemas, validate } from '../lib/validate.js';
import { requireTeacher, loadOwnedLeague, requirePermission, teacherId } from '../middleware/auth.js';
import { ownedRow } from '../middleware/ownership.js';
import { findDisciplineColumn } from '../repositories/leagues.js';
import { applyScoreDelta } from '../services/scoring.js';
import {
  HOMEWORK_STATUS_LABELS,
  HOMEWORK_STATUSES,
  pointsForStatus,
} from '../lib/homeworkStatus.js';

export { HOMEWORK_STATUS_LABELS, HOMEWORK_STATUSES, pointsForStatus };

/**
 * Points rule per homework status lives in `src/lib/homeworkStatus.js`
 * (shared with the daily parent report). `homework_status.awarded` remembers
 * what was actually applied and `homework_status.column_id` remembers where it
 * went, so every change only moves the difference — even when the teacher
 * points the assignment at a different league column.
 */

function homeworkWithCounts(db, leagueId) {
  const rows = db.prepare(`
    SELECT h.id, h.title, h.description, h.due_date AS dueDate, h.points,
           h.penalty_points AS penaltyPoints, h.column_id AS columnId,
           c.name AS columnName, h.created_at AS createdAt,
           (SELECT COUNT(*) FROM homework_status hs WHERE hs.homework_id = h.id AND hs.status = 'done') AS doneCount,
           (SELECT COUNT(*) FROM homework_status hs WHERE hs.homework_id = h.id AND hs.status = 'absent') AS absentCount,
           (SELECT COUNT(*) FROM homework_status hs WHERE hs.homework_id = h.id AND hs.status = 'incomplete') AS incompleteCount,
           (SELECT COUNT(*) FROM homework_status hs WHERE hs.homework_id = h.id AND hs.status = 'not_brought') AS notBroughtCount,
           (SELECT COUNT(*) FROM students s WHERE s.league_id = h.league_id) AS studentCount
    FROM homework h
    LEFT JOIN columns c ON c.id = h.column_id
    WHERE h.league_id = ? ORDER BY h.id DESC
  `).all(leagueId);
  return rows.map((row) => ({ ...row, pendingCount: Math.max(0, row.studentCount - row.doneCount) }));
}

function statusRows(db, homeworkId) {
  const rows = db.prepare(`
    SELECT s.id AS studentId, s.name AS name, COALESCE(hs.status, 'not_done') AS status,
           COALESCE(hs.awarded, 0) AS awarded, hs.column_id AS columnId, hs.updated_at AS updatedAt
    FROM students s
    LEFT JOIN homework_status hs ON hs.student_id = s.id AND hs.homework_id = ?
    WHERE s.league_id = (SELECT league_id FROM homework WHERE id = ?)
    ORDER BY s.id ASC
  `).all(homeworkId, homeworkId);
  return rows;
}

/** Validates that a chosen column belongs to the league; null means "default". */
function resolveColumn(db, leagueId, columnId) {
  if (columnId === null || columnId === undefined || columnId === '') return null;
  const id = Number(columnId);
  if (!Number.isFinite(id)) throw badRequest('COLUMN_NOT_FOUND', 'ستون امتیازی انتخاب‌شده معتبر نیست');
  const column = db.prepare('SELECT * FROM columns WHERE id = ? AND league_id = ?').get(id, leagueId);
  if (!column) throw badRequest('COLUMN_NOT_FOUND', 'ستون امتیازی انتخاب‌شده برای این کلاس تعریف نشده است');
  return column;
}

/** The column an award goes to: the chosen column, else the legacy default. */
function homeworkColumn(db, homework) {
  return resolveColumn(db, homework.league_id, homework.column_id)
    ?? findDisciplineColumn(db, homework.league_id);
}

/**
 * Records one student's status and moves their league points by the
 * difference between the old and new award. Must run inside a transaction.
 */
function setHomeworkStatus(db, { homework, student, status, actor }) {
  const existing = db.prepare('SELECT status, awarded, column_id AS columnId FROM homework_status WHERE homework_id = ? AND student_id = ?')
    .get(homework.id, student.id);
  const oldAwarded = existing?.awarded ?? 0;
  const newAwarded = pointsForStatus(status, homework.points, homework.penalty_points);
  const target = homeworkColumn(db, homework);
  const oldColumn = existing?.columnId
    ? db.prepare('SELECT * FROM columns WHERE id = ? AND league_id = ?').get(existing.columnId, homework.league_id)
    : null;
  const reason = `تکلیف «${homework.title}»: ${HOMEWORK_STATUS_LABELS[status] ?? status}`;

  if (oldAwarded !== 0 && oldColumn && target && oldColumn.id === target.id) {
    // Same column: a single history row for the net change, as before.
    const delta = newAwarded - oldAwarded;
    if (delta !== 0) {
      applyScoreDelta(db, { leagueId: homework.league_id, student, column: target, delta, reason, actor });
    }
  } else {
    const reversalColumn = oldColumn ?? target;
    if (oldAwarded !== 0 && reversalColumn) {
      applyScoreDelta(db, {
        leagueId: homework.league_id,
        student,
        column: reversalColumn,
        delta: -oldAwarded,
        reason: `${reason} (بازگردانی)`,
        actor,
      });
    }
    if (newAwarded !== 0 && target) {
      applyScoreDelta(db, { leagueId: homework.league_id, student, column: target, delta: newAwarded, reason, actor });
    }
  }

  db.prepare(`
    INSERT INTO homework_status (homework_id, student_id, status, awarded, column_id, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (homework_id, student_id)
    DO UPDATE SET status = excluded.status, awarded = excluded.awarded,
                  column_id = excluded.column_id, updated_at = excluded.updated_at
  `).run(homework.id, student.id, status, newAwarded, target?.id ?? null, isoNow());
}

/** Reconciles every recorded status after points/penalty/column change. */
function reconcilePoints(db, homework, actor) {
  const rows = db.prepare('SELECT * FROM homework_status WHERE homework_id = ?').all(homework.id);
  for (const row of rows) {
    const student = db.prepare('SELECT * FROM students WHERE id = ? AND league_id = ?').get(row.student_id, homework.league_id);
    if (!student) continue;
    // Reuse the same difference logic by re-applying the current status.
    setHomeworkStatus(db, { homework, student, status: row.status, actor });
  }
}

/** Reverses every applied award before the assignment itself is deleted. */
function reverseAwards(db, homework, actor) {
  const rows = db.prepare('SELECT * FROM homework_status WHERE homework_id = ? AND awarded <> 0').all(homework.id);
  for (const row of rows) {
    const student = db.prepare('SELECT * FROM students WHERE id = ? AND league_id = ?').get(row.student_id, homework.league_id);
    if (!student) continue;
    const column = row.column_id
      ? db.prepare('SELECT * FROM columns WHERE id = ? AND league_id = ?').get(row.column_id, homework.league_id)
      : findDisciplineColumn(db, homework.league_id);
    if (column) {
      applyScoreDelta(db, {
        leagueId: homework.league_id,
        student,
        column,
        delta: -row.awarded,
        reason: `حذف تکلیف «${homework.title}»`,
        actor,
      });
    }
  }
}

export function createLeagueHomeworkRouter({ db }) {
  const router = Router({ mergeParams: true });
  router.use(requireTeacher, loadOwnedLeague(db), requirePermission('homework'));

  router.get('/', (req, res) => {
    res.json({ items: homeworkWithCounts(db, req.league.id) });
  });

  router.post('/', validate({ body: schemas.homeworkCreate }), (req, res) => {
    const points = req.body.points ?? 0;
    const penaltyPoints = req.body.penaltyPoints ?? 0;
    const column = resolveColumn(db, req.league.id, req.body.columnId);
    const info = db.prepare('INSERT INTO homework (league_id, teacher_id, title, description, due_date, points, penalty_points, column_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(
        req.league.id,
        teacherId(req),
        req.body.title,
        req.body.description ?? '',
        req.body.dueDate ?? null,
        points,
        penaltyPoints,
        column?.id ?? null,
        isoNow(),
      );
    const row = db.prepare(`
      SELECT h.id, h.title, h.description, h.due_date AS dueDate, h.points,
             h.penalty_points AS penaltyPoints, h.column_id AS columnId,
             c.name AS columnName, h.created_at AS createdAt
      FROM homework h LEFT JOIN columns c ON c.id = h.column_id WHERE h.id = ?
    `).get(info.lastInsertRowid);
    res.status(201).json({
      homework: {
        ...row,
        doneCount: 0,
        absentCount: 0,
        incompleteCount: 0,
        notBroughtCount: 0,
        pendingCount: db.prepare('SELECT COUNT(*) AS n FROM students WHERE league_id = ?').get(req.league.id).n,
      },
    });
  });

  return router;
}

export function createHomeworkRouter({ db }) {
  const router = Router();
  const owned = [requireTeacher, requirePermission('homework'), ownedRow(db, 'homework', { as: 'homework' })];

  router.patch('/:id', ...owned, validate({ body: schemas.homeworkUpdate }), (req, res) => {
    const current = req.homework;
    const newPoints = req.body.points === undefined ? current.points : req.body.points;
    const newPenalty = req.body.penaltyPoints === undefined ? current.penalty_points : req.body.penaltyPoints;
    const newColumn = req.body.columnId === undefined
      ? (current.column_id ?? null)
      : resolveColumn(db, current.league_id, req.body.columnId);
    const newColumnId = newColumn && typeof newColumn === 'object' ? newColumn.id : newColumn;
    const scoringChanged = newPoints !== current.points
      || newPenalty !== current.penalty_points
      || newColumnId !== (current.column_id ?? null);

    const run = db.transaction(() => {
      db.prepare('UPDATE homework SET title = ?, description = ?, due_date = ?, points = ?, penalty_points = ?, column_id = ? WHERE id = ?')
        .run(
          req.body.title ?? current.title,
          req.body.description ?? current.description,
          req.body.dueDate === undefined ? current.due_date : req.body.dueDate,
          newPoints,
          newPenalty,
          newColumnId,
          current.id,
        );
      if (scoringChanged) {
        reconcilePoints(db, {
          ...current,
          points: newPoints,
          penalty_points: newPenalty,
          column_id: newColumnId,
        }, req.user);
      }
    });
    run();
    res.json({
      homework: db.prepare(`
        SELECT h.id, h.title, h.description, h.due_date AS dueDate, h.points,
               h.penalty_points AS penaltyPoints, h.column_id AS columnId,
               c.name AS columnName, h.created_at AS createdAt
        FROM homework h LEFT JOIN columns c ON c.id = h.column_id WHERE h.id = ?
      `).get(current.id),
    });
  });

  router.delete('/:id', ...owned, (req, res) => {
    const run = db.transaction(() => {
      reverseAwards(db, req.homework, req.user);
      db.prepare('DELETE FROM homework WHERE id = ?').run(req.homework.id);
    });
    run();
    res.json({ ok: true });
  });

  router.get('/:id/status', ...owned, (req, res) => {
    const column = req.homework.column_id
      ? db.prepare('SELECT id, name FROM columns WHERE id = ?').get(req.homework.column_id)
      : findDisciplineColumn(db, req.homework.league_id);
    res.json({
      homework: {
        id: req.homework.id,
        title: req.homework.title,
        points: req.homework.points,
        penaltyPoints: req.homework.penalty_points,
        columnId: column?.id ?? null,
        columnName: column?.name ?? '',
      },
      items: statusRows(db, req.homework.id),
    });
  });

  router.post('/:id/status', ...owned, validate({ body: schemas.homeworkStatus }), (req, res) => {
    const student = db.prepare('SELECT id FROM students WHERE id = ? AND league_id = ?').get(req.body.studentId, req.homework.league_id);
    if (!student) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'دانش‌آموز در این لیگ یافت نشد' } });
    }
    const fullStudent = db.prepare('SELECT * FROM students WHERE id = ?').get(student.id);
    const run = db.transaction(() => {
      setHomeworkStatus(db, { homework: req.homework, student: fullStudent, status: req.body.status, actor: req.user });
    });
    run();
    return res.json({ items: statusRows(db, req.homework.id) });
  });

  /** Marks every student of the league in one call. */
  router.post('/:id/status/bulk', ...owned, validate({ body: schemas.homeworkStatus.pick({ status: true }) }), (req, res) => {
    const run = db.transaction(() => {
      const students = db.prepare('SELECT * FROM students WHERE league_id = ?').all(req.homework.league_id);
      for (const student of students) {
        setHomeworkStatus(db, { homework: req.homework, student, status: req.body.status, actor: req.user });
      }
    });
    run();
    res.json({ items: statusRows(db, req.homework.id) });
  });

  return router;
}
