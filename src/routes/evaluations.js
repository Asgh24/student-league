import { Router } from 'express';
import { notFound } from '../lib/errors.js';
import { schemas, validate } from '../lib/validate.js';
import { loadOwnedLeague, requireTeacher } from '../middleware/auth.js';
import {
  createForTeacher,
  detailForTeacher,
  listForTeacher,
  removeForTeacher,
  requireEvaluation,
  saveScores,
  updateForTeacher,
} from '../services/evaluations.js';

function evaluationIdOf(req) {
  const id = Number.parseInt(req.params.evaluationId, 10);
  if (!Number.isFinite(id)) throw notFound('ارزشیابی یافت نشد');
  return id;
}

/**
 * Teacher routes for the course-evaluation module. Everything is scoped to a
 * league the teacher owns; marks never touch league points.
 */
export function createLeagueEvaluationsRouter({ db }) {
  const router = Router({ mergeParams: true });
  router.use(requireTeacher, loadOwnedLeague(db));

  router.get('/', validate({ query: schemas.evaluationsQuery }), (req, res) => {
    const { subject, from, to, page, limit } = req.query;
    res.json(listForTeacher(db, req.league.id, { subject, from, to, limit, offset: (page - 1) * limit }));
  });

  router.post('/', validate({ body: schemas.evaluationCreate }), (req, res) => {
    const evaluation = createForTeacher(db, req.league.id, req.user.id, req.body);
    res.status(201).json({ evaluation });
  });

  router.get('/:evaluationId', (req, res) => {
    res.json(detailForTeacher(db, evaluationIdOf(req), req.league.id));
  });

  router.patch('/:evaluationId', validate({ body: schemas.evaluationUpdate }), (req, res) => {
    const evaluationId = evaluationIdOf(req);
    requireEvaluation(db, evaluationId, req.league.id);
    res.json({ evaluation: updateForTeacher(db, req.league.id, evaluationId, req.body) });
  });

  router.delete('/:evaluationId', (req, res) => {
    const evaluationId = evaluationIdOf(req);
    requireEvaluation(db, evaluationId, req.league.id);
    res.json(removeForTeacher(db, evaluationId));
  });

  /** Replaces the marks of one evaluation in a single transaction. */
  router.put('/:evaluationId/scores', validate({ body: schemas.evaluationScores }), (req, res) => {
    res.json(saveScores(db, evaluationIdOf(req), req.league.id, req.body.scores));
  });

  return router;
}
