import { Router } from 'express';
import { todayIso } from '../lib/http.js';
import { schemas, validate } from '../lib/validate.js';
import { readSettings } from '../repositories/leagues.js';
import { requireTeacher, loadOwnedLeague } from '../middleware/auth.js';
import {
  attendanceSheet,
  bulkSetAttendance,
  leagueHistory,
  setAttendance,
  STATUS_LABELS,
  todayCounters,
} from '../services/attendance.js';

export function createAttendanceRouter({ db }) {
  const router = Router({ mergeParams: true });
  router.use(requireTeacher, loadOwnedLeague(db));

  router.get('/', validate({ query: schemas.listQuery }), (req, res) => {
    const date = req.query.date ?? todayIso();
    res.json({
      date,
      today: todayIso(),
      labels: STATUS_LABELS,
      settings: readSettings(db, req.league.id),
      counters: todayCounters(db, req.league.id, date),
      items: attendanceSheet(db, req.league.id, date),
    });
  });

  router.post('/', validate({ body: schemas.attendanceSet }), (req, res) => {
    const result = setAttendance(db, {
      leagueId: req.league.id,
      day: req.body.date,
      records: req.body.records,
      actor: req.user,
    });
    res.json({
      ...result,
      items: attendanceSheet(db, req.league.id, req.body.date),
    });
  });

  router.post('/bulk', validate({ body: schemas.attendanceBulk }), (req, res) => {
    const result = bulkSetAttendance(db, {
      leagueId: req.league.id,
      day: req.body.date,
      status: req.body.status,
      actor: req.user,
    });
    res.json({ ...result, items: attendanceSheet(db, req.league.id, req.body.date) });
  });

  router.get('/history', validate({ query: schemas.pagination }), (req, res) => {
    const { page, limit } = req.query;
    const { items, total } = leagueHistory(db, req.league.id, { limit, offset: (page - 1) * limit });
    res.json({ items, total, page, limit });
  });

  router.get('/summary', (req, res) => {
    const rows = db.prepare(`
      SELECT s.id AS studentId, s.name AS name,
             COUNT(a.id) AS recorded,
             SUM(CASE WHEN a.status IN ('present', 'late') THEN 1 ELSE 0 END) AS attended
      FROM students s
      LEFT JOIN attendance a ON a.student_id = s.id
      WHERE s.league_id = ?
      GROUP BY s.id
      ORDER BY s.id ASC
    `).all(req.league.id);
    res.json({
      today: todayIso(),
      items: rows.map((row) => ({
        studentId: row.studentId,
        name: row.name,
        recorded: row.recorded ?? 0,
        attended: row.attended ?? 0,
      })),
    });
  });

  return router;
}
