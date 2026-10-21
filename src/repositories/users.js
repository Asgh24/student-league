import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';

export const BCRYPT_ROUNDS = 10;

/**
 * Canonical form of a password before it reaches bcrypt. Persian keyboards
 * produce visually identical characters (Arabic Yeh/Kaf, Arabic/Persian
 * digits, ZWNJ), so passwords may be typed in more than one way. Unifying them
 * makes a Persian password work regardless of the keyboard that typed it,
 * while ASCII passwords are left untouched.
 */
export function normalizePassword(plain) {
  return String(plain ?? '')
    .normalize('NFC')
    .replace(/[\u064A\u0649]/g, '\u06CC')
    .replace(/\u0643/g, '\u06A9')
    .replace(/[\u06F0-\u06F9]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[\u0660-\u0669]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')
    .replace(/\u00A0/g, ' ')
    .trim();
}

export function hashPassword(plain) {
  return bcrypt.hashSync(normalizePassword(plain), BCRYPT_ROUNDS);
}

export function verifyPassword(plain, hash) {
  if (!hash) return false;
  try {
    if (bcrypt.compareSync(String(plain), hash)) return true;
    // Hashes created before the normalization existed keep working.
    const normalized = normalizePassword(plain);
    return normalized !== String(plain) ? bcrypt.compareSync(normalized, hash) : false;
  } catch {
    return false;
  }
}

let placeholderHash = null;

/**
 * A real bcrypt hash used when the submitted username does not exist, so a
 * failed login costs the same whether or not the account is present. This
 * closes username enumeration through response timing.
 */
export function dummyPasswordHash() {
  placeholderHash ??= hashPassword(`no-such-user-${randomUUID()}`);
  return placeholderHash;
}

export function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    displayName: row.display_name ?? row.displayName,
    persianDigits: (row.persian_digits ?? 1) === 1,
  };
}

export function findByUsername(db, username) {
  return db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(String(username).trim());
}

export function findById(db, id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

export function createUser(db, { username, password, role, displayName, persianDigits = true }) {
  const info = db
    .prepare('INSERT INTO users (username, password_hash, role, display_name, persian_digits, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(String(username).trim(), hashPassword(password), role, String(displayName).trim(), persianDigits ? 1 : 0, new Date().toISOString());
  return findById(db, info.lastInsertRowid);
}

export function updatePassword(db, userId, newPassword) {
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), userId);
}

export function setPersianDigits(db, userId, enabled) {
  db.prepare('UPDATE users SET persian_digits = ? WHERE id = ?').run(enabled ? 1 : 0, userId);
}
