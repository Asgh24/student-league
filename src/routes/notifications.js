import { Router } from 'express';
import { asyncHandler } from '../lib/http.js';
import { schemas, validate } from '../lib/validate.js';
import { loadOwnedLeague, requireAdmin, requireAuth, requirePermission, requireTeacher, teacherId } from '../middleware/auth.js';
import {
  deleteForUser,
  leagueAudience,
  listInbox,
  listSent,
  markAllRead,
  markRead,
  sendAdminNotification,
  sendTeacherNotification,
  unreadSummary,
} from '../services/notifications.js';

/** `/api/v1/notifications` — the signed-in user's own inbox. */
export function createNotificationsRouter({ db }) {
  const router = Router();
  router.use(requireAuth);

  router.get('/', validate({ query: schemas.notificationList }), (req, res) => {
    const { page, limit, unread } = req.query;
    res.json(listInbox(db, req.user.id, { page, limit, onlyUnread: unread }));
  });

  /** Polled by the shell to paint the bell badge; the latest item feeds desktop notices. */
  router.get('/unread', (req, res) => {
    res.json(unreadSummary(db, req.user.id));
  });

  router.post('/read-all', (req, res) => {
    res.json(markAllRead(db, req.user.id));
  });

  router.post('/:id/read', validate({ params: schemas.idParam }), (req, res) => {
    res.json(markRead(db, req.user.id, Number.parseInt(req.params.id, 10)));
  });

  router.delete('/:id', validate({ params: schemas.idParam }), (req, res) => {
    res.json(deleteForUser(db, req.user.id, Number.parseInt(req.params.id, 10)));
  });

  return router;
}

/** `/api/v1/leagues/:id/notifications` — a teacher's notices for one league. */
export function createLeagueNotificationsRouter({ db }) {
  const router = Router({ mergeParams: true });
  router.use(requireTeacher, loadOwnedLeague(db), requirePermission('notifications'));

  router.get('/', (req, res) => {
    res.json(listSent(db, { source: 'teacher', leagueId: req.league.id }));
  });

  /** Students plus which of them have a login account / parent number. */
  router.get('/audience', (req, res) => {
    res.json(leagueAudience(db, req.league.id));
  });

  router.post('/', validate({ body: schemas.notificationCompose }), asyncHandler(async (req, res) => {
    const result = await sendTeacherNotification(db, {
      user: req.user,
      teacherId: teacherId(req),
      league: req.league,
      input: req.body,
    });
    res.status(201).json(result);
  }));

  return router;
}

/** `/api/v1/admin/notifications` — site-wide broadcasts and their history. */
export function createAdminNotificationsRouter({ db }) {
  const router = Router();
  router.use(requireAdmin);

  router.get('/', (_req, res) => {
    res.json(listSent(db, { source: 'admin' }));
  });

  router.post('/', validate({ body: schemas.adminNotification }), (req, res) => {
    res.status(201).json(sendAdminNotification(db, { user: req.user, input: req.body }));
  });

  return router;
}
