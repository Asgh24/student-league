import { Router } from 'express';
import { schemas, validate } from '../lib/validate.js';
import { requireTeacher, loadOwnedLeague } from '../middleware/auth.js';
import { aiConfigFor, generateQuestions, saveTeacherAiSettings } from '../services/groq.js';

/**
 * Teacher-scoped Groq settings. The key is write-only: reads return only the
 * effective source (own/server/none), never the key itself.
 */
export function createAiSettingsRouter({ db }) {
  const router = Router();
  router.use(requireTeacher);

  router.get('/settings', (req, res) => {
    res.json({ config: aiConfigFor(db, { teacherId: req.user.id }) });
  });

  router.put('/settings', validate({ body: schemas.aiSettings }), (req, res) => {
    const config = saveTeacherAiSettings(db, req.user.id, req.body);
    res.json({ config });
  });

  return router;
}

/**
 * League-scoped generation. It only returns a preview; saving is a separate
 * bulk request after the teacher has reviewed the questions.
 */
export function createLeagueAiRouter({ db }) {
  const router = Router({ mergeParams: true });
  router.use(requireTeacher, loadOwnedLeague(db));

  router.post('/questions', validate({ body: schemas.aiQuestions }), async (req, res) => {
    const result = await generateQuestions(db, req.user.id, {
      ...req.body,
      leagueName: req.league.name || '',
    });
    res.json(result);
  });

  return router;
}
