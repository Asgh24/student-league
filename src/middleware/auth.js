import { AppError, forbidden, notFound, unauthorized } from '../lib/errors.js';
import { findAdminById } from '../repositories/admins.js';
import { parsePermissions } from '../services/assistants.js';
import { teacherAccess } from '../services/subscription.js';

/** Loads `req.user` from the session when present (teacher, student or admin). */
export function attachUser(db) {
  const findUser = db.prepare(`
    SELECT u.id, u.username, u.role, u.display_name, u.persian_digits, u.is_assistant,
           u.trial_ends_at, u.subscription_ends_at, u.subscription_plan_id, u.subscription_note,
           a.id AS assistant_id, a.owner_id AS assistant_owner_id, a.league_id AS assistant_league_id,
           a.student_id AS assistant_student_id, a.permissions AS assistant_permissions,
           a.active AS assistant_active,
           o.display_name AS owner_display_name,
           o.trial_ends_at AS owner_trial_ends_at,
           o.subscription_ends_at AS owner_subscription_ends_at,
           o.subscription_plan_id AS owner_subscription_plan_id,
           o.subscription_note AS owner_subscription_note
    FROM users u
    LEFT JOIN assistant_accounts a ON a.user_id = u.id
    LEFT JOIN users o ON o.id = a.owner_id
    WHERE u.id = ?
  `);
  return function attachUserMiddleware(req, _res, next) {
    // Admin sessions use a separate id so an admin and a teacher with the same
    // numeric id can never be confused.
    if (req.session?.adminId) {
      const admin = findAdminById(db, req.session.adminId);
      if (admin) {
        req.user = {
          id: admin.id,
          username: admin.username,
          role: 'admin',
          displayName: admin.display_name,
          persianDigits: true,
          isAdmin: true,
        };
      } else {
        delete req.session.adminId;
      }
      return next();
    }

    const userId = req.session?.userId;
    if (userId) {
      const user = findUser.get(userId);
      if (!user) {
        delete req.session.userId;
        return next();
      }

      // An assistant account is only valid while its scoped row is active.
      // Revoking or deleting the row immediately invalidates an existing login.
      const hasAssistantRow = user.assistant_id !== null && user.assistant_id !== undefined;
      const assistantActive = user.assistant_active === 1;
      if (user.is_assistant === 1 && (!hasAssistantRow || !assistantActive)) {
        delete req.session.userId;
        return next();
      }

      const base = {
        id: user.id,
        username: user.username,
        role: user.role,
        displayName: user.display_name,
        persianDigits: user.persian_digits === 1,
        trialEndsAt: user.trial_ends_at,
        subscriptionEndsAt: user.subscription_ends_at,
        subscriptionPlanId: user.subscription_plan_id,
        subscriptionNote: user.subscription_note,
      };

      req.user = hasAssistantRow && assistantActive
        ? {
          ...base,
          ownerId: user.assistant_owner_id,
          ownerDisplayName: user.owner_display_name,
          // The assistant never has an independent subscription window; it
          // inherits the owner teacher's so expiry is enforced for both.
          trialEndsAt: user.owner_trial_ends_at,
          subscriptionEndsAt: user.owner_subscription_ends_at,
          subscriptionPlanId: user.owner_subscription_plan_id,
          subscriptionNote: user.owner_subscription_note,
          assistant: {
            id: user.assistant_id,
            leagueId: user.assistant_league_id,
            studentId: user.assistant_student_id,
            permissions: parsePermissions(user.assistant_permissions),
          },
        }
        : base;
    }
    return next();
  };
}

export function requireAuth(req, _res, next) {
  if (!req.user) return next(unauthorized());
  return next();
}

export function requireAdmin(req, _res, next) {
  if (!req.user) return next(unauthorized());
  if (req.user.role !== 'admin') return next(forbidden('این بخش فقط برای مدیر سامانه است'));
  return next();
}

/** Role check only; used by the subscription/renewal endpoints so an expired
 * teacher can still pay and recover access. */
