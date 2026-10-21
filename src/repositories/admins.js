import { isoNow } from '../lib/http.js';
import { hashPassword, verifyPassword } from './users.js';

/** Site-owner accounts live in their own table (see migration 008). */
export function publicAdmin(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    role: 'admin',
    displayName: row.display_name,
    persianDigits: true,
    isAdmin: true,
  };
}

export function findAdminByUsername(db, username) {
  return db.prepare('SELECT * FROM admins WHERE username = ? COLLATE NOCASE').get(String(username).trim());
}

export function findAdminById(db, id) {
  return db.prepare('SELECT * FROM admins WHERE id = ?').get(id);
}

export function createAdmin(db, { username, password, displayName }) {
  const info = db.prepare(`
    INSERT INTO admins (username, password_hash, display_name, created_at)
    VALUES (?, ?, ?, ?)
  `).run(String(username).trim(), hashPassword(password), String(displayName).trim(), isoNow());
  return findAdminById(db, info.lastInsertRowid);
}

export function updateAdminPassword(db, id, password) {
  db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(hashPassword(password), id);
}

export function touchAdminLogin(db, id) {
  db.prepare('UPDATE admins SET last_login_at = ? WHERE id = ?').run(isoNow(), id);
}

export function adminPasswordMatches(row, password) {
  return Boolean(row) && verifyPassword(password, row.password_hash);
}
