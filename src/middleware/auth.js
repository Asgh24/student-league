import { AppError, forbidden, notFound, unauthorized } from '../lib/errors.js';
import { findAdminById } from '../repositories/admins.js';
import { teacherAccess } from '../services/subscription.js';

/** Loads `req.user` from the session when present (teacher, student or admin). */
export function attachUser(db) {
  const findUser = db.prepare(`
    SELECT id, username, role, display_name, persian_digits, trial_ends_at, subscription_ends_at,
           subscription_plan_id, subscription_note
    FROM users WHERE id = ?
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
      if (user) {
        req.user = {
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
      } else {
        delete req.session.userId;
      }
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
    if (league.teacher_id !== req.user.id) return next(forbidden('این لیگ به شما تعلق ندارد'));
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
    if (student.teacher_id !== req.user.id) return next(forbidden('این دانش‌آموز به لیگ شما تعلق ندارد'));
    req.student = student;
    return next();
  };
}
