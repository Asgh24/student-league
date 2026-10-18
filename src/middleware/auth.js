import { forbidden, notFound, unauthorized } from '../lib/errors.js';

/** Loads `req.user` from the session when present. */
export function attachUser(db) {
  const findUser = db.prepare('SELECT id, username, role, display_name, persian_digits FROM users WHERE id = ?');
  return function attachUserMiddleware(req, _res, next) {
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
        };
      } else {
        delete req.session.userId;
      }
    }
    next();
  };
}

export function requireAuth(req, _res, next) {
  if (!req.user) return next(unauthorized());
  return next();
}

export function requireTeacher(req, _res, next) {
  if (!req.user) return next(unauthorized());
  if (req.user.role !== 'teacher') return next(forbidden('این بخش فقط برای معلم است'));
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
