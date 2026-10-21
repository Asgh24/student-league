import crypto from 'node:crypto';
import { Router } from 'express';
import { AppError, forbidden } from '../lib/errors.js';
import { asyncHandler } from '../lib/http.js';
import { schemas, validate } from '../lib/validate.js';
import { config } from '../config.js';
import { dummyPasswordHash, findByUsername, publicUser, updatePassword, verifyPassword } from '../repositories/users.js';
import { ensureCsrfToken } from '../middleware/csrf.js';
import { requireAuth } from '../middleware/auth.js';
import { loginRateLimit } from '../middleware/rateLimit.js';

function regenerate(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });
}

function save(req) {
  return new Promise((resolve, reject) => {
    req.session.save((err) => (err ? reject(err) : resolve()));
  });
}

export function createAuthRouter({ db }) {
  // Warm the placeholder hash once at boot, otherwise the very first failed
  // login would be measurably slower than the rest.
  dummyPasswordHash();

  const router = Router();

  router.get('/csrf', ensureCsrfToken, (req, res) => {
    res.json({ csrfToken: req.csrfToken });
  });

  router.get('/me', ensureCsrfToken, (req, res) => {
    res.json({ user: req.user ?? null, csrfToken: req.csrfToken });
  });

  router.post(
    '/login',
    loginRateLimit(),
    validate({ body: schemas.login }),
    asyncHandler(async (req, res) => {
      const { username, password } = req.body;
      const user = findByUsername(db, username);
      // Always run a bcrypt comparison, even for an unknown username, so the
      // response time cannot be used to enumerate which accounts exist.
      const valid = verifyPassword(password, user?.password_hash ?? dummyPasswordHash());
      if (!user || !valid) {
        throw new AppError(401, 'INVALID_CREDENTIALS', 'نام کاربری یا گذرواژه نادرست است');
      }
      await regenerate(req);
      req.session.userId = user.id;
      req.session.csrfToken = crypto.randomBytes(32).toString('hex');
      await save(req);
      res.json({ user: publicUser(user), csrfToken: req.session.csrfToken });
    }),
  );

  router.post(
    '/logout',
    asyncHandler(async (req, res) => {
      await new Promise((resolve) => {
        req.session.destroy(() => resolve());
      });
      // Must mirror the configured cookie exactly, otherwise a custom
      // SESSION_COOKIE_NAME would leave the browser cookie in place.
      res.clearCookie(config.sessionCookieName, {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: config.isProd,
      });
      res.json({ ok: true });
    }),
  );

  router.post(
    '/password',
    requireAuth,
    validate({ body: schemas.changePassword }),
    asyncHandler(async (req, res) => {
      // Student passwords are managed by the teacher, never by the student.
      if (req.user.role !== 'teacher') {
        throw forbidden('تغییر گذرواژه فقط توسط معلم انجام می‌شود');
      }
      const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
      if (!verifyPassword(req.body.currentPassword, row.password_hash)) {
        throw new AppError(400, 'WRONG_PASSWORD', 'گذرواژه فعلی نادرست است');
      }
      updatePassword(db, req.user.id, req.body.newPassword);
      res.json({ ok: true });
    }),
  );

  return router;
}
