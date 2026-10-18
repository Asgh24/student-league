import { Router } from 'express';
import { badRequest } from '../lib/errors.js';
import { isoNow } from '../lib/http.js';
import { pickOne, shuffle } from '../lib/random.js';
import { schemas, validate } from '../lib/validate.js';
import { requireTeacher, loadOwnedLeague } from '../middleware/auth.js';

const DEFAULT_SEGMENTS = ['جایزه ویژه', 'جایزه دوم', 'جایزه سوم', 'شانس دوباره', 'امتیاز اضافه', 'جایزه کوچک'];

function raffleHistory(db, leagueId, limit = 30) {
  return db.prepare(`
    SELECT id, student_id AS studentId, student_name AS studentName, reason, created_at AS createdAt
    FROM raffle_history WHERE league_id = ? ORDER BY id DESC LIMIT ?
  `).all(leagueId, limit);
}

export function createToolsRouter({ db }) {
  const router = Router({ mergeParams: true });
  router.use(requireTeacher, loadOwnedLeague(db));

  /** Draws a random student, optionally excluding everyone already drawn. */
  router.post('/raffle', validate({ body: schemas.raffleDraw }), (req, res) => {
    const leagueId = req.league.id;
    const students = db.prepare('SELECT id, name FROM students WHERE league_id = ?').all(leagueId);
    if (students.length === 0) throw badRequest('NO_STUDENTS', 'هنوز دانش‌آموزی به این لیگ اضافه نشده است');

    const excludePrevious = req.body.excludePrevious === true;
    let pool = students;
    let cycled = false;

    if (excludePrevious) {
      const drawn = new Set(db.prepare('SELECT student_id FROM raffle_history WHERE league_id = ?').all(leagueId).map((r) => r.student_id));
      pool = students.filter((student) => !drawn.has(student.id));
      if (pool.length === 0) {
        pool = students;
        cycled = true;
      }
    }

    const chosen = pickOne(pool);
    db.prepare('INSERT INTO raffle_history (league_id, student_id, student_name, reason, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(leagueId, chosen.id, chosen.name, req.body.reason ?? '', req.user.id, isoNow());

    res.json({
      winner: { studentId: chosen.id, name: chosen.name },
      poolSize: students.length,
      remaining: Math.max(0, pool.length - 1),
      cycled,
      history: raffleHistory(db, leagueId),
    });
  });

  router.get('/raffle/history', (req, res) => {
    const items = raffleHistory(db, req.league.id, 100);
    res.json({ items, total: items.length });
  });

  router.delete('/raffle/history', (req, res) => {
    db.prepare('DELETE FROM raffle_history WHERE league_id = ?').run(req.league.id);
    res.json({ ok: true, items: [] });
  });

  /** Lucky wheel segments; falls back to the student names when never customised. */
  router.get('/wheel', (req, res) => {
    const saved = db.prepare('SELECT id, label, position FROM wheel_segments WHERE league_id = ? ORDER BY position ASC, id ASC').all(req.league.id);
    if (saved.length >= 2) {
      return res.json({ segments: saved.map((row) => ({ id: row.id, label: row.label })), source: 'custom' });
    }
    const students = db.prepare('SELECT id, name FROM students WHERE league_id = ? ORDER BY id ASC').all(req.league.id);
    const labels = students.length >= 2 ? students.map((s) => s.name) : DEFAULT_SEGMENTS;
    return res.json({ segments: labels.map((label, index) => ({ id: index + 1, label })), source: students.length >= 2 ? 'students' : 'default' });
  });

  router.put('/wheel', validate({ body: schemas.wheelSave }), (req, res) => {
    const run = db.transaction(() => {
      db.prepare('DELETE FROM wheel_segments WHERE league_id = ?').run(req.league.id);
      const insert = db.prepare('INSERT INTO wheel_segments (league_id, label, position) VALUES (?, ?, ?)');
      req.body.segments.forEach((segment, index) => insert.run(req.league.id, segment.label, index));
    });
    run();
    const saved = db.prepare('SELECT id, label, position FROM wheel_segments WHERE league_id = ? ORDER BY position ASC').all(req.league.id);
    res.json({ segments: saved.map((row) => ({ id: row.id, label: row.label })), source: 'custom' });
  });

  /** Deterministic "random order" helper used by the live board spinner. */
  router.post('/shuffle', (req, res) => {
    const students = db.prepare('SELECT id, name FROM students WHERE league_id = ?').all(req.league.id);
    res.json({ order: shuffle(students).map((s) => ({ studentId: s.id, name: s.name })) });
  });

  router.get('/timer', (req, res) => {
    const row = db.prepare('SELECT ends_at AS endsAt, duration_seconds AS durationSeconds FROM timers WHERE league_id = ?').get(req.league.id);
    if (!row) return res.json({ timer: { endsAt: null, durationSeconds: 0, remainingMs: 0, expired: false } });
    const remainingMs = new Date(row.endsAt).getTime() - Date.now();
    return res.json({ timer: { endsAt: row.endsAt, durationSeconds: row.durationSeconds, remainingMs: Math.max(0, remainingMs), expired: remainingMs <= 0 } });
  });

  return router;
}
