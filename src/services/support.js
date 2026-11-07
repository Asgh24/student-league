import { notFound } from '../lib/errors.js';
import { isoNow } from '../lib/http.js';

/**
 * Support tickets between site users (teachers and students) and the site
 * management. Mirrors the teacher <-> student messaging service, but the
 * other side is an admin from the separate `admins` table, so support has
 * its own tables (`support_threads` / `support_messages`).
 *
 * A viewer is `{ role: 'user' | 'admin', id }`; the user side is always
 * scoped to their own `user_id` and the admin side sees every ticket.
 */

const PREVIEW_LENGTH = 160;

export const SUPPORT_STATUSES = ['open', 'answered', 'closed'];

const THREAD_SELECT = `
  SELECT st.id, st.subject, st.status, st.user_id AS userId,
         st.last_message_at AS lastMessageAt, st.created_at AS createdAt,
         u.username AS username, u.display_name AS userName, u.role AS userRole,
         lm.body AS lastBody, lm.created_at AS lastAt, lm.sender_role AS lastSenderRole,
         (SELECT COUNT(*)
          FROM support_messages um
          WHERE um.thread_id = st.id AND um.read_at IS NULL AND um.sender_role = ?) AS unread
  FROM support_threads st
  JOIN users u ON u.id = st.user_id
  LEFT JOIN support_messages lm ON lm.id = (
    SELECT m.id FROM support_messages m WHERE m.thread_id = st.id ORDER BY m.id DESC LIMIT 1
  )
`;

function threadJson(row, viewer) {
  if (!row) return null;
  return {
    id: row.id,
    subject: row.subject,
    status: row.status,
    userId: row.userId,
    username: row.username,
    userName: row.userName,
    userRole: row.userRole,
    participantName: viewer.role === 'admin' ? row.userName : 'پشتیبانی سایت',
    lastMessage: row.lastBody === null
      ? null
      : {
        body: row.lastBody,
        at: row.lastAt,
        senderRole: row.lastSenderRole,
      },
    unread: Number(row.unread) || 0,
    createdAt: row.createdAt,
    updatedAt: row.lastMessageAt ?? row.createdAt,
  };
}

function threadRow(db, threadId, viewer) {
  // The unread subquery counts messages the viewer has not read: for the
  // user side those are admin replies, for the admin side user messages.
  const otherRole = viewer.role === 'admin' ? 'user' : 'admin';
  if (viewer.role === 'admin') {
    return db.prepare(`${THREAD_SELECT} WHERE st.id = ?`).get(otherRole, threadId);
  }
  return db.prepare(`${THREAD_SELECT} WHERE st.id = ? AND st.user_id = ?`)
    .get(otherRole, threadId, viewer.id);
}

/** The ticket as seen by `viewer`; throws when it is not theirs. */
export function getSupportThread(db, threadId, viewer) {
  const row = threadRow(db, threadId, viewer);
  if (!row) throw notFound('تیکت پشتیبانی یافت نشد');
  return threadJson(row, viewer);
}

export function supportUnreadTotal(db, viewer) {
  const otherRole = viewer.role === 'admin' ? 'user' : 'admin';
  if (viewer.role === 'admin') {
    return db.prepare(`
      SELECT COUNT(*) AS n FROM support_messages WHERE read_at IS NULL AND sender_role = ?
    `).get(otherRole).n;
  }
  return db.prepare(`
    SELECT COUNT(*) AS n
    FROM support_messages m
    JOIN support_threads st ON st.id = m.thread_id
    WHERE m.read_at IS NULL AND m.sender_role = ? AND st.user_id = ?
  `).get(otherRole, viewer.id).n;
}

