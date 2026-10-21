import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { isoNow } from '../lib/http.js';
import { studentContext } from './studentPortal.js';

/**
 * In-site teacher <-> student messaging.
 *
 * A conversation always belongs to exactly one teacher and one student row.
 * The viewer is resolved once per request into `{ role, id, studentId? }` so
 * every query below can stay scoped to the participant without trusting an id
 * supplied by the client.
 */

const PREVIEW_LENGTH = 160;

const THREAD_SELECT = `
  SELECT c.id, c.subject, c.teacher_id AS teacherId, c.student_id AS studentId,
         c.league_id AS leagueId, c.last_message_at AS lastMessageAt, c.created_at AS createdAt,
         t.display_name AS teacherName, s.name AS studentName,
         lm.body AS lastBody, lm.created_at AS lastAt, lm.sender_user_id AS lastSenderId,
         (SELECT COUNT(*)
          FROM messages um
          WHERE um.conversation_id = c.id AND um.read_at IS NULL AND um.sender_user_id <> ?) AS unread
  FROM conversations c
  JOIN users t ON t.id = c.teacher_id
  JOIN students s ON s.id = c.student_id
  LEFT JOIN messages lm ON lm.id = (
    SELECT m.id FROM messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1
  )
`;

/** Resolves the messaging identity of the logged in user, or null. */
export function messageViewer(db, user) {
  if (!user) return null;
  if (user.role === 'teacher') return { role: 'teacher', id: user.id };
  if (user.role !== 'student') return null;
  const context = studentContext(db, user.id);
  if (!context) return null;
  return {
    role: 'student',
    id: user.id,
    studentId: context.id,
    leagueId: context.leagueId,
    teacherId: context.teacherId,
  };
}

function threadJson(row, role) {
  if (!row) return null;
  return {
    id: row.id,
    subject: row.subject,
    teacherId: row.teacherId,
    teacherName: row.teacherName,
    studentId: row.studentId,
    studentName: row.studentName,
    leagueId: row.leagueId,
    participantName: role === 'student' ? row.teacherName : row.studentName,
    lastMessage: row.lastBody === null
      ? null
      : {
        body: row.lastBody,
        at: row.lastAt,
        senderRole: row.lastSenderId === row.teacherId ? 'teacher' : 'student',
      },
    unread: Number(row.unread) || 0,
    createdAt: row.createdAt,
    updatedAt: row.lastMessageAt ?? row.createdAt,
  };
}

function threadRow(db, conversationId, viewer) {
  if (viewer.role === 'teacher') {
    return db.prepare(`${THREAD_SELECT} WHERE c.id = ? AND c.teacher_id = ?`)
      .get(viewer.id, conversationId, viewer.id);
  }
  return db.prepare(`${THREAD_SELECT} WHERE c.id = ? AND c.student_id = ?`)
    .get(viewer.id, conversationId, viewer.studentId);
}

/** The conversation as seen by `viewer`; throws when it is not theirs. */
export function getThread(db, conversationId, viewer) {
  const row = threadRow(db, conversationId, viewer);
  if (!row) throw notFound('گفتگو یافت نشد');
  return threadJson(row, viewer.role);
}

export function unreadTotal(db, viewer) {
  if (viewer.role === 'teacher') {
    return db.prepare(`
      SELECT COUNT(*) AS n
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE m.read_at IS NULL AND m.sender_user_id <> ? AND c.teacher_id = ?
    `).get(viewer.id, viewer.id).n;
  }
  return db.prepare(`
    SELECT COUNT(*) AS n
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE m.read_at IS NULL AND m.sender_user_id <> ? AND c.student_id = ?
  `).get(viewer.id, viewer.studentId).n;
}

