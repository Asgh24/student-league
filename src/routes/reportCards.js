/**
 * Teacher-facing «کارنامه دانش‌آموز» API.
 *
 * Subjects are shared by the whole league. Cards are created per student and
 * semester, then grades are saved in one request. The detail endpoint also
 * returns the performance panel (evaluations, league points, attendance).
 */

import { Router } from 'express';
import { notFound } from '../lib/errors.js';
import { schemas, validate } from '../lib/validate.js';
import { loadOwnedLeague, requirePermission, requireTeacher } from '../middleware/auth.js';
import {
  createReportCard,
  createReportCardSubject,
  deleteReportCard,
  deleteReportCardSubject,
  findReportCardForStudent,
  getReportCardDetail,
  listReportCardSubjects,
  listReportCardsForLeague,
  saveReportCard,
  updateReportCardSubject,
} from '../services/reports.js';

function idParam(value) {
  const id = Number.parseInt(value, 10);
  if (!Number.isFinite(id) || id <= 0) throw notFound('شناسه معتبر نیست');
  return id;
}

export function createLeagueReportCardsRouter({ db }) {
  const router = Router({ mergeParams: true });
  router.use(requireTeacher, loadOwnedLeague(db), requirePermission('evaluations'));

  router.get('/subjects', (req, res) => {
    res.json({ items: listReportCardSubjects(db, req.league.id) });
  });

  router.post('/subjects', validate({ body: schemas.reportCardSubjectCreate }), (req, res) => {
    const subject = createReportCardSubject(db, { leagueId: req.league.id, ...req.body });
    res.status(201).json({ subject });
  });

  router.patch('/subjects/:subjectId', validate({ body: schemas.reportCardSubjectUpdate }), (req, res) => {
    const subject = updateReportCardSubject(db, req.league.id, idParam(req.params.subjectId), req.body);
    res.json({ subject });
  });

  router.delete('/subjects/:subjectId', (req, res) => {
    res.json(deleteReportCardSubject(db, req.league.id, idParam(req.params.subjectId)));
  });

  router.get('/', (req, res) => {
    res.json({ items: listReportCardsForLeague(db, req.league.id) });
  });

  /** Existing card for the selected student/semester, or `null`. */
  router.get('/students/:studentId', (req, res) => {
    const studentId = idParam(req.params.studentId);
    const student = db.prepare('SELECT id, name FROM students WHERE id = ? AND league_id = ?')
      .get(studentId, req.league.id);
    if (!student) throw notFound('دانش‌آموز در این لیگ یافت نشد');
    const semester = typeof req.query.semester === 'string' && req.query.semester.trim()
      ? req.query.semester.trim()
      : null;
    res.json({
      student,
      card: findReportCardForStudent(db, req.league.id, studentId, semester),
    });
  });

  router.post('/students/:studentId', validate({ body: schemas.reportCardCreate }), (req, res) => {
    const studentId = idParam(req.params.studentId);
    if (Number(req.body.studentId) !== studentId) {
      throw notFound('شناسه دانش‌آموز با آدرس هم‌خوانی ندارد');
    }
    const payload = createReportCard(db, req.league.id, {
      studentId,
      semester: req.body.semester,
    });
    res.status(201).json({ card: payload.card, student: payload.student });
  });

  router.get('/cards/:cardId', (req, res) => {
    res.json({ card: getReportCardDetail(db, req.league.id, idParam(req.params.cardId)) });
  });

  router.put('/cards/:cardId', validate({ body: schemas.reportCardSave }), (req, res) => {
    const card = saveReportCard(db, req.league.id, idParam(req.params.cardId), req.body);
    res.json({ card });
  });

  router.delete('/cards/:cardId', (req, res) => {
    res.json(deleteReportCard(db, req.league.id, idParam(req.params.cardId)));
  });

  return router;
}
