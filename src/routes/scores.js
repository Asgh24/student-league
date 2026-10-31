import { Router } from 'express';
import { asyncHandler } from '../lib/http.js';
import { schemas, validate } from '../lib/validate.js';
import { getColumns, readSettings } from '../repositories/leagues.js';
import { requireTeacher, loadOwnedLeague, requirePermission } from '../middleware/auth.js';
import { commitScoreChanges, recordScoreChange, scoresMatrix, studentTotal } from '../services/scoring.js';

export function createScoresRouter({ db }) {
  const router = Router({ mergeParams: true });
  router.use(requireTeacher, loadOwnedLeague(db), requirePermission('scores'));

  /** The whole scores table: columns, rows, totals and rank. */
  router.get('/', (req, res) => {
    res.json({
      leagueId: req.league.id,
      status: req.league.status,
      settings: readSettings(db, req.league.id),
      columns: getColumns(db, req.league.id),
      students: scoresMatrix(db, req.league.id),
    });
  });

  /** Commits staged deltas for one student in a single transaction. */
  router.post('/commit', validate({ body: schemas.scoreCommit }), asyncHandler(async (req, res) => {
    const result = commitScoreChanges(db, {
      leagueId: req.league.id,
      studentId: req.body.studentId,
      changes: req.body.changes,
      reason: req.body.reason ?? '',
      actor: req.user,
    });
    const row = scoresMatrix(db, req.league.id).find((item) => item.id === result.studentId);
    res.json({ ...result, student: row ?? null });
  }));

  /** Records a single change with a free-text reason (teacher note). */
  router.post('/record', validate({ body: schemas.scoreRecord }), asyncHandler(async (req, res) => {
    const result = recordScoreChange(db, {
      leagueId: req.league.id,
      studentId: req.body.studentId,
      columnId: req.body.columnId,
      delta: req.body.delta,
      reason: req.body.reason ?? '',
      actor: req.user,
    });
    const row = scoresMatrix(db, req.league.id).find((item) => item.id === result.studentId);
    res.json({ ...result, student: row ?? null });
  }));

  router.get('/student/:studentId', (req, res) => {
    const studentId = Number.parseInt(req.params.studentId, 10);
    const student = db.prepare('SELECT * FROM students WHERE id = ? AND league_id = ?').get(studentId, req.league.id);
    if (!student) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'دانش‌آموز یافت نشد' } });
    return res.json({ studentId, total: studentTotal(db, studentId) });
  });

  return router;
}
