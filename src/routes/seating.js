import { Router } from 'express';
import { schemas, validate } from '../lib/validate.js';
import { requireTeacher, loadOwnedLeague, requirePermission } from '../middleware/auth.js';
import { clearSeating, saveSeatingPlan, seatingPlan, shuffleSeating } from '../services/seating.js';

/** «جای‌گیری»: the classroom seating plan of a league. */
export function createLeagueSeatingRouter({ db }) {
  const router = Router({ mergeParams: true });
  router.use(requireTeacher, loadOwnedLeague(db), requirePermission('seating'));

  router.get('/', (req, res) => {
    res.json(seatingPlan(db, req.league.id));
  });

  router.put('/', validate({ body: schemas.seatingSave }), (req, res) => {
    res.json(saveSeatingPlan(db, req.league.id, req.body));
  });

  router.post('/shuffle', (req, res) => {
    res.json(shuffleSeating(db, req.league.id));
  });

  router.delete('/', (req, res) => {
    res.json(clearSeating(db, req.league.id));
  });

  return router;
}