export function listThreads(db, viewer) {
  const where = viewer.role === 'teacher' ? 'c.teacher_id = ?' : 'c.student_id = ?';
  const scopeId = viewer.role === 'teacher' ? viewer.id : viewer.studentId;
  const rows = db.prepare(`
    ${THREAD_SELECT}
    WHERE ${where}
    ORDER BY COALESCE(c.last_message_at, c.created_at) DESC, c.id DESC
  `).all(viewer.id, scopeId);
  return {
    items: rows.map((row) => threadJson(row, viewer.role)),
    unreadTotal: unreadTotal(db, viewer),
  };
}

function messageRows(db, conversationId, viewer, { limit = 100, before = null } = {}) {
  const rows = db.prepare(`
    SELECT * FROM (
      SELECT m.id, m.body, m.sender_user_id AS senderUserId, m.created_at AS createdAt,
             m.read_at AS readAt, c.teacher_id AS teacherId,
             t.display_name AS teacherName, s.name AS studentName
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      JOIN users t ON t.id = c.teacher_id
      JOIN students s ON s.id = c.student_id
      WHERE m.conversation_id = ?${before ? ' AND m.id < ?' : ''}
      ORDER BY m.id DESC
      LIMIT ?
    )
    ORDER BY id ASC
  `).all(...(before ? [conversationId, before, limit] : [conversationId, limit]));
  return rows.map((row) => messageJson(row, viewer));
}

function messageJson(row, viewer) {
  const senderRole = row.senderUserId === row.teacherId ? 'teacher' : 'student';
  return {
    id: row.id,
    body: row.body,
    senderRole,
    senderName: senderRole === 'teacher' ? row.teacherName : row.studentName,
    createdAt: row.createdAt,
    mine: row.senderUserId === viewer.id,
    readAt: row.readAt ?? null,
  };
}

function markIncomingRead(db, conversationId, viewer) {
  return db.prepare(`
    UPDATE messages
    SET read_at = ?
    WHERE conversation_id = ? AND sender_user_id <> ? AND read_at IS NULL
  `).run(isoNow(), conversationId, viewer.id).changes;
}

/** Marks the other participant's messages read and returns the refreshed thread. */
export function readThread(db, conversationId, viewer, options = {}) {
  getThread(db, conversationId, viewer);
  markIncomingRead(db, conversationId, viewer);
  return {
    thread: getThread(db, conversationId, viewer),
    messages: messageRows(db, conversationId, viewer, options),
    unreadTotal: unreadTotal(db, viewer),
  };
}

export function markRead(db, conversationId, viewer) {
  getThread(db, conversationId, viewer);
  markIncomingRead(db, conversationId, viewer);
  return { ok: true, unreadTotal: unreadTotal(db, viewer) };
}

export function sendMessage(db, conversationId, viewer, body) {
  getThread(db, conversationId, viewer);
  const text = String(body).trim();
  const now = isoNow();
  const info = db.prepare(`
    INSERT INTO messages (conversation_id, sender_user_id, body, created_at, read_at)
    VALUES (?, ?, ?, ?, NULL)
  `).run(conversationId, viewer.id, text, now);

  db.prepare(`
    UPDATE conversations SET last_message_at = ?, last_message_preview = ? WHERE id = ?
  `).run(now, text.slice(0, PREVIEW_LENGTH), conversationId);

  const row = db.prepare(`
    SELECT m.id, m.body, m.sender_user_id AS senderUserId, m.created_at AS createdAt,
           m.read_at AS readAt, c.teacher_id AS teacherId,
           t.display_name AS teacherName, s.name AS studentName
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    JOIN users t ON t.id = c.teacher_id
    JOIN students s ON s.id = c.student_id
    WHERE m.id = ?
  `).get(info.lastInsertRowid);

  return {
    message: messageJson(row, viewer),
    thread: getThread(db, conversationId, viewer),
  };
}

/**
 * Starts (or reuses) the conversation of the current user.
 *
 * - teacher: `studentId` must point at a student with a login in one of the
 *   teacher's own leagues,
 * - student: the student row, league and teacher are derived from the session.
 */
