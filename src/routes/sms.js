import { Router } from 'express';
import { schemas, validate } from '../lib/validate.js';
import { requireTeacher, requireOwnerTeacher } from '../middleware/auth.js';
import { saveTeacherSmsSettings, smsConfigFor } from '../services/sms.js';

/**
 * Teacher-scoped sms.ir settings. The API key is write-only: reads return only
 * whether a key is saved, never the key itself.
 */
export function createSmsSettingsRouter({ db }) {
  const router = Router();
  router.use(requireTeacher, requireOwnerTeacher);

  router.get('/settings', (req, res) => {
    res.json({ config: smsConfigFor(db, { teacherId: req.user.id }) });
  });

  router.put('/settings', validate({ body: schemas.smsSettings }), (req, res) => {
    const config = saveTeacherSmsSettings(db, req.user.id, req.body);
    res.json({ config });
  });

  return router;
}
