import { Router } from 'express';
import { notFound } from '../lib/errors.js';
import { isoNow } from '../lib/http.js';
import { schemas, validate } from '../lib/validate.js';
import { readSettings } from '../repositories/leagues.js';
import { requireTeacher, loadOwnedLeague, requirePermission, teacherId } from '../middleware/auth.js';
import { ownedRow, ownedRowQuery } from '../middleware/ownership.js';
import { findDisciplineColumn } from '../repositories/leagues.js';
import { serializeQuestion } from '../services/questions.js';
import { applyScoreDelta } from '../services/scoring.js';
import { createQuizSession, recentQuizSessions } from '../services/quiz.js';

export function createLeagueQuestionsRouter({ db }) {
  const router = Router({ mergeParams: true });
  router.use(requireTeacher, loadOwnedLeague(db), requirePermission('qa'));

  router.get('/', (req, res) => {
    const rows = db.prepare(`
      SELECT q.id, q.body, q.points, q.is_open AS isOpen, q.created_at AS createdAt,
             q.options_json AS optionsJson, q.correct_index AS correctIndex,
             (SELECT COUNT(*) FROM answers a WHERE a.question_id = q.id) AS answerCount
      FROM questions q WHERE q.league_id = ? ORDER BY q.id DESC
    `).all(req.league.id);
    const items = rows.map((row) => serializeQuestion(row, { includeCorrectIndex: true }));
    res.json({ items, recent: recentQuizSessions(db, req.league.id) });
  });

  router.post('/bulk', validate({ body: schemas.questionBulkCreate }), (req, res) => {
    const insert = db.prepare(`
      INSERT INTO questions
        (league_id, teacher_id, body, points, is_open, options_json, correct_index, created_at)
      VALUES (?, ?, ?, ?, 1, ?, ?, ?)
    `);
    const ids = db.transaction(() => req.body.questions.map((question) => {
      const info = insert.run(
        req.league.id,
        teacherId(req),
        question.body,
        question.points,
        JSON.stringify(question.options.map((option) => option.trim())),
        question.correctIndex,
        isoNow(),
      );
      return Number(info.lastInsertRowid);
    }))();

    const rows = db.prepare(`
      SELECT id, body, points, is_open AS isOpen, created_at AS createdAt,
             options_json AS optionsJson, correct_index AS correctIndex
      FROM questions WHERE id IN (${ids.map(() => '?').join(', ')}) ORDER BY id ASC
    `).all(...ids);
    const items = rows.map((row) => ({
      ...serializeQuestion(row, { includeCorrectIndex: true }),
      answerCount: 0,
    }));
    res.status(201).json({ items });
  });

  router.post('/', validate({ body: schemas.questionCreate }), (req, res) => {
    const options = req.body.options.map((option) => option.trim());
    const info = db.prepare(`
      INSERT INTO questions
        (league_id, teacher_id, body, points, is_open, options_json, correct_index, created_at)
      VALUES (?, ?, ?, ?, 1, ?, ?, ?)
    `).run(
      req.league.id,
      teacherId(req),
      req.body.body,
      req.body.points,
      JSON.stringify(options),
      req.body.correctIndex,
      isoNow(),
    );
    const row = db.prepare(`
      SELECT id, body, points, is_open AS isOpen, created_at AS createdAt,
             options_json AS optionsJson, correct_index AS correctIndex
      FROM questions WHERE id = ?
    `).get(info.lastInsertRowid);
    res.status(201).json({ question: { ...serializeQuestion(row, { includeCorrectIndex: true }), answerCount: 0 } });
  });

  return router;
}

export function createQuestionsRouter({ db }) {
  const router = Router();
  const ownedQuestion = [requireTeacher, requirePermission('qa'), ownedRow(db, 'questions', { as: 'question' })];

  router.delete('/:id', ...ownedQuestion, (req, res) => {
    db.prepare('DELETE FROM questions WHERE id = ?').run(req.question.id);
    res.json({ ok: true });
  });

  router.post('/:id/close', ...ownedQuestion, (req, res) => {
    db.prepare('UPDATE questions SET is_open = 0 WHERE id = ?').run(req.question.id);
    res.json({ ok: true });
  });

  router.post('/:id/open', ...ownedQuestion, (req, res) => {
    db.prepare('UPDATE questions SET is_open = 1 WHERE id = ?').run(req.question.id);
    res.json({ ok: true });
  });

  router.get('/:id/answers', ...ownedQuestion, (req, res) => {
    const question = serializeQuestion(req.question, { includeCorrectIndex: true });
    const rows = db.prepare(`
      SELECT a.id, a.student_id AS studentId, s.name AS studentName, a.body,
             a.selected_index AS selectedIndex, a.awarded, a.created_at AS createdAt
      FROM answers a JOIN students s ON s.id = a.student_id
      WHERE a.question_id = ? ORDER BY a.id ASC
    `).all(req.question.id);
    const items = rows.map((answer) => ({
      ...answer,
      isCorrect: question.type === 'multiple_choice' && answer.selectedIndex !== null
        ? answer.selectedIndex === question.correctIndex
        : null,
    }));
    res.json({ question, items });
  });

  return router;
}

/** «حالت پخش»: records a completed presentation run and awards its points. */
export function createLeagueQuizRouter({ db }) {
  const router = Router({ mergeParams: true });
  router.use(requireTeacher, loadOwnedLeague(db), requirePermission('qa'));

  router.get('/', (req, res) => {
    res.json({ items: recentQuizSessions(db, req.league.id) });
  });

  router.post('/', validate({ body: schemas.quizSessionCreate }), (req, res) => {
    res.status(201).json(createQuizSession(db, req.league.id, req.user, req.body));
  });

  return router;
}

/** Awards (or corrects) the points a student received for an answer. */
export function createAnswersRouter({ db }) {
  const router = Router();
  const owned = [
    requireTeacher,
    requirePermission('qa'),
    ownedRowQuery(db, {
      sql: 'SELECT a.*, q.league_id AS league_id FROM answers a JOIN questions q ON q.id = a.question_id WHERE a.id = ?',
      as: 'answer',
    }),
  ];

  router.post('/:id/award', ...owned, validate({ body: schemas.answerAward }), (req, res) => {
    const answer = req.answer;
    const question = db.prepare('SELECT * FROM questions WHERE id = ?').get(answer.question_id);
    if (!question) throw notFound('سوال یافت نشد');
    const student = db.prepare('SELECT * FROM students WHERE id = ? AND league_id = ?').get(answer.student_id, question.league_id);
    if (!student) throw notFound('دانش‌آموز یافت نشد');

    const delta = req.body.points - answer.awarded;
    const run = db.transaction(() => {
      if (delta !== 0) {
        const column = findDisciplineColumn(db, question.league_id);
        if (column) {
          applyScoreDelta(db, {
            leagueId: question.league_id,
            student,
            column,
            delta,
            reason: `امتیاز پاسخ به سوال: ${question.body.slice(0, 40)}`,
            actor: req.user,
          });
        }
      }
      db.prepare('UPDATE answers SET awarded = ? WHERE id = ?').run(req.body.points, answer.id);
      return readSettings(db, question.league_id);
    });
    run();
    res.json({ answer: { id: answer.id, awarded: req.body.points, delta } });
  });

  return router;
}
