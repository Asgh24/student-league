import { forbidden, notFound } from '../lib/errors.js';
import { canAccessLeague } from './auth.js';

/**
 * Resolves a single row that belongs to a league and verifies the current
 * teacher owns that league (or is an assistant scoped to it). The row must
 * expose a `league_id` column, either directly or through an aliased join in
 * `sql`.
 */
export function ownedRowQuery(db, { sql, as = 'owned', param = 'id' }) {
  const find = db.prepare(sql);
  return function ownedRowQueryMiddleware(req, _res, next) {
    const id = Number.parseInt(req.params[param], 10);
    const row = Number.isFinite(id) ? find.get(id) : null;
    if (!row) return next(notFound());
    const league = db.prepare('SELECT * FROM leagues WHERE id = ?').get(row.league_id);
    if (!league) return next(notFound('لیگ یافت نشد'));
    if (!canAccessLeague(req.user, league)) return next(forbidden('این مورد به لیگ شما تعلق ندارد'));
    req.league = league;
    req[as] = row;
    return next();
  };
}

/** Convenience wrapper for tables that carry `league_id` themselves. */
export function ownedRow(db, table, { key = 'id', param = 'id', as = 'owned' } = {}) {
  return ownedRowQuery(db, { sql: `SELECT * FROM ${table} WHERE ${key} = ?`, as, param });
}

/** Resolves a student row through the league the teacher owns. */
export function ownedStudent(db, { param = 'id', as = 'student' } = {}) {
  const stmt = db.prepare(`
    SELECT s.*, l.teacher_id AS teacherId
    FROM students s JOIN leagues l ON l.id = s.league_id
    WHERE s.id = ?
  `);
  return function ownedStudentMiddleware(req, _res, next) {
    const id = Number.parseInt(req.params[param], 10);
    const student = Number.isFinite(id) ? stmt.get(id) : null;
    if (!student) return next(notFound('دانش‌آموز یافت نشد'));
    const league = db.prepare('SELECT * FROM leagues WHERE id = ?').get(student.league_id);
    if (!canAccessLeague(req.user, league)) return next(forbidden('این دانش‌آموز به لیگ شما تعلق ندارد'));
    req.league = league;
    req[as] = student;
    return next();
  };
}
