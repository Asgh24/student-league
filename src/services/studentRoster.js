/** Persistent student roster and safe league-to-league membership transfer. */

import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { isoNow } from '../lib/http.js';
import { compareNames } from '../lib/normalize.js';

function ownedLeague(db, teacherId, leagueId) {
  const league = db.prepare('SELECT * FROM leagues WHERE id = ?').get(leagueId);
  if (!league) throw notFound('لیگ یافت نشد');
  if (league.teacher_id !== teacherId) throw forbidden('این لیگ به شما تعلق ندارد');
  return league;
}

/** Safety net for old fixtures/imports that inserted a league student directly. */
export function ensureRosterProfiles(db, teacherId) {
  const rows = db.prepare(`
    SELECT s.*
    FROM students s JOIN leagues l ON l.id = s.league_id
    WHERE l.teacher_id = ? AND s.profile_id IS NULL
    ORDER BY s.id
  `).all(teacherId);
  if (!rows.length) return 0;
  const findByUser = db.prepare('SELECT id FROM student_profiles WHERE teacher_id = ? AND user_id = ?');
  const insert = db.prepare(`
    INSERT INTO student_profiles
      (teacher_id, user_id, name, parent_phone, student_phone, shad_pv_url,
       credentials_from_parent, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const link = db.prepare('UPDATE students SET profile_id = ? WHERE id = ?');
  const run = db.transaction(() => {
    for (const student of rows) {
      let profileId = student.user_id ? findByUser.get(teacherId, student.user_id)?.id : null;
      if (!profileId) {
        const info = insert.run(
          teacherId,
          student.user_id,
          student.name,
          student.parent_phone ?? '',
          student.student_phone ?? '',
          student.shad_pv_url ?? '',
          student.credentials_from_parent ? 1 : 0,
          student.created_at,
          student.created_at,
        );
        profileId = Number(info.lastInsertRowid);
      }
      link.run(profileId, student.id);
    }
  });
  run();
  return rows.length;
}

/** Creates the durable profile and its first league membership. */
export function createRosterStudent(db, { teacherId, leagueId, userId = null, name }) {
  const now = isoNow();
  const profileInfo = db.prepare(`
    INSERT INTO student_profiles
      (teacher_id, user_id, name, parent_phone, student_phone, shad_pv_url,
       credentials_from_parent, created_at, updated_at)
    VALUES (?, ?, ?, '', '', '', 0, ?, ?)
  `).run(teacherId, userId, String(name).trim(), now, now);
  const profileId = Number(profileInfo.lastInsertRowid);
  const studentInfo = db.prepare(`
    INSERT INTO students
      (league_id, user_id, name, created_at, parent_phone, student_phone,
       shad_pv_url, credentials_from_parent, profile_id)
    VALUES (?, ?, ?, ?, '', '', '', 0, ?)
  `).run(leagueId, userId, String(name).trim(), now, profileId);
  return { profileId, studentId: Number(studentInfo.lastInsertRowid) };
}

/** Keeps persistent identity/contact data current after league-level edits. */
export function syncStudentProfile(db, studentId) {
  const student = db.prepare('SELECT * FROM students WHERE id = ?').get(studentId);
  if (!student?.profile_id) return null;
  db.prepare(`
    UPDATE student_profiles
    SET user_id = CASE WHEN ? IS NULL THEN user_id ELSE ? END,
        name = ?, parent_phone = ?, student_phone = ?, shad_pv_url = ?,
        credentials_from_parent = CASE WHEN ? IS NULL THEN credentials_from_parent ELSE ? END,
        updated_at = ?
    WHERE id = ?
  `).run(
    student.user_id,
    student.user_id,
    student.name,
    student.parent_phone ?? '',
    student.student_phone ?? '',
    student.shad_pv_url ?? '',
    student.user_id,
    student.credentials_from_parent ? 1 : 0,
    isoNow(),
    student.profile_id,
  );
  return student.profile_id;
}

/** All durable profiles and their league memberships for one teacher. */
export function rosterForTeacher(db, teacherId) {
  ensureRosterProfiles(db, teacherId);
  const profiles = db.prepare(`
    SELECT p.id, p.name, p.parent_phone AS parentPhone, p.student_phone AS studentPhone,
           p.shad_pv_url AS shadPvUrl, p.credentials_from_parent AS credentialsFromParent,
           p.created_at AS createdAt, p.updated_at AS updatedAt,
           u.username, (p.user_id IS NOT NULL) AS hasLogin
    FROM student_profiles p
    LEFT JOIN users u ON u.id = p.user_id
    WHERE p.teacher_id = ?
  `).all(teacherId);
  const memberships = db.prepare(`
    SELECT s.id AS studentId, s.profile_id AS profileId, s.league_id AS leagueId,
           l.name AS leagueName, l.status AS leagueStatus, l.created_at AS leagueCreatedAt,
           (s.user_id IS NOT NULL) AS currentLogin
    FROM students s
    JOIN leagues l ON l.id = s.league_id
    WHERE l.teacher_id = ? AND s.profile_id IS NOT NULL
    ORDER BY l.id DESC
  `).all(teacherId);
  const byProfile = new Map();
  for (const membership of memberships) {
    const item = {
      studentId: membership.studentId,
      leagueId: membership.leagueId,
      leagueName: membership.leagueName,
      leagueStatus: membership.leagueStatus,
      leagueCreatedAt: membership.leagueCreatedAt,
      currentLogin: Boolean(membership.currentLogin),
    };
    if (!byProfile.has(membership.profileId)) byProfile.set(membership.profileId, []);
    byProfile.get(membership.profileId).push(item);
  }
  return profiles
    .map((profile) => ({
      ...profile,
      hasLogin: Boolean(profile.hasLogin),
      credentialsFromParent: Boolean(profile.credentialsFromParent),
      memberships: byProfile.get(profile.id) ?? [],
    }))
    .sort((left, right) => compareNames(left.name, right.name));
}

/**
 * Adds every source profile to the target league with fresh competition data.
 * The login is moved to the target membership, while the old membership and all
 * of its league history remain intact for the teacher.
 */
export function transferRosterStudents(db, { teacherId, sourceLeagueId, targetLeagueId }) {
  ensureRosterProfiles(db, teacherId);
  const source = ownedLeague(db, teacherId, sourceLeagueId);
  const target = ownedLeague(db, teacherId, targetLeagueId);
  if (source.id === target.id) throw badRequest('SAME_LEAGUE', 'لیگ مبدأ و مقصد نمی‌توانند یکسان باشند');
  if (target.status !== 'active') throw badRequest('TARGET_COMPLETED', 'لیگ مقصد باید فعال باشد');

  const sourceRows = db.prepare(`
    SELECT s.id, s.profile_id AS profileId, p.user_id AS userId, p.name,
           p.parent_phone AS parentPhone, p.student_phone AS studentPhone,
           p.shad_pv_url AS shadPvUrl,
           p.credentials_from_parent AS credentialsFromParent
    FROM students s
    JOIN student_profiles p ON p.id = s.profile_id
    WHERE s.league_id = ? AND p.teacher_id = ?
    ORDER BY s.id
  `).all(source.id, teacherId);
  const existingRows = db.prepare(`
    SELECT id, profile_id AS profileId FROM students
    WHERE league_id = ? AND profile_id IS NOT NULL
  `).all(target.id);
  const existing = new Map(existingRows.map((row) => [row.profileId, row.id]));
  const now = isoNow();
  const insert = db.prepare(`
    INSERT INTO students
      (league_id, user_id, name, created_at, parent_phone, student_phone,
       shad_pv_url, credentials_from_parent, profile_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const detachLogin = db.prepare(`
    UPDATE students SET user_id = NULL, credentials_from_parent = 0 WHERE profile_id = ?
  `);
  const attachLogin = db.prepare(`
    UPDATE students SET user_id = ?, credentials_from_parent = ? WHERE id = ?
  `);

  let imported = 0;
  let skipped = 0;
  const run = db.transaction(() => {
    for (const profile of sourceRows) {
      let targetStudentId = existing.get(profile.profileId);
      if (targetStudentId) {
        skipped += 1;
      } else {
        const info = insert.run(
          target.id,
          null,
          profile.name,
          now,
          profile.parentPhone ?? '',
          profile.studentPhone ?? '',
          profile.shadPvUrl ?? '',
          profile.credentialsFromParent ? 1 : 0,
          profile.profileId,
        );
        targetStudentId = Number(info.lastInsertRowid);
        existing.set(profile.profileId, targetStudentId);
        imported += 1;
      }
      if (profile.userId) {
        detachLogin.run(profile.profileId);
        attachLogin.run(profile.userId, profile.credentialsFromParent ? 1 : 0, targetStudentId);
      }
    }
  });
  run();

  return {
    source: { id: source.id, name: source.name },
    target: { id: target.id, name: target.name },
    sourceCount: sourceRows.length,
    imported,
    skipped,
  };
}
