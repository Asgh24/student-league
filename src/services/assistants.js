import { isoNow } from '../lib/http.js';
import { createUser, updatePassword } from '../repositories/users.js';

/**
 * Section permissions a teacher can grant to an assistant. Keys are shared with
 * the frontend through `GET /assistants/permissions`; keep them stable.
 */
export const ASSISTANT_PERMISSIONS = [
  { key: 'scores', label: 'لیگ انفرادی و امتیازها', icon: '🏆' },
  { key: 'teams', label: 'لیگ تیمی', icon: '🛡️' },
  { key: 'attendance', label: 'حضور و غیاب', icon: '🗓️' },
  { key: 'evaluations', label: 'ارزشیابی دروس', icon: '📝' },
  { key: 'raffle', label: 'قرعه‌کشی', icon: '🎲' },
  { key: 'representative', label: 'نماینده کلاس', icon: '👑' },
  { key: 'wheel', label: 'گردونه شانس', icon: '🎡' },
  { key: 'live', label: 'تابلوی زنده', icon: '📺' },
  { key: 'timer', label: 'تایمر و ابزار', icon: '⏱️' },
  { key: 'qa', label: 'سوال و پاسخ', icon: '❓' },
  { key: 'homework', label: 'تکالیف', icon: '📚' },
  { key: 'schedule', label: 'برنامه هفتگی', icon: '🗂️' },
  { key: 'files', label: 'ارسال فایل', icon: '📎' },
  { key: 'seating', label: 'جای‌گیری', icon: '🪑' },
  { key: 'contacts', label: 'شماره‌ها', icon: '📱' },
  { key: 'reports', label: 'گزارش روزانه', icon: '📨' },
];

const PERMISSION_KEYS = new Set(ASSISTANT_PERMISSIONS.map((item) => item.key));

export const ASSISTANT_LOG_RETENTION_DAYS = 7;
export const ASSISTANT_LOG_MAX_ROWS = 400;
export const ASSISTANT_LOG_PAGE_SIZE = 300;
const RETENTION_MS = ASSISTANT_LOG_RETENTION_DAYS * 86_400_000;

/** Keeps only known keys, removes duplicates and preserves the declared order. */
export function sanitizePermissions(value) {
  const input = Array.isArray(value) ? value : [];
  const seen = new Set();
  const result = [];
  for (const item of input) {
    const key = String(item ?? '').trim();
    if (!PERMISSION_KEYS.has(key) || seen.has(key)) continue;
    seen.add(key);
    result.push(key);
  }
  return result;
}

export function parsePermissions(raw) {
  if (Array.isArray(raw)) return sanitizePermissions(raw);
  try {
    return sanitizePermissions(JSON.parse(raw ?? '[]'));
  } catch {
    return [];
  }
}

/** Loads an assistant account by the login user id (used by auth). */
export function assistantIdentityForUser(db, userId) {
  return db.prepare(`
    SELECT a.*, o.display_name AS owner_display_name,
           o.trial_ends_at AS owner_trial_ends_at,
           o.subscription_ends_at AS owner_subscription_ends_at,
           o.subscription_plan_id AS owner_subscription_plan_id,
           o.subscription_note AS owner_subscription_note
    FROM assistant_accounts a
    JOIN users o ON o.id = a.owner_id
    WHERE a.user_id = ?
  `).get(userId);
}

export function findAssistantById(db, id) {
  return db.prepare(`
    SELECT a.*, u.username, u.display_name, l.name AS league_name, s.name AS student_name
    FROM assistant_accounts a
    JOIN users u ON u.id = a.user_id
    JOIN leagues l ON l.id = a.league_id
    LEFT JOIN students s ON s.id = a.student_id
    WHERE a.id = ?
  `).get(id);
}

export function listAssistants(db, ownerId, leagueId = null) {
  const rows = leagueId
    ? db.prepare(`
      SELECT a.*, u.username, u.display_name, l.name AS league_name, s.name AS student_name
      FROM assistant_accounts a
      JOIN users u ON u.id = a.user_id
      JOIN leagues l ON l.id = a.league_id
      LEFT JOIN students s ON s.id = a.student_id
      WHERE a.owner_id = ? AND a.league_id = ?
      ORDER BY a.active DESC, a.id DESC
    `).all(ownerId, leagueId)
    : db.prepare(`
      SELECT a.*, u.username, u.display_name, l.name AS league_name, s.name AS student_name
      FROM assistant_accounts a
      JOIN users u ON u.id = a.user_id
      JOIN leagues l ON l.id = a.league_id
      LEFT JOIN students s ON s.id = a.student_id
      WHERE a.owner_id = ?
      ORDER BY a.active DESC, a.id DESC
    `).all(ownerId);
  return rows.map(publicAssistant);
}

