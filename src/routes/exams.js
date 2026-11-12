import { Router } from 'express';
import { notFound } from '../lib/errors.js';
import { schemas, validate } from '../lib/validate.js';
import { requireTeacher, loadOwnedLeague, requirePermission, teacherId } from '../middleware/auth.js';
import {
  createExam,
  deleteExam,
  examResults,
  getTeacherExam,
  listExams,
  setExamStatus,
  updateExam,
} from '../services/exams.js';

function examIdOf(req) {
  const id = Number.parseInt(req.params.examId, 10);
  if (!Number.isFinite(id)) throw notFound('آزمون یافت نشد');
  return id;
}

/** Teacher-facing exam authoring, publishing and results. */
export function createLeagueExamsRouter({ db }) {
  const router = Router({ mergeParams: true });
  router.use(requireTeacher, loadOwnedLeague(db), requirePermission('qa'));

  router.get('/', (req, res) => {
    res.json(listExams(db, req.league.id));
  });

  router.post('/', validate({ body: schemas.examCreate }), (req, res) => {
    res.status(201).json(createExam(db, req.league.id, teacherId(req), req.body));
  });

  router.get('/:examId', (req, res) => {
    res.json(getTeacherExam(db, req.league.id, examIdOf(req)));
  });

  router.put('/:examId', validate({ body: schemas.examUpdate }), (req, res) => {
    res.json(updateExam(db, req.league.id, examIdOf(req), req.body));
  });

  router.delete('/:examId', (req, res) => {
    deleteExam(db, req.league.id, examIdOf(req));
    res.json({ ok: true });
  });

  router.post('/:examId/publish', (req, res) => {
    res.json(setExamStatus(db, req.league.id, examIdOf(req), 'published'));
  });

  router.post('/:examId/close', (req, res) => {
    res.json(setExamStatus(db, req.league.id, examIdOf(req), 'closed'));
  });

  router.post('/:examId/draft', (req, res) => {
    res.json(setExamStatus(db, req.league.id, examIdOf(req), 'draft'));
  });

  router.get('/:examId/results', (req, res) => {
    res.json(examResults(db, req.league.id, examIdOf(req)));
  });

  return router;
}