export function requireTeacherAccount(req, _res, next) {
  if (!req.user) return next(unauthorized());
  if (req.user.role !== 'teacher') return next(forbidden('این بخش فقط برای معلم است'));
  return next();
}

/** Teacher role plus an unexpired trial/subscription. */
export function requireTeacher(req, _res, next) {
  if (!req.user) return next(unauthorized());
  if (req.user.role !== 'teacher') return next(forbidden('این بخش فقط برای معلم است'));
  const access = teacherAccess(req.user);
  if (!access.active) {
    return next(new AppError(
      402,
      'SUBSCRIPTION_REQUIRED',
      'دورهٔ آزمایشی یا اشتراک شما به پایان رسیده است. برای ادامه، اشتراک خود را تمدید کنید',
      access,
    ));
  }
  return next();
}

/** The literal teacher account, never an assistant. */
export function requireOwnerTeacher(req, _res, next) {
  if (!req.user) return next(unauthorized());
  if (req.user.role !== 'teacher') return next(forbidden('این بخش فقط برای معلم است'));
  if (req.user.assistant) return next(forbidden('این بخش فقط برای معلم اصلی است'));
  return next();
}

/** Blocks an assistant unless the owner granted this section permission. */
export function requirePermission(permission) {
  return function requirePermissionMiddleware(req, _res, next) {
    if (!req.user) return next(unauthorized());
    if (!req.user.assistant) return next();
    if (!req.user.assistant.permissions.includes(permission)) {
      return next(forbidden('دسترسی این بخش برای شما فعال نشده است'));
    }
    return next();
  };
}

export function hasAssistantPermission(user, permission) {
  if (!user?.assistant) return true;
  return user.assistant.permissions.includes(permission);
}

/** The teacher id that owns data written by the current actor. */
export function teacherId(req) {
  return req.user?.ownerId ?? req.user?.id;
}

/** True when the actor may open this league: its owner or a scoped assistant. */
export function canAccessLeague(user, league) {
  if (!user || !league || user.role !== 'teacher') return false;
  if (user.assistant) return league.teacher_id === user.ownerId && league.id === user.assistant.leagueId;
  return league.teacher_id === user.id;
}

export function requireStudent(req, _res, next) {
  if (!req.user) return next(unauthorized());
  if (req.user.role !== 'student') return next(forbidden('این بخش فقط برای دانش‌آموز است'));
  return next();
}

/** Loads a league and verifies the current teacher owns it. */
export function loadOwnedLeague(db) {
  const findLeague = db.prepare('SELECT * FROM leagues WHERE id = ?');
  return function loadOwnedLeagueMiddleware(req, _res, next) {
    const leagueId = Number.parseInt(req.params.id ?? req.params.leagueId, 10);
    if (!Number.isFinite(leagueId)) return next(notFound('لیگ یافت نشد'));
    const league = findLeague.get(leagueId);
    if (!league) return next(notFound('لیگ یافت نشد'));
    if (!canAccessLeague(req.user, league)) return next(forbidden('این لیگ به شما تعلق ندارد'));
    req.league = league;
    return next();
  };
}

/** Loads a student row plus its league, verifying the teacher owns that league. */
export function loadOwnedStudent(db) {
  const findStudent = db.prepare(`
    SELECT s.*, l.teacher_id
    FROM students s
    JOIN leagues l ON l.id = s.league_id
    WHERE s.id = ?
  `);
  return function loadOwnedStudentMiddleware(req, _res, next) {
    const studentId = Number.parseInt(req.params.id, 10);
    const student = Number.isFinite(studentId) ? findStudent.get(studentId) : null;
    if (!student) return next(notFound('دانش‌آموز یافت نشد'));
    const league = db.prepare('SELECT * FROM leagues WHERE id = ?').get(student.league_id);
    if (!canAccessLeague(req.user, league)) return next(forbidden('این دانش‌آموز به لیگ شما تعلق ندارد'));
    req.student = student;
    return next();
  };
}
