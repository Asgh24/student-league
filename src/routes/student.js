import { Router } from 'express';
import { config } from '../config.js';
import { badRequest, notFound, tooMany } from '../lib/errors.js';
import { isoNow, paginate, todayIso } from '../lib/http.js';
import { schemas, validate } from '../lib/validate.js';
import { JALALI_WEEKDAYS } from '../lib/jalali.js';
import { requireStudent } from '../middleware/auth.js';
import { setPersianDigits } from '../repositories/users.js';
import { readSettings } from '../repositories/leagues.js';
import { listForStudent } from '../services/evaluations.js';
import { readSchedule } from './schedule.js';
import {
  dashboard,
  leagueLeaderboard,
  myAttendance,
  myHistory,
  myMedals,
  myTeam,
  reportCard,
  requireStudentContext,
} from '../services/studentPortal.js';
import { rankingForLeague, titleForPoints } from '../services/scoring.js';

function contextOf(db, req) {
  return requireStudentContext(db, req.user.id);
}

export function createStudentPortalRouter({ db }) {
  const router = Router();
  router.use(requireStudent);

  router.get('/me', (req, res) => {
    const student = contextOf(db, req);
    res.json({
      user: req.user,
      student: {
        id: student.id,
        name: student.name,
        leagueId: student.leagueId,
        leagueName: student.leagueName,
        leagueStatus: student.leagueStatus,
      },
      settings: readSettings(db, student.leagueId),
    });
  });

  router.get('/dashboard', (req, res) => {
    res.json(dashboard(db, contextOf(db, req)));
  });

  router.get('/report-card', validate({ query: schemas.reportCardQuery }), (req, res) => {
    const { columnId, from, to, limit } = req.query;
    res.json(reportCard(db, contextOf(db, req), { columnId, from, to, limit }));
  });

  router.get('/attendance', validate({ query: schemas.pagination }), (req, res) => {
    const student = contextOf(db, req);
    const { page, limit } = req.query;
    res.json(myAttendance(db, student, { limit, offset: (page - 1) * limit }));
  });

  router.get('/team', (req, res) => {
    res.json(myTeam(db, contextOf(db, req)));
  });

  router.get('/history', validate({ query: schemas.pagination }), (req, res) => {
    const student = contextOf(db, req);
    const { page, limit } = req.query;
    res.json(myHistory(db, student, { limit, offset: (page - 1) * limit }));
  });

  router.get('/ranking', (req, res) => {
    res.json(leagueLeaderboard(db, contextOf(db, req)));
  });

  router.get('/medals', (req, res) => {
    res.json(myMedals(db, contextOf(db, req)));
  });

  /** Classmate list limited to names, points and rank (no private data). */
  router.get('/classmates', (req, res) => {
    const student = contextOf(db, req);
    const items = rankingForLeague(db, student.leagueId).map((row) => ({
      studentId: row.studentId,
      name: row.name,
      total: row.total,
      rank: row.rank,
      title: titleForPoints(row.total).title,
      isMe: row.studentId === student.id,
    }));
    res.json({ items });
  });

  router.get('/likes', (req, res) => {
    const student = contextOf(db, req);
    const day = todayIso();
    const givenToday = db.prepare("SELECT COUNT(*) AS n FROM likes WHERE from_student_id = ? AND day = ?").get(student.id, day).n;
    const given = db.prepare(`
      SELECT l.id, l.to_student_id AS toStudentId, s.name AS toName, l.achievement, l.created_at AS createdAt
      FROM likes l JOIN students s ON s.id = l.to_student_id
      WHERE l.from_student_id = ? ORDER BY l.id DESC LIMIT 50
    `).all(student.id);
    const received = db.prepare(`
      SELECT l.id, s.name AS fromName, l.achievement, l.created_at AS createdAt
      FROM likes l JOIN students s ON s.id = l.from_student_id
      WHERE l.to_student_id = ? ORDER BY l.id DESC LIMIT 50
    `).all(student.id);
    res.json({
      day,
      givenToday,
      dailyLimit: config.limits.likesPerDay,
      remainingToday: Math.max(0, config.limits.likesPerDay - givenToday),
      given,
      received,
      receivedCount: received.length,
    });
  });

  router.post('/likes', validate({ body: schemas.likeCreate }), (req, res) => {
    const student = contextOf(db, req);
    const target = db.prepare('SELECT id, name FROM students WHERE id = ? AND league_id = ?').get(req.body.toStudentId, student.leagueId);
    if (!target) throw notFound('دانش‌آموز یافت نشد');
    if (target.id === student.id) throw badRequest('SELF_LIKE', 'نمی‌توانید به خودتان لایک بدهید');

    const day = todayIso();
    const givenToday = db.prepare('SELECT COUNT(*) AS n FROM likes WHERE from_student_id = ? AND day = ?').get(student.id, day).n;
    if (givenToday >= config.limits.likesPerDay) throw tooMany('سهمیه لایک امروز شما تمام شده است');

    const info = db.prepare('INSERT INTO likes (league_id, from_student_id, to_student_id, achievement, day, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(student.leagueId, student.id, target.id, req.body.achievement ?? '', day, isoNow());
    res.status(201).json({
      like: { id: Number(info.lastInsertRowid), toStudentId: target.id, toName: target.name, achievement: req.body.achievement ?? '' },
      remainingToday: Math.max(0, config.limits.likesPerDay - givenToday - 1),
    });
  });

  /** Course evaluations recorded by the teacher (own marks + class averages). */
  router.get('/evaluations', (req, res) => {
    res.json(listForStudent(db, contextOf(db, req)));
  });

  router.get('/homework', (req, res) => {
    const student = contextOf(db, req);
    const items = db.prepare(`
      SELECT h.id, h.title, h.description, h.due_date AS dueDate, h.created_at AS createdAt,
             COALESCE(hs.status, 'not_done') AS status
      FROM homework h
      LEFT JOIN homework_status hs ON hs.homework_id = h.id AND hs.student_id = ?
      WHERE h.league_id = ? ORDER BY h.id DESC
    `).all(student.id, student.leagueId);
    res.json({ items });
  });

  router.get('/questions', (req, res) => {
    const student = contextOf(db, req);
    const items = db.prepare(`
      SELECT q.id, q.body, q.points, q.is_open AS isOpen, q.created_at AS createdAt,
             a.body AS myAnswer, a.awarded AS myAward, a.created_at AS answeredAt
      FROM questions q
      LEFT JOIN answers a ON a.question_id = q.id AND a.student_id = ?
      WHERE q.league_id = ? ORDER BY q.id DESC
    `).all(student.id, student.leagueId);
    res.json({ items });
  });

  router.post('/questions/:id/answers', validate({ body: schemas.answerCreate }), (req, res) => {
    const student = contextOf(db, req);
    const questionId = Number.parseInt(req.params.id, 10);
    const question = Number.isFinite(questionId)
      ? db.prepare('SELECT * FROM questions WHERE id = ? AND league_id = ?').get(questionId, student.leagueId)
      : null;
    if (!question) throw notFound('سوال یافت نشد');
    if (!question.is_open) throw badRequest('QUESTION_CLOSED', 'این سوال بسته شده است');
    db.prepare(`
      INSERT INTO answers (question_id, student_id, body, awarded, created_at) VALUES (?, ?, ?, 0, ?)
      ON CONFLICT (question_id, student_id) DO UPDATE SET body = excluded.body, created_at = excluded.created_at
    `).run(question.id, student.id, req.body.body, isoNow());
    res.status(201).json({ ok: true });
  });

  router.get('/schedule', (req, res) => {
    const student = contextOf(db, req);
    const schedule = readSchedule(db, student.leagueId);
    res.json({ ...schedule, days: JALALI_WEEKDAYS.map((label, index) => ({ index, label })) });
  });

  router.get('/files', (req, res) => {
    const student = contextOf(db, req);
    const items = db.prepare('SELECT id, original_name AS originalName, mime, size, description, created_at AS createdAt FROM files WHERE league_id = ? ORDER BY id DESC')
      .all(student.leagueId);
    res.json({ items });
  });

  router.patch('/settings', validate({ body: schemas.persianDigits }), (req, res) => {
    setPersianDigits(db, req.user.id, req.body.persianDigits);
    res.json({ ok: true, persianDigits: req.body.persianDigits });
  });

  /** Personal progress timeline (used by the chart) with pagination metadata. */
  router.get('/timeline', (req, res) => {
    const student = contextOf(db, req);
    const { page, limit } = paginate(req.query, { defaultLimit: 100 });
    const data = myHistory(db, student, { limit, offset: (page - 1) * limit });
    res.json({ ...data, page, limit });
  });

  return router;
}