export function publicAssistant(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    username: row.username ?? '',
    displayName: row.display_name ?? '',
    leagueId: row.league_id,
    leagueName: row.league_name ?? '',
    studentId: row.student_id ?? null,
    studentName: row.student_name ?? '',
    permissions: parsePermissions(row.permissions),
    active: row.active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Creates the assistant login and its scoped account in one transaction. */
export function createAssistantAccount(db, { ownerId, leagueId, studentId = null, username, password, displayName, permissions }) {
  return db.transaction(() => {
    const user = createUser(db, {
      username,
      password,
      role: 'teacher',
      displayName,
      isAssistant: true,
      trialEndsAt: null,
      subscriptionEndsAt: null,
      subscriptionNote: '',
    });
    const now = isoNow();
    const info = db.prepare(`
      INSERT INTO assistant_accounts
        (user_id, owner_id, league_id, student_id, permissions, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?)
    `).run(
      user.id,
      ownerId,
      leagueId,
      studentId,
      JSON.stringify(sanitizePermissions(permissions)),
      now,
      now,
    );
    return findAssistantById(db, Number(info.lastInsertRowid));
  })();
}

export function updateAssistantAccount(db, id, { displayName, permissions, active } = {}) {
  const assistant = db.prepare('SELECT * FROM assistant_accounts WHERE id = ?').get(id);
  if (!assistant) return null;
  const now = isoNow();
  if (displayName !== undefined) {
    db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(String(displayName).trim(), assistant.user_id);
  }
  if (permissions !== undefined) {
    db.prepare('UPDATE assistant_accounts SET permissions = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(sanitizePermissions(permissions)), now, id);
  }
  if (active !== undefined) {
    db.prepare('UPDATE assistant_accounts SET active = ?, updated_at = ? WHERE id = ?')
      .run(active ? 1 : 0, now, id);
  }
  return findAssistantById(db, id);
}

export function setAssistantPassword(db, assistant, password) {
  updatePassword(db, assistant.user_id, password);
}

/** Removes history older than the retention window and caps the row count. */
export function purgeAssistantLog(db, ownerId, now = Date.now()) {
  const cutoff = new Date(now - RETENTION_MS).toISOString();
  db.prepare('DELETE FROM assistant_log WHERE owner_id = ? AND created_at < ?').run(ownerId, cutoff);
  db.prepare(`
    DELETE FROM assistant_log
    WHERE owner_id = ? AND id NOT IN (
      SELECT id FROM assistant_log WHERE owner_id = ? ORDER BY id DESC LIMIT ?
    )
  `).run(ownerId, ownerId, ASSISTANT_LOG_MAX_ROWS);
}

export function logAssistantAction(db, {
  ownerId,
  leagueId,
  assistantId,
  assistantName,
  action,
  detail = '',
  now = Date.now(),
}) {
  db.prepare(`
    INSERT INTO assistant_log
      (owner_id, league_id, assistant_id, assistant_name, action, detail, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    ownerId,
    leagueId,
    assistantId,
    String(assistantName ?? '').slice(0, 80),
    String(action ?? '').slice(0, 60),
    String(detail ?? '').slice(0, 160),
    new Date(now).toISOString(),
  );
  purgeAssistantLog(db, ownerId, now);
}

export function assistantLog(db, ownerId, { leagueId = null, now = Date.now() } = {}) {
  purgeAssistantLog(db, ownerId, now);
  const cutoff = new Date(now - RETENTION_MS).toISOString();
  const rows = leagueId
    ? db.prepare(`
      SELECT id, league_id AS leagueId, assistant_id AS assistantId, assistant_name AS assistantName,
             action, detail, created_at AS createdAt
      FROM assistant_log
      WHERE owner_id = ? AND league_id = ? AND created_at >= ?
      ORDER BY id DESC LIMIT ?
    `).all(ownerId, leagueId, cutoff, ASSISTANT_LOG_PAGE_SIZE)
    : db.prepare(`
      SELECT id, league_id AS leagueId, assistant_id AS assistantId, assistant_name AS assistantName,
             action, detail, created_at AS createdAt
      FROM assistant_log
      WHERE owner_id = ? AND created_at >= ?
      ORDER BY id DESC LIMIT ?
    `).all(ownerId, cutoff, ASSISTANT_LOG_PAGE_SIZE);
  return rows;
}
