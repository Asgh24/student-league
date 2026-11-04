/** Parent/student mobile numbers of a league (the «شماره‌ها» tab). */

import { badRequest, notFound } from '../lib/errors.js';
import { normalizeMobile } from '../lib/phone.js';
import { normalizeHttpUrl } from '../lib/url.js';

export const PHONE_FIELDS = ['parentPhone', 'studentPhone'];

/** Every student with the two contact numbers, the Shad link and login flag. */
export function contactsList(db, leagueId) {
  const rows = db.prepare(`
    SELECT id, name, parent_phone AS parentPhone, student_phone AS studentPhone,
           shad_pv_url AS shadPvUrl, (user_id IS NOT NULL) AS hasLogin
    FROM students
    WHERE league_id = ?
    ORDER BY id ASC
  `).all(leagueId);
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    parentPhone: row.parentPhone ?? '',
    studentPhone: row.studentPhone ?? '',
    shadPvUrl: row.shadPvUrl ?? '',
    hasLogin: Boolean(row.hasLogin),
    hasParentPhone: normalizeMobile(row.parentPhone) !== '',
    hasShadPvUrl: normalizeHttpUrl(row.shadPvUrl) !== '',
  }));
}

/**
 * Saves both numbers and the optional Shad PV link of one student.
 * Empty means "not provided"; a non-empty phone must be an Iranian mobile and
 * a non-empty Shad link must be an absolute http(s) URL.
 */
export function saveContact(db, leagueId, studentId, input) {
  const student = db.prepare('SELECT id, name, shad_pv_url AS shadPvUrl FROM students WHERE id = ? AND league_id = ?')
    .get(studentId, leagueId);
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

  // A missing field means "leave the stored link alone"; an empty string clears
  // it. This keeps older callers (phone-only updates) from wiping the link.
  if (input.shadPvUrl === undefined) {
    next.shadPvUrl = student.shadPvUrl ?? '';
  } else {
    const raw = String(input.shadPvUrl).trim();
    next.shadPvUrl = raw ? normalizeHttpUrl(raw) : '';
    if (raw && !next.shadPvUrl) {
      throw badRequest('INVALID_SHAD_URL', 'لینک شاد باید یک آدرس کامل با http یا https باشد');
    }
  }

  db.prepare(`
    UPDATE students SET parent_phone = ?, student_phone = ?, shad_pv_url = ?
    WHERE id = ? AND league_id = ?
  `).run(next.parentPhone, next.studentPhone, next.shadPvUrl, studentId, leagueId);

  return contactsList(db, leagueId).find((row) => row.id === student.id);
}

/** The parent number used by the daily report, or `''` when missing. */
export function parentMobileOf(db, studentId) {
  const row = db.prepare('SELECT parent_phone AS phone FROM students WHERE id = ?').get(studentId);
  return normalizeMobile(row?.phone ?? '');
}
