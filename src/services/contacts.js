/** Parent/student mobile numbers of a league (the «شماره‌ها» tab). */

import { badRequest, notFound } from '../lib/errors.js';
import { normalizeMobile } from '../lib/phone.js';

export const PHONE_FIELDS = ['parentPhone', 'studentPhone'];

/** Every student with the two contact numbers and whether a login exists. */
export function contactsList(db, leagueId) {
  const rows = db.prepare(`
    SELECT id, name, parent_phone AS parentPhone, student_phone AS studentPhone,
           (user_id IS NOT NULL) AS hasLogin
    FROM students
    WHERE league_id = ?
    ORDER BY id ASC
  `).all(leagueId);
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    parentPhone: row.parentPhone ?? '',
    studentPhone: row.studentPhone ?? '',
    hasLogin: Boolean(row.hasLogin),
    hasParentPhone: normalizeMobile(row.parentPhone) !== '',
  }));
}

/**
 * Saves both numbers of one student. Empty means "not provided"; a non-empty
 * value must be a valid Iranian mobile.
 */
export function saveContact(db, leagueId, studentId, input) {
  const student = db.prepare('SELECT id, name FROM students WHERE id = ? AND league_id = ?').get(studentId, leagueId);
  if (!student) throw notFound('دانش‌آموز در این لیگ یافت نشد');

  const next = {};
  for (const field of PHONE_FIELDS) {
    const raw = String(input[field] ?? '').trim();
    if (!raw) {
      next[field] = '';
      continue;
    }
    const mobile = normalizeMobile(raw);
    if (!mobile) throw badRequest('INVALID_MOBILE', 'شماره موبایل باید با ۰۹ شروع شود و ۱۱ رقم باشد');
    next[field] = mobile;
  }

  db.prepare('UPDATE students SET parent_phone = ?, student_phone = ? WHERE id = ? AND league_id = ?')
    .run(next.parentPhone, next.studentPhone, studentId, leagueId);

  return contactsList(db, leagueId).find((row) => row.id === student.id);
}

/** The parent number used by the daily report, or `''` when missing. */
export function parentMobileOf(db, studentId) {
  const row = db.prepare('SELECT parent_phone AS phone FROM students WHERE id = ?').get(studentId);
  return normalizeMobile(row?.phone ?? '');
}
