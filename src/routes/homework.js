import { Router } from 'express';
import { isoNow } from '../lib/http.js';
import { schemas, validate } from '../lib/validate.js';
import { requireTeacher, loadOwnedLeague, requirePermission, teacherId } from '../middleware/auth.js';
import { ownedRow } from '../middleware/ownership.js';
import { findDisciplineColumn } from '../repositories/leagues.js';
import { applyScoreDelta } from '../services/scoring.js';
import {
  HOMEWORK_STATUS_LABELS,
  HOMEWORK_STATUS_POINTS,
  pointsForStatus,
} from '../lib/homeworkStatus.js';

export { HOMEWORK_STATUS_LABELS, HOMEWORK_STATUS_POINTS, pointsForStatus };

/**
 * Points rule per homework status lives in `src/lib/homeworkStatus.js`
 * (shared with the daily parent report). `homework_status.awarded` remembers
 * what was actually applied, so every change only moves the difference.
 */

function homeworkWithCounts(db, leagueId) {
  const rows = db.prepare(`
    SELECT h.id, h.title, h.description, h.due_date AS dueDate, h.points, h.created_at AS createdAt,
           (SELECT COUNT(*) FROM homework_status hs WHERE hs.homework_id = h.id AND hs.status = 'done') AS doneCount,
           (SELECT COUNT(*) FROM homework_status hs WHERE hs.homework_id = h.id AND hs.status = 'absent') AS absentCount,
           (SELECT COUNT(*) FROM homework_status hs WHERE hs.homework_id = h.id AND hs.status = 'incomplete') AS incompleteCount,
           (SELECT COUNT(*) FROM students s WHERE s.league_id = h.league_id) AS studentCount
    FROM homework h WHERE h.league_id = ? ORDER BY h.id DESC
  `).all(leagueId);
  return rows.map((row) => ({ ...row, pendingCount: Math.max(0, row.studentCount - row.doneCount) }));
}

function statusRows(db, homeworkId) {
  const rows = db.prepare(`
    SELECT s.id AS studentId, s.name AS name, COALESCE(hs.status, 'not_done') AS status,
           COALESCE(hs.awarded, 0) AS awarded, hs.updated_at AS updatedAt
    FROM students s
    LEFT JOIN homework_status hs ON hs.student_id = s.id AND hs.homework_id = ?
    WHERE s.league_id = (SELECT league_id FROM homework WHERE id = ?)
    ORDER BY s.id ASC
  `).all(homeworkId, homeworkId);
  return rows;
}

/**
 * Records one student's status and moves their league points by the
 * difference between the old and new award. Must run inside a transaction.
 */
function setHomeworkStatus(db, { homework, student, status, actor }) {
  const existing = db.prepare('SELECT status, awarded FROM homework_status WHERE homework_id = ? AND student_id = ?')
    .get(homework.id, student.id);
  const oldAwarded = existing?.awarded ?? 0;
  const newAwarded = pointsForStatus(status, homework.points);
  const delta = newAwarded - oldAwarded;
  if (delta !== 0) {
    const column = findDisciplineColumn(db, homework.league_id);
    if (column) {
      applyScoreDelta(db, {
        leagueId: homework.league_id,
        student,
        column,
        delta,
        reason: `تکلیف «${homework.title}»: ${HOMEWORK_STATUS_LABELS[status] ?? status}`,
        actor,
      });
    }
  }
  db.prepare(`
    INSERT INTO homework_status (homework_id, student_id, status, awarded, updated_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (homework_id, student_id)
    DO UPDATE SET status = excluded.status, awarded = excluded.awarded, updated_at = excluded.updated_at
  `).run(homework.id, student.id, status, newAwarded, isoNow());
}

/** Reconciles every recorded status after the assignment points change. */
function reconcilePoints(db, homework, newPoints, actor) {
  const rows = db.prepare('SELECT * FROM homework_status WHERE homework_id = ?').all(homework.id);
  const updated = { ...homework, points: newPoints };
  for (const row of rows) {
    const student = db.prepare('SELECT * FROM students WHERE id = ? AND league_id = ?').get(row.student_id, homework.league_id);
    if (!student) continue;
    // Reuse the same difference logic by re-applying the current status.
    setHomeworkStatus(db, { homework: updated, student, status: row.status, actor });
  }
}

/** Reverses every applied award before the assignment itself is deleted. */
function reverseAwards(db, homework, actor) {
  const rows = db.prepare('SELECT * FROM homework_status WHERE homework_id = ? AND awarded <> 0').all(homework.id);
  for (const row of rows) {
    const student = db.prepare('SELECT * FROM students WHERE id = ? AND league_id = ?').get(row.student_id, homework.league_id);
    if (!student) continue;
    const column = findDisciplineColumn(db, homework.league_id);
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
    const info = db.prepare('INSERT INTO homework (league_id, teacher_id, title, description, due_date, points, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(req.league.id, teacherId(req), req.body.title, req.body.description ?? '', req.body.dueDate ?? null, points, isoNow());
    const row = db.prepare('SELECT id, title, description, due_date AS dueDate, points, created_at AS createdAt FROM homework WHERE id = ?')
      .get(info.lastInsertRowid);
    res.status(201).json({ homework: { ...row, doneCount: 0, absentCount: 0, incompleteCount: 0, pendingCount: db.prepare('SELECT COUNT(*) AS n FROM students WHERE league_id = ?').get(req.league.id).n } });
  });

  return router;
}

export function createHomeworkRouter({ db }) {
  const router = Router();
  const owned = [requireTeacher, requirePermission('homework'), ownedRow(db, 'homework', { as: 'homework' })];

  router.patch('/:id', ...owned, validate({ body: schemas.homeworkUpdate }), (req, res) => {
    const current = req.homework;
    const newPoints = req.body.points === undefined ? current.points : req.body.points;
    const run = db.transaction(() => {
      db.prepare('UPDATE homework SET title = ?, description = ?, due_date = ?, points = ? WHERE id = ?')
        .run(
          req.body.title ?? current.title,
          req.body.description ?? current.description,
          req.body.dueDate === undefined ? current.due_date : req.body.dueDate,
          newPoints,
          current.id,
        );
      if (newPoints !== current.points) {
        reconcilePoints(db, current, newPoints, req.user);
      }
    });
    run();
    res.json({ homework: db.prepare('SELECT id, title, description, due_date AS dueDate, points, created_at AS createdAt FROM homework WHERE id = ?').get(current.id) });
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
    res.json({ homework: { id: req.homework.id, title: req.homework.title, points: req.homework.points }, items: statusRows(db, req.homework.id) });
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
