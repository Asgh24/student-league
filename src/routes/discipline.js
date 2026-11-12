import { Router } from 'express';
import { todayIso } from '../lib/http.js';
import { schemas, validate } from '../lib/validate.js';
import { requireTeacher, loadOwnedLeague, requirePermission } from '../middleware/auth.js';
import {
  bulkSetDiscipline,
  DISCIPLINE_LABELS,
  DISCIPLINE_STATUSES,
  disciplineSheet,
  leagueHistory,
  setDiscipline,
  todayCounters,
} from '../services/discipline.js';

/** «انضباط»: daily orderly/disorderly sheet, independent of attendance. */
export function createDisciplineRouter({ db }) {
  const router = Router({ mergeParams: true });
  router.use(requireTeacher, loadOwnedLeague(db), requirePermission('discipline'));

  router.get('/', validate({ query: schemas.listQuery }), (req, res) => {
    const date = req.query.date ?? todayIso();
    res.json({
      date,
      today: todayIso(),
      labels: DISCIPLINE_LABELS,
      statuses: DISCIPLINE_STATUSES,
      counters: todayCounters(db, req.league.id, date),
      items: disciplineSheet(db, req.league.id, date),
    });
  });

  router.post('/', validate({ body: schemas.disciplineSet }), (req, res) => {
    const result = setDiscipline(db, {
      leagueId: req.league.id,
      day: req.body.date,
      records: req.body.records,
      actor: req.user,
    });
    res.json({
      ...result,
      items: disciplineSheet(db, req.league.id, req.body.date),
    });
  });

  router.post('/bulk', validate({ body: schemas.disciplineBulk }), (req, res) => {
    const result = bulkSetDiscipline(db, {
      leagueId: req.league.id,
      day: req.body.date,
      status: req.body.status,
      actor: req.user,
    });
    res.json({ ...result, items: disciplineSheet(db, req.league.id, req.body.date) });
  });

  router.get('/history', validate({ query: schemas.pagination }), (req, res) => {
    const { page, limit } = req.query;
    const { items, total } = leagueHistory(db, req.league.id, { limit, offset: (page - 1) * limit });
    res.json({ items, total, page, limit });
  });

  return router;
}
