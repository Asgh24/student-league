import { Router } from 'express';
import { schemas, validate } from '../lib/validate.js';
import { requireTeacher, loadOwnedLeague, requirePermission } from '../middleware/auth.js';
import { contactsList, saveContact } from '../services/contacts.js';

/** «شماره‌ها»: parent/student mobile numbers, stored in the site database. */
export function createLeagueContactsRouter({ db }) {
  const router = Router({ mergeParams: true });
  router.use(requireTeacher, loadOwnedLeague(db), requirePermission('contacts'));

  router.get('/', (req, res) => {
    res.json({ league: { id: req.league.id, name: req.league.name }, items: contactsList(db, req.league.id) });
  });

  router.patch('/:studentId', validate({ body: schemas.contactSave }), (req, res) => {
    const studentId = Number.parseInt(req.params.studentId, 10);
    const student = saveContact(db, req.league.id, studentId, req.body);
    res.json({ student });
  });

  return router;
}
