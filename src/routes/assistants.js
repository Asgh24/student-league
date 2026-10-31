import { Router } from 'express';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { schemas, validate } from '../lib/validate.js';
import { findAdminByUsername } from '../repositories/admins.js';
import { findByUsername } from '../repositories/users.js';
import { requireOwnerTeacher, requireTeacher } from '../middleware/auth.js';
import {
  ASSISTANT_LOG_RETENTION_DAYS,
  ASSISTANT_PERMISSIONS,
  assistantLog,
  createAssistantAccount,
  findAssistantById,
  listAssistants,
  publicAssistant,
  sanitizePermissions,
  setAssistantPassword,
  updateAssistantAccount,
} from '../services/assistants.js';

/** Owner-only management of «همیار سایت دانش‌آموزی» accounts. */
export function createAssistantsRouter({ db }) {
  const router = Router();
  router.use(requireTeacher, requireOwnerTeacher);

  router.get('/permissions', (_req, res) => {
    res.json({ items: ASSISTANT_PERMISSIONS });
  });

  router.get('/', validate({ query: schemas.assistantListQuery }), (req, res) => {
    const leagueId = req.query.leagueId ?? null;
    if (leagueId) {
      const league = db.prepare('SELECT id FROM leagues WHERE id = ? AND teacher_id = ?').get(leagueId, req.user.id);
      if (!league) throw notFound('لیگ یافت نشد');
    }
    res.json({ items: listAssistants(db, req.user.id, leagueId) });
  });

  /** Compact rolling one-week log of assistant changes. */
  router.get('/log', validate({ query: schemas.assistantListQuery }), (req, res) => {
    const leagueId = req.query.leagueId ?? null;
    if (leagueId) {
      const league = db.prepare('SELECT id FROM leagues WHERE id = ? AND teacher_id = ?').get(leagueId, req.user.id);
      if (!league) throw notFound('لیگ یافت نشد');
    }
    res.json({
      items: assistantLog(db, req.user.id, { leagueId }),
      retentionDays: ASSISTANT_LOG_RETENTION_DAYS,
    });
  });

  router.post('/', validate({ body: schemas.assistantCreate }), (req, res) => {
    const { leagueId, studentId, displayName, username, password, permissions } = req.body;
    const league = db.prepare('SELECT * FROM leagues WHERE id = ?').get(leagueId);
    if (!league) throw notFound('لیگ یافت نشد');
    if (league.teacher_id !== req.user.id) throw badRequest('LEAGUE_NOT_OWNED', 'این لیگ به شما تعلق ندارد');

    const student = studentId
      ? db.prepare('SELECT id, name FROM students WHERE id = ? AND league_id = ?').get(studentId, leagueId)
      : null;
    if (studentId && !student) throw badRequest('STUDENT_NOT_FOUND', 'دانش‌آموز انتخاب‌شده در این لیگ نیست');

    if (findByUsername(db, username) || findAdminByUsername(db, username)) {
      throw conflict('USERNAME_TAKEN', 'این نام کاربری قبلاً استفاده شده است');
    }
    if (studentId) {
      const already = db.prepare('SELECT id FROM assistant_accounts WHERE student_id = ? AND active = 1').get(studentId);
      if (already) throw conflict('ASSISTANT_EXISTS', 'این دانش‌آموز هم‌اکنون همیار است');
    }

    const resolvedName = String(displayName ?? '').trim() || student?.name || username;
    const assistant = createAssistantAccount(db, {
      ownerId: req.user.id,
      leagueId,
      studentId: studentId ?? null,
      username,
      password,
      displayName: resolvedName,
      permissions: sanitizePermissions(permissions),
    });
    res.status(201).json({ assistant });
  });

  router.patch('/:id', validate({ body: schemas.assistantUpdate }), (req, res) => {
    const assistant = findAssistantById(db, Number.parseInt(req.params.id, 10));
    if (!assistant || assistant.owner_id !== req.user.id) throw notFound('همیار یافت نشد');

    if (req.body.active === true && assistant.student_id) {
      const already = db.prepare('SELECT id FROM assistant_accounts WHERE student_id = ? AND active = 1 AND id <> ?')
        .get(assistant.student_id, assistant.id);
      if (already) throw conflict('ASSISTANT_EXISTS', 'این دانش‌آموز هم‌اکنون همیار دیگری است');
    }

    const updated = updateAssistantAccount(db, assistant.id, req.body);
    res.json({ assistant: publicAssistant(updated) });
  });

  router.post('/:id/password', validate({ body: schemas.assistantPassword }), (req, res) => {
    const assistant = findAssistantById(db, Number.parseInt(req.params.id, 10));
    if (!assistant || assistant.owner_id !== req.user.id) throw notFound('همیار یافت نشد');
    setAssistantPassword(db, assistant, req.body.password);
    res.json({ ok: true });
  });

  /** Revokes access without deleting the audit history. */
  router.delete('/:id', (req, res) => {
    const assistant = findAssistantById(db, Number.parseInt(req.params.id, 10));
    if (!assistant || assistant.owner_id !== req.user.id) throw notFound('همیار یافت نشد');
    updateAssistantAccount(db, assistant.id, { active: false });
    res.json({ ok: true });
  });

  return router;
}
