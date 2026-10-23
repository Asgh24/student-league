import { findById } from '../repositories/users.js';
import { removeReceipt } from './receipts.js';
import { teacherStorageUsage, teacherFileBlobs, removeUploadedFile } from './storage.js';
import { teacherAccess } from './subscription.js';

/** Maps each user id to the session ids whose serialized data belongs to it. */
function sessionIdsByUser(db) {
  const map = new Map();
  for (const row of db.prepare('SELECT sid, data FROM sessions').all()) {
    try {
      const userId = JSON.parse(row.data)?.userId;
      if (!Number.isInteger(userId)) continue;
      if (!map.has(userId)) map.set(userId, []);
      map.get(userId).push(row.sid);
    } catch {
      /* malformed session JSON is left for the normal expiry sweep */
    }
  }
  return map;
}

/** Student login accounts that belong to this teacher's leagues. */
function linkedStudentUserIds(db, teacherId) {
  return db.prepare(`
    SELECT DISTINCT s.user_id AS id
    FROM students s JOIN leagues l ON l.id = s.league_id
    WHERE l.teacher_id = ? AND s.user_id IS NOT NULL
  `).all(teacherId).map((row) => row.id);
}

function teacherDataCounts(db, teacherId) {
  const row = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM leagues WHERE teacher_id = ?) AS leagues,
      (SELECT COUNT(*) FROM students s JOIN leagues l ON l.id = s.league_id WHERE l.teacher_id = ?) AS students,
      (SELECT COUNT(*) FROM payments WHERE teacher_id = ?) AS payments
  `).get(teacherId, teacherId, teacherId);
  return {
    leagues: Number(row?.leagues) || 0,
    students: Number(row?.students) || 0,
    payments: Number(row?.payments) || 0,
  };
}

/**
 * Permanently removes an expired teacher and everything owned by the account.
 *
 * The account is only deletable while its access status is exactly `expired`:
 * active, trial and permanent/unlimited accounts are rejected. The typed
 * username confirmation is checked server-side as well as in the admin UI.
 * SQLite foreign keys cascade leagues, students, scores, payments, messages and
 * the other dependent rows. Uploaded blobs and receipt images live outside the
 * database and are removed explicitly after the transaction commits.
 */
export function deleteExpiredTeacher(db, { teacherId, confirmUsername }) {
  const teacher = findById(db, teacherId);
  if (!teacher || teacher.role !== 'teacher') return { ok: false, reason: 'not-found' };

  const confirmation = String(confirmUsername ?? '').trim();
  if (confirmation && confirmation.toLowerCase() !== String(teacher.username).toLowerCase()) {
    return { ok: false, reason: 'confirmation-mismatch' };
  }

  const access = teacherAccess(teacher);
  if (access.status !== 'expired') return { ok: false, reason: 'not-expired' };

  const files = teacherFileBlobs(db, teacherId);
  const storage = teacherStorageUsage(db, teacherId);
  const receipts = db.prepare(`
    SELECT receipt_file AS file FROM payments
    WHERE teacher_id = ? AND receipt_file IS NOT NULL AND receipt_file <> ''
  `).all(teacherId).map((row) => row.file);
  const studentUserIds = linkedStudentUserIds(db, teacherId);
  const sessions = sessionIdsByUser(db);
  const counts = teacherDataCounts(db, teacherId);
  let removedStudentUsers = 0;

  const remove = db.transaction(() => {
    const deleteSession = db.prepare('DELETE FROM sessions WHERE sid = ?');
    const deleteSessionsFor = (userId) => {
      for (const sid of sessions.get(userId) ?? []) deleteSession.run(sid);
    };

    deleteSessionsFor(teacherId);
    // Cascades through leagues/files, students, payments, conversations, etc.
    db.prepare('DELETE FROM users WHERE id = ?').run(teacherId);

    // Student accounts created by this teacher are unusable once their league
    // is gone. Remove them only when no other league still links to the account.
    for (const studentUserId of new Set(studentUserIds)) {
      const stillLinked = db.prepare('SELECT 1 AS linked FROM students WHERE user_id = ? LIMIT 1').get(studentUserId);
      if (stillLinked) continue;
      const result = db.prepare("DELETE FROM users WHERE id = ? AND role = 'student'").run(studentUserId);
      if (result.changes > 0) {
        removedStudentUsers += 1;
        deleteSessionsFor(studentUserId);
      }
    }
  });
  remove();

  for (const file of files) removeUploadedFile(file.storedName);
  for (const receipt of receipts) removeReceipt(receipt);

  return {
    ok: true,
    deleted: {
      id: teacher.id,
      username: teacher.username,
      displayName: teacher.display_name,
      ...counts,
      files: storage.fileCount,
      fileBytes: storage.usedBytes,
      studentUsers: removedStudentUsers,
      sessions: (sessions.get(teacherId) ?? []).length,
    },
  };
}
