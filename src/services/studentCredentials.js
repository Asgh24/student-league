/** Event-driven student credential synchronization with the parent's mobile. */

import { findAdminByUsername } from '../repositories/admins.js';
import { createUser, findById, findByUsername, updatePassword, updateUsername } from '../repositories/users.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { normalizeMobile } from '../lib/phone.js';

function requireStudent(db, studentId) {
  const student = db.prepare('SELECT * FROM students WHERE id = ?').get(studentId);
  if (!student) throw notFound('دانش‌آموز یافت نشد');
  return student;
}

function assertUsernameAvailable(db, username, ownUserId = null) {
  const user = findByUsername(db, username);
  if ((user && user.id !== ownUserId) || findAdminByUsername(db, username)) {
    throw conflict('USERNAME_TAKEN', 'شماره والد قبلاً به‌عنوان نام کاربری حساب دیگری استفاده شده است');
  }
}

/** Sets username and password to the parent mobile and leaves auto mode enabled. */
export function syncCredentialsFromParent(db, studentId, parentPhone = null) {
  const student = requireStudent(db, studentId);
  const mobile = normalizeMobile(parentPhone ?? student.parent_phone ?? '');
  if (!mobile) {
    throw badRequest('PARENT_PHONE_REQUIRED', 'ابتدا یک شماره والد معتبر برای دانش‌آموز ثبت کنید');
  }

  const account = student.user_id ? findById(db, student.user_id) : null;
  assertUsernameAvailable(db, mobile, account?.id ?? null);

  const apply = db.transaction(() => {
    let user = account;
    if (!user) {
      user = createUser(db, {
        username: mobile,
        password: mobile,
        role: 'student',
        displayName: student.name,
      });
    } else {
      if (user.username !== mobile) updateUsername(db, user.id, mobile);
      updatePassword(db, user.id, mobile);
    }
    db.prepare(`
      UPDATE students
      SET user_id = ?, credentials_from_parent = 1
      WHERE id = ?
    `).run(user.id, student.id);
  });
  apply();
  return {
    id: student.id,
    hasLogin: true,
    username: mobile,
    credentialsFromParent: true,
  };
}

/** Disables future parent-phone synchronization without changing the login. */
export function disableParentCredentials(db, studentId) {
  db.prepare('UPDATE students SET credentials_from_parent = 0 WHERE id = ?').run(studentId);
}
