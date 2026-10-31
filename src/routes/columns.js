import { Router } from 'express';
import { badRequest } from '../lib/errors.js';
import { isoNow } from '../lib/http.js';
import { schemas, validate } from '../lib/validate.js';
import { getColumns, findDisciplineColumn } from '../repositories/leagues.js';
import { requireTeacher, loadOwnedLeague, requirePermission } from '../middleware/auth.js';
import { ownedRow } from '../middleware/ownership.js';
import { applyScoreDelta } from '../services/scoring.js';

/** Collections scoped to a league the teacher owns. */
export function createLeagueColumnsRouter({ db }) {
  const router = Router({ mergeParams: true });
  router.use(requireTeacher, loadOwnedLeague(db), requirePermission('scores'));

  router.get('/', (req, res) => {
    res.json({ items: getColumns(db, req.league.id) });
  });

  router.post('/', validate({ body: schemas.columnCreate }), (req, res) => {
    const maxPosition = db.prepare('SELECT COALESCE(MAX(position), -1) AS p FROM columns WHERE league_id = ?').get(req.league.id).p;
    const info = db.prepare('INSERT INTO columns (league_id, name, step, position, is_default, created_at) VALUES (?, ?, ?, ?, 0, ?)')
      .run(req.league.id, req.body.name, req.body.step, maxPosition + 1, isoNow());
    const column = db.prepare('SELECT * FROM columns WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json({ column });
  });

  return router;
}

/** Single column operations, authorized through the owning league. */
export function createColumnsRouter({ db }) {
  const router = Router();
  const owned = [requireTeacher, requirePermission('scores'), ownedRow(db, 'columns', { as: 'column' })];

  router.patch('/:id', ...owned, validate({ body: schemas.columnUpdate }), (req, res) => {
    const column = req.column;
    const patch = {
      name: req.body.name ?? column.name,
      step: req.body.step ?? column.step,
      position: req.body.position ?? column.position,
    };
    db.prepare('UPDATE columns SET name = ?, step = ?, position = ? WHERE id = ?')
      .run(patch.name, patch.step, patch.position, column.id);
    res.json({ column: db.prepare('SELECT * FROM columns WHERE id = ?').get(column.id) });
  });

  /**
   * Deletes a column. `mode=keep` moves every point into the next remaining
   * column (so totals are preserved) while `mode=discard` drops them.
   */
  router.delete('/:id', ...owned, validate({ query: schemas.columnDeleteQuery }), (req, res) => {
    const column = req.column;
    const leagueId = column.league_id;
    const mode = req.query.mode;

    const run = db.transaction(() => {
      if (mode === 'keep') {
        const target = db.prepare('SELECT * FROM columns WHERE league_id = ? AND id <> ? ORDER BY position ASC, id ASC LIMIT 1')
          .get(leagueId, column.id);
        if (!target) throw badRequest('LAST_COLUMN', 'آخرین ستون قابل حذف با حفظ امتیاز نیست');
        const rows = db.prepare('SELECT student_id AS studentId, value FROM scores WHERE column_id = ? AND value <> 0').all(column.id);
        const studentStmt = db.prepare('SELECT * FROM students WHERE id = ?');
        for (const row of rows) {
          const student = studentStmt.get(row.studentId);
          if (!student) continue;
          applyScoreDelta(db, {
            leagueId,
            student,
            column: target,
            delta: row.value,
            reason: `انتقال امتیاز از ستون «${column.name}»`,
            actor: req.user,
          });
        }
      }
      db.prepare('DELETE FROM columns WHERE id = ?').run(column.id);
      const discipline = findDisciplineColumn(db, leagueId);
      return { disciplineColumnId: discipline?.id ?? null };
    });

    const extra = run();
    res.json({ ok: true, mode, ...extra, columns: getColumns(db, leagueId) });
  });

  router.get('/:id', ...owned, (req, res) => {
    const column = req.column;
    const totals = db.prepare('SELECT COUNT(*) AS entries, COALESCE(SUM(value), 0) AS sum FROM scores WHERE column_id = ?').get(column.id);
    res.json({ column, stats: { ...totals } });
  });

  router.post('/:id/reset', ...owned, (req, res) => {
    const column = req.column;
    const run = db.transaction(() => {
      const rows = db.prepare('SELECT student_id AS studentId, value FROM scores WHERE column_id = ? AND value <> 0').all(column.id);
      const studentStmt = db.prepare('SELECT * FROM students WHERE id = ?');
      for (const row of rows) {
        applyScoreDelta(db, {
          leagueId: column.league_id,
          student: studentStmt.get(row.studentId),
          column,
          delta: -row.value,
          reason: `صفر کردن ستون «${column.name}»`,
          actor: req.user,
        });
      }
      return rows.length;
    });
    const changed = run();
    res.json({ ok: true, changed });
  });

  return router;
}
