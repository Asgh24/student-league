import crypto from 'node:crypto';
import { Router } from 'express';
import { AppError, conflict, forbidden } from '../lib/errors.js';
import { asyncHandler } from '../lib/http.js';
import { schemas, validate } from '../lib/validate.js';
import { config } from '../config.js';
import {
  createUser,
  dummyPasswordHash,
  findByUsername,
  publicUser,
  updatePassword,
  verifyPassword,
} from '../repositories/users.js';
import {
  adminPasswordMatches,
  findAdminById,
  findAdminByUsername,
  publicAdmin,
  touchAdminLogin,
  updateAdminPassword,
} from '../repositories/admins.js';
import { assistantIdentityForUser, parsePermissions } from '../services/assistants.js';
import { ensureCsrfToken } from '../middleware/csrf.js';
import { requireAuth } from '../middleware/auth.js';
import { loginRateLimit } from '../middleware/rateLimit.js';
import { ensureTrialEnd, teacherAccess } from '../services/subscription.js';

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

/** Adds the computed access window to a teacher payload. */
function withSubscription(user) {
  if (!user || user.role !== 'teacher') return user;
  return { ...user, subscription: teacherAccess(user) };
}

async function startSession(req, { userId = null, adminId = null } = {}) {
  await regenerate(req);
  if (adminId !== null) req.session.adminId = adminId;
  if (userId !== null) req.session.userId = userId;
  req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  await save(req);
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
    res.json({ user: withSubscription(req.user ?? null), csrfToken: req.csrfToken });
  });

  router.post(
    '/login',
    loginRateLimit(),
    validate({ body: schemas.login }),
    asyncHandler(async (req, res) => {
      const { username, password } = req.body;
      const admin = findAdminByUsername(db, username);
      const user = admin ? null : findByUsername(db, username);
      // Always run one bcrypt comparison, even for an unknown username, so the
      // response time cannot be used to enumerate which accounts exist.
      const hash = admin?.password_hash ?? user?.password_hash ?? dummyPasswordHash();
      const valid = verifyPassword(password, hash);
      if ((!admin && !user) || !valid) {
        throw new AppError(401, 'INVALID_CREDENTIALS', 'نام کاربری یا گذرواژه نادرست است');
      }

      if (admin) {
        await startSession(req, { adminId: admin.id });
        touchAdminLogin(db, admin.id);
        return res.json({ user: publicAdmin(admin), csrfToken: req.session.csrfToken });
      }

      // Revoked assistants keep the users row but lose the scoped account.
      // They must not fall through and behave like a normal teacher.
      const assistant = user.is_assistant === 1 ? assistantIdentityForUser(db, user.id) : null;
      if (user.is_assistant === 1 && (!assistant || assistant.active !== 1)) {
        throw forbidden('دسترسی همیار لغو شده است. با معلم خود تماس بگیرید');
      }

      await startSession(req, { userId: user.id });
      const payload = publicUser(user);
      if (assistant) {
        Object.assign(payload, {
          ownerId: assistant.owner_id,
          ownerDisplayName: assistant.owner_display_name,
          trialEndsAt: assistant.owner_trial_ends_at,
          subscriptionEndsAt: assistant.owner_subscription_ends_at,
          subscriptionPlanId: assistant.owner_subscription_plan_id,
          subscriptionNote: assistant.owner_subscription_note,
          assistant: {
            id: assistant.id,
            leagueId: assistant.league_id,
            studentId: assistant.student_id,
            permissions: parsePermissions(assistant.permissions),
          },
        });
      }
      return res.json({ user: withSubscription(payload), csrfToken: req.session.csrfToken });
    }),
  );

  /**
   * Teacher self-registration. Students are still created by their teacher, and
   * every new teacher starts with the configured free trial (14 days by default).
   */
  router.post(
    '/register',
    loginRateLimit(),
    validate({ body: schemas.teacherRegister }),
    asyncHandler(async (req, res) => {
      const { username, password, displayName } = req.body;
      if (findByUsername(db, username) || findAdminByUsername(db, username)) {
        throw conflict('USERNAME_TAKEN', 'این نام کاربری قبلاً انتخاب شده است');
      }
      const user = createUser(db, {
        username,
        password,
        role: 'teacher',
        displayName,
        trialEndsAt: ensureTrialEnd(Date.now(), config.trialDays),
        subscriptionNote: `دورهٔ آزمایشی ${config.trialDays} روزه`,
      });
      await startSession(req, { userId: user.id });
      return res.status(201).json({
        user: withSubscription(publicUser(user)),
        trialDays: config.trialDays,
        csrfToken: req.session.csrfToken,
      });
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
      // Students never manage their own password. Teachers and the site admin do.
      if (req.user.role === 'student') {
        throw forbidden('تغییر گذرواژه فقط توسط معلم انجام می‌شود');
      }

      if (req.user.role === 'admin') {
        const admin = findAdminById(db, req.user.id);
        if (!admin || !adminPasswordMatches(admin, req.body.currentPassword)) {
          throw new AppError(400, 'WRONG_PASSWORD', 'گذرواژه فعلی نادرست است');
        }
        updateAdminPassword(db, admin.id, req.body.newPassword);
        return res.json({ ok: true });
      }

      const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
      if (!row || !verifyPassword(req.body.currentPassword, row.password_hash)) {
        throw new AppError(400, 'WRONG_PASSWORD', 'گذرواژه فعلی نادرست است');
      }
      updatePassword(db, req.user.id, req.body.newPassword);
      return res.json({ ok: true });
    }),
  );

  return router;
}
