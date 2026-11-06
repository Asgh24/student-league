import { Router } from 'express';
import { forbidden } from '../lib/errors.js';
import { schemas, validate } from '../lib/validate.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import {
  listSupportThreads,
  markSupportRead,
  readSupportThread,
  sendSupportMessage,
  setSupportStatus,
  startSupportThread,
  supportUnreadTotal,
} from '../services/support.js';

/**
 * Support tickets between site users (teachers and students) and the site
 * management. Mirrors the teacher <-> student messaging router, with the
 * admin side living in a separate router guarded by `requireAdmin`.
 */
function supportAccess(req, _res, next) {
  if (req.user.assistant) return next(forbidden('پشتیبانی فقط برای معلم اصلی است'));
  if (req.user.role === 'teacher' || req.user.role === 'student') return next();
  return next(forbidden('این بخش فقط برای معلم و دانش‌آموز است'));
}

function userViewer(req) {
  return { role: 'user', id: req.user.id };
}

function adminViewer(req) {
  return { role: 'admin', id: req.user.id };
}

/** `/api/v1/support` — the site-user side of support tickets. */
export function createSupportRouter({ db }) {
  const router = Router();
  router.use(requireAuth, supportAccess);

  router.get('/threads', (req, res) => {
    res.json(listSupportThreads(db, userViewer(req)));
  });

  router.post('/threads', validate({ body: schemas.supportStart }), (req, res) => {
    const result = startSupportThread(db, userViewer(req), req.body);
    res.status(201).json(result);
  });

  router.get('/threads/:id', validate({ params: schemas.idParam, query: schemas.messageList }), (req, res) => {
    const viewer = userViewer(req);
    const threadId = Number.parseInt(req.params.id, 10);
    const { limit, before } = req.query;
    res.json(readSupportThread(db, threadId, viewer, { limit, before: before ?? null }));
  });

  router.post('/threads/:id/messages', validate({ params: schemas.idParam, body: schemas.messageSend }), (req, res) => {
    const viewer = userViewer(req);
    const threadId = Number.parseInt(req.params.id, 10);
    res.status(201).json(sendSupportMessage(db, threadId, viewer, req.body.body));
  });

  router.post('/threads/:id/read', validate({ params: schemas.idParam }), (req, res) => {
    const viewer = userViewer(req);
    const threadId = Number.parseInt(req.params.id, 10);
    res.json(markSupportRead(db, threadId, viewer));
  });

  router.get('/unread', (req, res) => {
    res.json({ count: supportUnreadTotal(db, userViewer(req)) });
  });

  return router;
}

/** `/api/v1/admin/support` — the site-management side of support tickets. */
export function createAdminSupportRouter({ db }) {
  const router = Router();
  router.use(requireAdmin);

  router.get('/threads', (req, res) => {
    res.json(listSupportThreads(db, adminViewer(req)));
  });

  router.get('/threads/:id', validate({ params: schemas.idParam, query: schemas.messageList }), (req, res) => {
    const viewer = adminViewer(req);
    const threadId = Number.parseInt(req.params.id, 10);
    const { limit, before } = req.query;
    res.json(readSupportThread(db, threadId, viewer, { limit, before: before ?? null }));
  });

  router.post('/threads/:id/messages', validate({ params: schemas.idParam, body: schemas.messageSend }), (req, res) => {
    const viewer = adminViewer(req);
    const threadId = Number.parseInt(req.params.id, 10);
    res.status(201).json(sendSupportMessage(db, threadId, viewer, req.body.body));
  });

  router.patch('/threads/:id/status', validate({ params: schemas.idParam, body: schemas.supportStatus }), (req, res) => {
    const viewer = adminViewer(req);
    const threadId = Number.parseInt(req.params.id, 10);
    res.json(setSupportStatus(db, threadId, viewer, req.body.status));
  });

  router.post('/threads/:id/read', validate({ params: schemas.idParam }), (req, res) => {
    const viewer = adminViewer(req);
    const threadId = Number.parseInt(req.params.id, 10);
    res.json(markSupportRead(db, threadId, viewer));
  });

  router.get('/unread', (req, res) => {
    res.json({ count: supportUnreadTotal(db, adminViewer(req)) });
  });

  return router;
}
