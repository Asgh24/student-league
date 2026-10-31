import { Router } from 'express';
import { isoNow } from '../lib/http.js';
import { schemas, validate } from '../lib/validate.js';
import { requireTeacher, loadOwnedLeague, requirePermission } from '../middleware/auth.js';
import { JALALI_WEEKDAYS } from '../lib/jalali.js';

export const SCHEDULE_PERIODS = 7;

export function readSchedule(db, leagueId) {
  const rows = db.prepare('SELECT day_index AS dayIndex, period, subject, note FROM schedule WHERE league_id = ? ORDER BY day_index ASC, period ASC')
    .all(leagueId);
  return { days: JALALI_WEEKDAYS.map((label, index) => ({ index, label })), periods: SCHEDULE_PERIODS, slots: rows };
}

export function createScheduleRouter({ db }) {
  const router = Router({ mergeParams: true });
  router.use(requireTeacher, loadOwnedLeague(db), requirePermission('schedule'));

  router.get('/', (req, res) => {
    res.json(readSchedule(db, req.league.id));
  });

  /** Replaces the whole grid in one transaction. */
  router.put('/', validate({ body: schemas.scheduleSave }), (req, res) => {
    const run = db.transaction(() => {
      db.prepare('DELETE FROM schedule WHERE league_id = ?').run(req.league.id);
      const insert = db.prepare('INSERT INTO schedule (league_id, day_index, period, subject, note, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
      const now = isoNow();
      for (const slot of req.body.slots) {
        if (!slot.subject && !slot.note) continue;
        insert.run(req.league.id, slot.dayIndex, slot.period, slot.subject, slot.note, now);
      }
    });
    run();
    res.json(readSchedule(db, req.league.id));
  });

  return router;
}
