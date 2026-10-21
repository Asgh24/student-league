import { Router } from 'express';
import { forbidden, notFound } from '../lib/errors.js';
import { schemas, validate } from '../lib/validate.js';
import { requireAuth, requireStudent, requireTeacher } from '../middleware/auth.js';
import {
  contacts,
  listThreads,
  markRead,
  messageViewer,
  readThread,
  sendMessage,
  startThread,
  unreadTotal,
} from '../services/messages.js';

/**
 * Only teachers (with an active trial/subscription) and students may use the
 * messaging API. Admins are deliberately excluded.
 */
function messagingAccess(req, res, next) {
  if (req.user.role === 'teacher') return requireTeacher(req, res, next);
  if (req.user.role === 'student') return requireStudent(req, res, next);
  return next(forbidden('این بخش فقط برای معلم و دانش‌آموز است'));
}

export function createMessagesRouter({ db }) {
  const router = Router();
  router.use(requireAuth, messagingAccess);

  function viewerOf(req) {
    const viewer = messageViewer(db, req.user);
    if (!viewer) throw notFound('برای حساب شما دانش‌آموزی ثبت نشده است');
    return viewer;
  }

  router.get('/threads', (req, res) => {
    res.json(listThreads(db, viewerOf(req)));
  });

  router.get('/threads/:id', validate({ params: schemas.idParam, query: schemas.messageList }), (req, res) => {
    const viewer = viewerOf(req);
    const conversationId = Number.parseInt(req.params.id, 10);
    const { limit, before } = req.query;
    res.json(readThread(db, conversationId, viewer, { limit, before: before ?? null }));
  });

  router.post('/threads', validate({ body: schemas.messageStart }), (req, res) => {
    const result = startThread(db, viewerOf(req), req.body);
    res.status(result.created ? 201 : 200).json(result);
  });

  router.post('/threads/:id/messages', validate({ params: schemas.idParam, body: schemas.messageSend }), (req, res) => {
    const viewer = viewerOf(req);
    const conversationId = Number.parseInt(req.params.id, 10);
    res.status(201).json(sendMessage(db, conversationId, viewer, req.body.body));
  });

  router.post('/threads/:id/read', validate({ params: schemas.idParam }), (req, res) => {
    const viewer = viewerOf(req);
    const conversationId = Number.parseInt(req.params.id, 10);
    res.json(markRead(db, conversationId, viewer));
  });

  router.get('/unread', (req, res) => {
    res.json({ count: unreadTotal(db, viewerOf(req)) });
  });

  router.get('/contacts', (req, res) => {
    res.json(contacts(db, viewerOf(req)));
  });

  return router;
}
