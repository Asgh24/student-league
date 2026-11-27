/**
 * In-site notification centre.
 *
 * A notification is a small piece of text one sender (a teacher, or the site
 * management) writes for a group of site users. It is stored once and copied
 * into `notification_recipients` for every receiver, which makes the per-user
 * inbox, unread badge and "read" state a cheap indexed lookup instead of a
 * costly audience query on every poll.
 *
 * Parents do not have a site login, so a teacher may additionally ask for the
 * same notice to be queued in the existing sms.ir outbox. That is the only
 * delivery path that leaves the site.
 */

import { badRequest, notFound } from '../lib/errors.js';
import { isoNow } from '../lib/http.js';
import { normalizeMobile } from '../lib/phone.js';
import { contactsList } from './contacts.js';
import { deliverSms, markMessage, queueMessage, resolveSmsProvider } from './sms.js';

export const NOTIFICATION_CATEGORIES = [
  { key: 'info', label: 'اطلاعیه', icon: '📢' },
  { key: 'success', label: 'خبر خوب', icon: '✅' },
  { key: 'warning', label: 'هشدار', icon: '⚠️' },
  { key: 'urgent', label: 'فوری', icon: '🚨' },
];

const CATEGORY_KEYS = new Set(NOTIFICATION_CATEGORIES.map((item) => item.key));

export const AUDIENCE_LABELS = {
  all: 'همه کاربران سایت',
  teachers: 'همه معلمان',
  students: 'همه دانش‌آموزان',
  league: 'همه دانش‌آموزان لیگ',
  selected: 'دانش‌آموزان انتخابی',
  student: 'یک دانش‌آموز',
};

const SMS_MAX_LENGTH = 1000;

export function normalizeCategory(value) {
  const key = String(value ?? '').trim();
  return CATEGORY_KEYS.has(key) ? key : 'info';
}

/**
 * `link` is an internal hash route the frontend opens on click. Only safe path
 * characters are accepted so a notification can never point at an external URL.
 */