export function startThread(db, viewer, { studentId, subject = '' } = {}) {
  let teacherId;
  let targetStudentId;
  let leagueId;

  if (viewer.role === 'teacher') {
    if (!Number.isFinite(Number(studentId)) || Number(studentId) <= 0) {
      throw badRequest('STUDENT_REQUIRED', 'انتخاب دانش‌آموز الزامی است');
    }
    const student = db.prepare(`
      SELECT s.id, s.user_id AS userId, s.league_id AS leagueId, l.teacher_id AS ownerId
      FROM students s JOIN leagues l ON l.id = s.league_id
      WHERE s.id = ?
    `).get(Number(studentId));
    if (!student) throw notFound('دانش‌آموز یافت نشد');
    if (student.ownerId !== viewer.id) throw forbidden('این دانش‌آموز به لیگ شما تعلق ندارد');
    if (!student.userId) throw badRequest('STUDENT_WITHOUT_ACCOUNT', 'این دانش‌آموز حساب کاربری ندارد');
    teacherId = viewer.id;
    targetStudentId = student.id;
    leagueId = student.leagueId;
  } else {
    if (!viewer.studentId || !viewer.teacherId) throw notFound('برای حساب شما دانش‌آموزی ثبت نشده است');
    teacherId = viewer.teacherId;
    targetStudentId = viewer.studentId;
    leagueId = viewer.leagueId;
  }

  const existing = db.prepare(
    'SELECT id FROM conversations WHERE teacher_id = ? AND student_id = ?',
  ).get(teacherId, targetStudentId);
  if (existing) {
    return { thread: getThread(db, existing.id, viewer), created: false };
  }

  const info = db.prepare(`
    INSERT INTO conversations (teacher_id, student_id, league_id, subject, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(teacherId, targetStudentId, leagueId, String(subject ?? '').trim(), isoNow());

  return { thread: getThread(db, Number(info.lastInsertRowid), viewer), created: true };
}

/** Students this teacher can message (they must have a login account). */
function teacherContacts(db, viewer) {
  const rows = db.prepare(`
    SELECT s.id AS studentId, s.name AS studentName, s.user_id AS userId, u.username AS username,
           s.league_id AS leagueId, l.name AS leagueName, c.id AS conversationId
    FROM students s
    JOIN leagues l ON l.id = s.league_id
    JOIN users u ON u.id = s.user_id
    LEFT JOIN conversations c ON c.student_id = s.id AND c.teacher_id = ?
    WHERE l.teacher_id = ? AND s.user_id IS NOT NULL
    ORDER BY s.name COLLATE NOCASE ASC, s.id ASC
  `).all(viewer.id, viewer.id);
  return {
    items: rows.map((row) => ({
      studentId: row.studentId,
      studentName: row.studentName,
      userId: row.userId,
      username: row.username,
      leagueId: row.leagueId,
      leagueName: row.leagueName,
      conversationId: row.conversationId ?? null,
    })),
    role: 'teacher',
  };
}

/** A student sees only their own teacher. */
function studentContacts(db, viewer) {
  const rows = db.prepare(`
    SELECT l.teacher_id AS teacherId, u.display_name AS teacherName,
           s.league_id AS leagueId, l.name AS leagueName, c.id AS conversationId
    FROM students s
    JOIN leagues l ON l.id = s.league_id
    JOIN users u ON u.id = l.teacher_id
    LEFT JOIN conversations c ON c.student_id = s.id AND c.teacher_id = l.teacher_id
    WHERE s.id = ?
  `).all(viewer.studentId);
  return {
    items: rows.map((row) => ({
      teacherId: row.teacherId,
      teacherName: row.teacherName,
      leagueId: row.leagueId,
      leagueName: row.leagueName,
      conversationId: row.conversationId ?? null,
    })),
    role: 'student',
  };
}

export function contacts(db, viewer) {
  return viewer.role === 'teacher' ? teacherContacts(db, viewer) : studentContacts(db, viewer);
}