export function listSupportThreads(db, viewer) {
  const otherRole = viewer.role === 'admin' ? 'user' : 'admin';
  const rows = viewer.role === 'admin'
    ? db.prepare(`
      ${THREAD_SELECT}
      ORDER BY COALESCE(st.last_message_at, st.created_at) DESC, st.id DESC
    `).all(otherRole)
    : db.prepare(`
      ${THREAD_SELECT}
      WHERE st.user_id = ?
      ORDER BY COALESCE(st.last_message_at, st.created_at) DESC, st.id DESC
    `).all(otherRole, viewer.id);
  return {
    items: rows.map((row) => threadJson(row, viewer)),
    unreadTotal: supportUnreadTotal(db, viewer),
  };
}

function messageRows(db, threadId, viewer, { limit = 100, before = null } = {}) {
  const rows = db.prepare(`
    SELECT * FROM (
      SELECT m.id, m.body, m.sender_role AS senderRole, m.sender_user_id AS senderUserId,
             m.sender_admin_id AS senderAdminId, m.created_at AS createdAt, m.read_at AS readAt,
             u.display_name AS userName, a.display_name AS adminName
      FROM support_messages m
      LEFT JOIN users u ON u.id = m.sender_user_id
      LEFT JOIN admins a ON a.id = m.sender_admin_id
      WHERE m.thread_id = ?${before ? ' AND m.id < ?' : ''}
      ORDER BY m.id DESC
      LIMIT ?
    )
    ORDER BY id ASC
  `).all(...(before ? [threadId, before, limit] : [threadId, limit]));
  return rows.map((row) => messageJson(row, viewer));
}

function messageJson(row, viewer) {
  const isAdmin = row.senderRole === 'admin';
  return {
    id: row.id,
    body: row.body,
    senderRole: row.senderRole,
    senderName: isAdmin ? (row.adminName ?? 'مدیر سامانه') : (row.userName ?? 'کاربر'),
    createdAt: row.createdAt,
    mine: isAdmin ? viewer.role === 'admin' : viewer.role === 'user',
    readAt: row.readAt ?? null,
  };
}

function markIncomingRead(db, threadId, viewer) {
  const otherRole = viewer.role === 'admin' ? 'user' : 'admin';
  return db.prepare(`
    UPDATE support_messages
    SET read_at = ?
    WHERE thread_id = ? AND sender_role = ? AND read_at IS NULL
  `).run(isoNow(), threadId, otherRole).changes;
}

/** Marks the other side's messages read and returns the refreshed ticket. */
export function readSupportThread(db, threadId, viewer, options = {}) {
  getSupportThread(db, threadId, viewer);
  markIncomingRead(db, threadId, viewer);
  return {
    thread: getSupportThread(db, threadId, viewer),
    messages: messageRows(db, threadId, viewer, options),
    unreadTotal: supportUnreadTotal(db, viewer),
  };
}

export function markSupportRead(db, threadId, viewer) {
  getSupportThread(db, threadId, viewer);
  markIncomingRead(db, threadId, viewer);
  return { ok: true, unreadTotal: supportUnreadTotal(db, viewer) };
}

function insertMessage(db, threadId, viewer, body) {
  const text = String(body).trim();
  const now = isoNow();
  const isAdmin = viewer.role === 'admin';
  const info = db.prepare(`
    INSERT INTO support_messages (thread_id, sender_role, sender_user_id, sender_admin_id, body, created_at, read_at)
    VALUES (?, ?, ?, ?, ?, ?, NULL)
  `).run(
    threadId,
    isAdmin ? 'admin' : 'user',
    isAdmin ? null : viewer.id,
    isAdmin ? viewer.id : null,
    text,
    now,
  );
  db.prepare(`
    UPDATE support_threads SET last_message_at = ?, last_message_preview = ? WHERE id = ?
  `).run(now, text.slice(0, PREVIEW_LENGTH), threadId);
  const row = db.prepare(`
    SELECT m.id, m.body, m.sender_role AS senderRole, m.sender_user_id AS senderUserId,
           m.sender_admin_id AS senderAdminId, m.created_at AS createdAt, m.read_at AS readAt,
           u.display_name AS userName, a.display_name AS adminName
    FROM support_messages m
    LEFT JOIN users u ON u.id = m.sender_user_id
    LEFT JOIN admins a ON a.id = m.sender_admin_id
    WHERE m.id = ?
  `).get(info.lastInsertRowid);
  return { message: messageJson(row, viewer), now };
}

