import { Router } from 'express';
import { isoNow } from '../lib/http.js';
import { schemas, validate } from '../lib/validate.js';
import { requireTeacher, loadOwnedLeague, requirePermission, teacherId } from '../middleware/auth.js';
import { ownedRow } from '../middleware/ownership.js';

function homeworkWithCounts(db, leagueId) {
  const rows = db.prepare(`
    SELECT h.id, h.title, h.description, h.due_date AS dueDate, h.created_at AS createdAt,
           (SELECT COUNT(*) FROM homework_status hs WHERE hs.homework_id = h.id AND hs.status = 'done') AS doneCount,
           (SELECT COUNT(*) FROM students s WHERE s.league_id = h.league_id) AS studentCount
    FROM homework h WHERE h.league_id = ? ORDER BY h.id DESC
  `).all(leagueId);
  return rows.map((row) => ({ ...row, pendingCount: Math.max(0, row.studentCount - row.doneCount) }));
}

function statusRows(db, homeworkId) {
  const rows = db.prepare(`
    SELECT s.id AS studentId, s.name AS name, COALESCE(hs.status, 'not_done') AS status, hs.updated_at AS updatedAt
    FROM students s
    LEFT JOIN homework_status hs ON hs.student_id = s.id AND hs.homework_id = ?
    WHERE s.league_id = (SELECT league_id FROM homework WHERE id = ?)
    ORDER BY s.id ASC
  `).all(homeworkId, homeworkId);
  return rows;
}

export function createLeagueHomeworkRouter({ db }) {
  const router = Router({ mergeParams: true });
  router.use(requireTeacher, loadOwnedLeague(db), requirePermission('homework'));

  router.get('/', (req, res) => {
    res.json({ items: homeworkWithCounts(db, req.league.id) });
  });

  router.post('/', validate({ body: schemas.homeworkCreate }), (req, res) => {
    const info = db.prepare('INSERT INTO homework (league_id, teacher_id, title, description, due_date, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(req.league.id, teacherId(req), req.body.title, req.body.description ?? '', req.body.dueDate ?? null, isoNow());
    const row = db.prepare('SELECT id, title, description, due_date AS dueDate, created_at AS createdAt FROM homework WHERE id = ?')
      .get(info.lastInsertRowid);
    res.status(201).json({ homework: { ...row, doneCount: 0, pendingCount: db.prepare('SELECT COUNT(*) AS n FROM students WHERE league_id = ?').get(req.league.id).n } });
  });

  return router;
}

export function createHomeworkRouter({ db }) {
  const router = Router();
  const owned = [requireTeacher, requirePermission('homework'), ownedRow(db, 'homework', { as: 'homework' })];

  router.patch('/:id', ...owned, validate({ body: schemas.homeworkUpdate }), (req, res) => {
    const current = req.homework;
    db.prepare('UPDATE homework SET title = ?, description = ?, due_date = ? WHERE id = ?')
      .run(
        req.body.title ?? current.title,
        req.body.description ?? current.description,
        req.body.dueDate === undefined ? current.due_date : req.body.dueDate,
        current.id,
      );
    res.json({ homework: db.prepare('SELECT id, title, description, due_date AS dueDate, created_at AS createdAt FROM homework WHERE id = ?').get(current.id) });
  });

  router.delete('/:id', ...owned, (req, res) => {
    db.prepare('DELETE FROM homework WHERE id = ?').run(req.homework.id);
    res.json({ ok: true });
  });

  router.get('/:id/status', ...owned, (req, res) => {
    res.json({ homework: { id: req.homework.id, title: req.homework.title }, items: statusRows(db, req.homework.id) });
  });

  router.post('/:id/status', ...owned, validate({ body: schemas.homeworkStatus }), (req, res) => {
    const student = db.prepare('SELECT id FROM students WHERE id = ? AND league_id = ?').get(req.body.studentId, req.homework.league_id);
    if (!student) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'دانش‌آموز در این لیگ یافت نشد' } });
    }
    db.prepare(`
      INSERT INTO homework_status (homework_id, student_id, status, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT (homework_id, student_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at
    `).run(req.homework.id, student.id, req.body.status, isoNow());
    return res.json({ items: statusRows(db, req.homework.id) });
  });

  /** Marks every student of the league in one call. */
  router.post('/:id/status/bulk', ...owned, validate({ body: schemas.homeworkStatus.pick({ status: true }) }), (req, res) => {
    const run = db.transaction(() => {
      const students = db.prepare('SELECT id FROM students WHERE league_id = ?').all(req.homework.league_id);
      const upsert = db.prepare(`
        INSERT INTO homework_status (homework_id, student_id, status, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT (homework_id, student_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at
      `);
      const now = isoNow();
      for (const student of students) upsert.run(req.homework.id, student.id, req.body.status, now);
    });
    run();
    res.json({ items: statusRows(db, req.homework.id) });
  });

  return router;
}