export function normalizeLink(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const cleaned = raw.replace(/^#/, '').replace(/^\/+/, '');
  if (!cleaned || !/^[A-Za-z0-9/_-]+$/.test(cleaned)) {
    throw badRequest('INVALID_LINK', 'لینک اعلان باید یک مسیر داخلی سایت باشد');
  }
  return cleaned;
}

function notificationJson(row) {
  return {
    id: row.id,
    source: row.source,
    senderName: row.senderName,
    title: row.title,
    body: row.body,
    category: row.category,
    link: row.link ?? '',
    pinned: row.pinned === 1,
    createdAt: row.createdAt,
    readAt: row.readAt ?? null,
  };
}

function parseSms(raw) {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

export function unreadCount(db, userId) {
  return db.prepare(
    'SELECT COUNT(*) AS n FROM notification_recipients WHERE user_id = ? AND read_at IS NULL',
  ).get(userId).n;
}

/** Badge payload: the unread count plus the newest unread notice (for desks). */
export function unreadSummary(db, userId) {
  const latest = db.prepare(`
    SELECT n.id, n.title, n.body, n.category, n.link, n.created_at AS createdAt
    FROM notification_recipients r
    JOIN notifications n ON n.id = r.notification_id
    WHERE r.user_id = ? AND r.read_at IS NULL
    ORDER BY n.id DESC
    LIMIT 1
  `).get(userId);
  return { count: unreadCount(db, userId), latest: latest ?? null };
}

/** The signed-in user's inbox, newest first (pinned notices on top). */
export function listInbox(db, userId, { page = 1, limit = 50, onlyUnread = false } = {}) {
  const unreadFilter = onlyUnread ? 'AND r.read_at IS NULL' : '';
  const total = db.prepare(`
    SELECT COUNT(*) AS n
    FROM notification_recipients r
    JOIN notifications n ON n.id = r.notification_id
    WHERE r.user_id = ? ${unreadFilter}
  `).get(userId).n;

  const rows = db.prepare(`
    SELECT n.id, n.source, n.sender_name AS senderName, n.title, n.body, n.category,
           n.link, n.pinned, n.created_at AS createdAt, r.read_at AS readAt
    FROM notification_recipients r
    JOIN notifications n ON n.id = r.notification_id
    WHERE r.user_id = ? ${unreadFilter}
    ORDER BY n.pinned DESC, n.id DESC
    LIMIT ? OFFSET ?
  `).all(userId, limit, (page - 1) * limit);

  return {
    items: rows.map(notificationJson),
    total,
    page,
    limit,
    hasMore: page * limit < total,
    unreadTotal: unreadCount(db, userId),
  };
}

function requireRecipient(db, userId, notificationId) {
  const row = db.prepare(`
    SELECT notification_id
    FROM notification_recipients
    WHERE notification_id = ? AND user_id = ?
  `).get(notificationId, userId);
  if (!row) throw notFound('اعلان یافت نشد');
}

export function markRead(db, userId, notificationId) {
  requireRecipient(db, userId, notificationId);
  db.prepare(`
    UPDATE notification_recipients SET read_at = ?
    WHERE notification_id = ? AND user_id = ? AND read_at IS NULL
  `).run(isoNow(), notificationId, userId);
  return { ok: true, unreadTotal: unreadCount(db, userId) };
}

export function markAllRead(db, userId) {
  db.prepare(`
    UPDATE notification_recipients SET read_at = ?
    WHERE user_id = ? AND read_at IS NULL
  `).run(isoNow(), userId);
  return { ok: true, unreadTotal: 0 };
}

/** Removes one notice from this user's inbox only (others keep their copy). */
export function deleteForUser(db, userId, notificationId) {
  requireRecipient(db, userId, notificationId);
  db.prepare('DELETE FROM notification_recipients WHERE notification_id = ? AND user_id = ?')
    .run(notificationId, userId);
  return { ok: true, unreadTotal: unreadCount(db, userId) };
}

function insertNotification(db, {
  source,
  senderId,
  senderName,
  audience,
  leagueId = null,
  studentId = null,
  title,
  body,
  category,
  link,
  pinned,
  recipientUserIds,
}) {
  const now = isoNow();
  const insert = db.prepare(`
    INSERT INTO notifications
      (source, sender_id, sender_name, audience, league_id, student_id,
       title, body, category, link, pinned, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const addRecipient = db.prepare(`
    INSERT OR IGNORE INTO notification_recipients (notification_id, user_id, read_at, created_at)
    VALUES (?, ?, NULL, ?)
  `);

  return db.transaction(() => {
    const info = insert.run(
      source,
      senderId,
      senderName,
      audience,
      leagueId,
      studentId,
      title,
      body,
      category,
      link,
      pinned ? 1 : 0,
      now,
    );
    const id = Number(info.lastInsertRowid);
    for (const userId of recipientUserIds) addRecipient.run(id, userId, now);
    return id;
  })();
}

function loadNotification(db, id) {
  const row = db.prepare(`
    SELECT id, source, sender_name AS senderName, title, body, category, link, pinned,
           created_at AS createdAt, NULL AS readAt
    FROM notifications WHERE id = ?
  `).get(id);
  return row ? notificationJson(row) : null;
}

function normalizeText(input) {
  return {
    title: String(input.title ?? '').trim(),
    body: String(input.body ?? '').trim(),
    category: normalizeCategory(input.category),
    link: normalizeLink(input.link),
    pinned: input.pinned === true,
  };
}

/** Students of one league with the two delivery capabilities the composer shows. */
export function leagueAudience(db, leagueId) {
  const contacts = contactsList(db, leagueId);
  return {
    students: contacts.map((row) => ({
      id: row.id,
      name: row.name,
      hasLogin: row.hasLogin,
      hasParentPhone: row.hasParentPhone,
    })),
    counts: {
      students: contacts.length,
      withLogin: contacts.filter((row) => row.hasLogin).length,
      withParentPhone: contacts.filter((row) => row.hasParentPhone).length,
    },
  };
}

/** Collects the target rows for a teacher notice. */
function teacherTargets(db, league, input) {
  const rows = db.prepare(`
    SELECT id, user_id AS userId, name, parent_phone AS parentPhone
    FROM students
    WHERE league_id = ?
    ORDER BY id ASC
  `).all(league.id);
  const byId = new Map(rows.map((row) => [row.id, row]));
  let targets = rows;
  if (input.audience === 'selected') {
    const ids = [...new Set((input.studentIds ?? []).map((value) => Number(value)).filter(Number.isInteger))];
    if (ids.length === 0) {
      throw badRequest('STUDENTS_REQUIRED', 'حداقل یک دانش‌آموز برای ارسال اعلان انتخاب کنید');
    }
    const missing = ids.filter((id) => !byId.has(id));
    if (missing.length > 0) {
      throw badRequest('STUDENTS_NOT_FOUND', 'برخی از دانش‌آموزان انتخاب‌شده در این لیگ نیستند');
    }
    targets = ids.map((id) => byId.get(id));
  }
  return targets;
}

function smsCounts(results) {
  const counts = { sent: 0, queued: 0, failed: 0, skipped: 0 };
  for (const result of results) counts[result.status] += 1;
  return counts;
}

async function sendParentSms(db, { league, teacherId, targets, title, body, fetchImpl }) {
  const text = `${title}\n${body}`.slice(0, SMS_MAX_LENGTH);
  const credentials = resolveSmsProvider(db, { teacherId });
  const results = [];
  const seen = new Set();

  for (const target of targets) {
    const mobile = normalizeMobile(target.parentPhone);
    if (!mobile) {
      results.push({ studentId: target.id, name: target.name, status: 'skipped', reason: 'NO_PARENT_PHONE' });
      continue;
    }
    if (seen.has(mobile)) {
      results.push({ studentId: target.id, name: target.name, status: 'skipped', reason: 'DUPLICATE_PHONE' });
      continue;
    }
    seen.add(mobile);

    const messageId = queueMessage(db, {
      leagueId: league.id,
      studentId: target.id,
      mobile,
      body: text,
      kind: 'notice',
    });
    const outcome = await deliverSms({ mobile, text, fetchImpl, credentials });
    if (outcome.ok) {
      markMessage(db, messageId, { status: 'sent', providerMessageId: outcome.providerMessageId });
      results.push({ studentId: target.id, name: target.name, status: 'sent', messageId });
    } else if (outcome.queued) {
      results.push({ studentId: target.id, name: target.name, status: 'queued', messageId });
    } else {
      markMessage(db, messageId, { status: 'failed', error: outcome.error });
      results.push({ studentId: target.id, name: target.name, status: 'failed', messageId, error: outcome.error });
    }
  }

  return { ...smsCounts(results), configured: Boolean(credentials.enabled), results };
}

/**
 * A teacher notice scoped to one owned league: every student of the league, or
 * a hand-picked subset. Students without a login still count for the optional
 * parent SMS, so a class can be reached even when only some children have an
 * account.
 */
export async function sendTeacherNotification(db, {
  user,
  teacherId,
  league,
  input,
  fetchImpl = globalThis.fetch,
} = {}) {
  const text = normalizeText(input);
  const targets = teacherTargets(db, league, input);
  const recipientUserIds = [...new Set(targets.map((row) => row.userId).filter(Boolean))];
  const wantsSms = input.sendSms === true;

  if (recipientUserIds.length === 0 && !wantsSms) {
    throw badRequest(
      'NO_RECIPIENTS',
      'هیچ دانش‌آموزی در این لیگ حساب کاربری ندارد. برای رساندن پیام به والدین، گزینهٔ پیامک را فعال کنید',
    );
  }

  const audience = input.audience === 'selected'
    ? (targets.length === 1 ? 'student' : 'selected')
    : 'league';

  const id = insertNotification(db, {
    source: 'teacher',
    senderId: user.id,
    senderName: user.displayName,
    audience,
    leagueId: league.id,
    studentId: targets.length === 1 ? targets[0].id : null,
    ...text,
    recipientUserIds,
  });

  let sms = null;
  if (wantsSms) {
    sms = await sendParentSms(db, {
      league,
      teacherId: teacherId ?? league.teacher_id,
      targets,
      title: text.title,
      body: text.body,
      fetchImpl,
    });
    db.prepare('UPDATE notifications SET sms_json = ? WHERE id = ?')
      .run(JSON.stringify({ ...sms, results: undefined }), id);
  }

  return {
    notification: loadNotification(db, id),
    recipients: {
      students: targets.length,
      accounts: recipientUserIds.length,
      parents: targets.filter((row) => normalizeMobile(row.parentPhone)).length,
    },
    sms: sms ? { ...sms, results: undefined } : null,
  };
}

/** A site-management broadcast to everyone or to one role. */
export function sendAdminNotification(db, { user, input } = {}) {
  const text = normalizeText(input);
  const audience = ['all', 'teachers', 'students'].includes(input.audience) ? input.audience : 'all';

  let rows;
  if (audience === 'teachers') {
    rows = db.prepare("SELECT id FROM users WHERE role = 'teacher'").all();
  } else if (audience === 'students') {
    rows = db.prepare("SELECT id FROM users WHERE role = 'student'").all();
  } else {
    rows = db.prepare('SELECT id FROM users').all();
  }
  const recipientUserIds = rows.map((row) => row.id);
  if (recipientUserIds.length === 0) {
    throw badRequest('NO_RECIPIENTS', 'هیچ کاربری برای دریافت این اعلان وجود ندارد');
  }

  const id = insertNotification(db, {
    source: 'admin',
    senderId: user.id,
    senderName: user.displayName,
    audience,
    ...text,
    recipientUserIds,
  });

  return {
    notification: loadNotification(db, id),
    recipients: { users: recipientUserIds.length },
  };
}

function sentJson(row) {
  return {
    ...notificationJson({ ...row, readAt: null }),
    audienceLabel: AUDIENCE_LABELS[row.audience] ?? row.audience,
    recipientCount: Number(row.recipientCount) || 0,
    readCount: Number(row.readCount) || 0,
    sms: parseSms(row.smsJson),
  };
}

/**
 * Notices already sent by a teacher (scoped to one league) or by the admin
 * console, with how many recipients have opened them.
 */
export function listSent(db, { source, leagueId = null, limit = 50 } = {}) {
  const params = [source];
  let scope = '';
  if (leagueId !== null && leagueId !== undefined) {
    scope = 'AND n.league_id = ?';
    params.push(leagueId);
  }
  params.push(limit);

  const rows = db.prepare(`
    SELECT n.id, n.source, n.sender_name AS senderName, n.title, n.body, n.category,
           n.link, n.pinned, n.audience, n.sms_json AS smsJson, n.created_at AS createdAt,
           (SELECT COUNT(*) FROM notification_recipients r WHERE r.notification_id = n.id) AS recipientCount,
           (SELECT COUNT(*) FROM notification_recipients r
             WHERE r.notification_id = n.id AND r.read_at IS NOT NULL) AS readCount
    FROM notifications n
    WHERE n.source = ? ${scope}
    ORDER BY n.id DESC
    LIMIT ?
  `).all(...params);

  return { items: rows.map(sentJson) };
}