export function sendSupportMessage(db, threadId, viewer, body) {
  getSupportThread(db, threadId, viewer);
  const { message } = insertMessage(db, threadId, viewer, body);
  // An admin reply marks the ticket answered; a new user message reopens it.
  db.prepare(`
    UPDATE support_threads SET status = ? WHERE id = ? AND status <> 'closed'
  `).run(viewer.role === 'admin' ? 'answered' : 'open', threadId);
  return {
    message,
    thread: getSupportThread(db, threadId, viewer),
  };
}

/** Opens a ticket for the current site user, with the first message inside. */
export function startSupportThread(db, viewer, { subject = '', body } = {}) {
  const now = isoNow();
  const info = db.prepare(`
    INSERT INTO support_threads (user_id, subject, status, created_at)
    VALUES (?, ?, 'open', ?)
  `).run(viewer.id, String(subject ?? '').trim(), now);
  const threadId = Number(info.lastInsertRowid);
  insertMessage(db, threadId, viewer, body);
  return { thread: getSupportThread(db, threadId, viewer), created: true };
}

/** Admin-only status change (open / answered / closed). */
export function setSupportStatus(db, threadId, viewer, status) {
  if (viewer.role !== 'admin') throw notFound('تیکت پشتیبانی یافت نشد');
  getSupportThread(db, threadId, viewer);
  if (!SUPPORT_STATUSES.includes(status)) throw notFound('وضعیت نامعتبر است');
  db.prepare('UPDATE support_threads SET status = ? WHERE id = ?').run(status, threadId);
  return { thread: getSupportThread(db, threadId, viewer) };
}

const GUEST_PREVIEW_LENGTH = 160;

function guestMessageJson(row) {
  return {
    id: row.id,
    name: row.name,
    contact: row.contact,
    subject: row.subject,
    body: row.body,
    preview: String(row.body ?? '').slice(0, GUEST_PREVIEW_LENGTH),
    status: row.status,
    createdAt: row.created_at,
    readAt: row.read_at,
  };
}

/**
 * Stores a public "ask the site" message from a visitor without an account.
 * This is deliberately one-way: the admin reads the message and replies using
 * the contact details the guest left, because there is no guest session to
 * show a reply in.
 */
export function createGuestSupportMessage(db, { name, contact, subject = '', body }) {
  const now = isoNow();
  const info = db.prepare(`
    INSERT INTO support_guest_messages (name, contact, subject, body, status, created_at)
    VALUES (?, ?, ?, ?, 'new', ?)
  `).run(
    String(name).trim(),
    String(contact).trim(),
    String(subject ?? '').trim(),
    String(body).trim(),
    now,
  );
  return {
    message: guestMessageJson(db.prepare('SELECT * FROM support_guest_messages WHERE id = ?').get(info.lastInsertRowid)),
  };
}

export function listGuestSupportMessages(db) {
  const rows = db.prepare(`
    SELECT * FROM support_guest_messages ORDER BY id DESC
  `).all();
  return {
    items: rows.map(guestMessageJson),
    unread: db.prepare("SELECT COUNT(*) AS n FROM support_guest_messages WHERE status = 'new'").get().n,
  };
}

export function markGuestSupportMessageRead(db, id) {
  const row = db.prepare('SELECT * FROM support_guest_messages WHERE id = ?').get(id);
  if (!row) throw notFound('پیام مهمان یافت نشد');
  db.prepare("UPDATE support_guest_messages SET status = 'read', read_at = COALESCE(read_at, ?) WHERE id = ?")
    .run(isoNow(), id);
  return {
    message: guestMessageJson(db.prepare('SELECT * FROM support_guest_messages WHERE id = ?').get(id)),
    unread: db.prepare("SELECT COUNT(*) AS n FROM support_guest_messages WHERE status = 'new'").get().n,
  };
}

