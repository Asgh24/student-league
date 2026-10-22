/**
 * sms.ir REST API (https://sms.ir/rest-api/) wrapper plus the local outbox.
 *
 * A teacher can save their own sms.ir API key and sender line; those encrypted
 * values take precedence over the server-wide `SMSIR_*` environment settings.
 * Every message is stored in `sms_messages` first. When credentials are
 * available the provider is called; otherwise the row stays `queued` so the
 * teacher can see exactly what would have been sent.
 */

import { config } from '../config.js';
import { isoNow } from '../lib/http.js';
import { decryptSecret, encryptSecret } from '../lib/secrets.js';

export const SMS_PROVIDER = 'sms.ir';

/** Reads and decrypts the credentials a teacher saved in their own panel. */
function teacherCredentials(db, teacherId) {
  if (!db || !teacherId) {
    return { apiKey: '', lineNumber: '', updatedAt: null, hasApiKey: false };
  }
  const row = db.prepare(`
    SELECT sms_api_key AS smsApiKey, sms_line_number AS smsLineNumber, sms_updated_at AS smsUpdatedAt
    FROM users WHERE id = ?
  `).get(teacherId);
  const apiKey = decryptSecret(row?.smsApiKey);
  return {
    apiKey,
    lineNumber: String(row?.smsLineNumber ?? '').trim(),
    updatedAt: row?.smsUpdatedAt ?? null,
    hasApiKey: Boolean(apiKey),
  };
}

/**
 * Public sms status for a teacher (or the server when no teacher is given).
 * It never contains the API key itself, only whether it is saved.
 */
export function smsConfigFor(db, { teacherId = null } = {}) {
  const sms = config.sms;
  const own = teacherCredentials(db, teacherId);
  const hasOwnValues = own.hasApiKey || Boolean(own.lineNumber);
  const ownComplete = own.hasApiKey && Boolean(own.lineNumber);
  const useOwn = Boolean(teacherId) && ownComplete;
  const useServer = !useOwn && !hasOwnValues && sms.enabled;

  let source = 'none';
  let lineNumber = '';
  let hasApiKey = false;
  if (useOwn) {
    source = 'teacher';
    lineNumber = own.lineNumber;
    hasApiKey = true;
  } else if (useServer) {
    source = 'server';
    lineNumber = sms.lineNumber;
    hasApiKey = Boolean(sms.apiKey);
  }

  return {
    provider: SMS_PROVIDER,
    configured: Boolean(hasApiKey && lineNumber),
    source,
    lineNumber,
    hasApiKey,
    baseUrl: sms.baseUrl,
    serverConfigured: sms.enabled,
    partialOwnSettings: Boolean(teacherId) && hasOwnValues && !ownComplete,
    own: {
      hasApiKey: own.hasApiKey,
      lineNumber: own.lineNumber,
      updatedAt: own.updatedAt,
    },
  };
}

/** Public env-only status used by the admin overview. */
export function smsConfig() {
  return smsConfigFor(null);
}

/**
 * Internal provider credentials for one request. Teachers with any saved value
 * never fall back silently to the server account: the dashboard tells them to
 * complete both fields instead.
 */
export function resolveSmsProvider(db, { teacherId = null } = {}) {
  const sms = config.sms;
  const own = teacherCredentials(db, teacherId);
  const hasOwnValues = own.hasApiKey || Boolean(own.lineNumber);
  if (teacherId && hasOwnValues) {
    const complete = own.hasApiKey && Boolean(own.lineNumber);
    return {
      apiKey: own.apiKey,
      lineNumber: own.lineNumber,
      baseUrl: sms.baseUrl,
      timeoutMs: sms.timeoutMs,
      enabled: complete,
      source: complete ? 'teacher' : 'none',
      incomplete: !complete,
    };
  }
  return {
    apiKey: sms.apiKey,
    lineNumber: sms.lineNumber,
    baseUrl: sms.baseUrl,
    timeoutMs: sms.timeoutMs,
    enabled: sms.enabled,
    source: sms.enabled ? 'server' : 'none',
    incomplete: false,
  };
}

/** Saves the teacher-scoped sms.ir settings; blank fields keep their old value. */
export function saveTeacherSmsSettings(db, teacherId, { apiKey, lineNumber, clearApiKey = false } = {}) {
  const assignments = [];
  const values = [];
  if (clearApiKey) {
    assignments.push('sms_api_key = ?');
    values.push('');
  } else if (apiKey) {
    assignments.push('sms_api_key = ?');
    values.push(encryptSecret(apiKey));
  }
  if (lineNumber !== undefined) {
    assignments.push('sms_line_number = ?');
    values.push(String(lineNumber).trim());
  }
  if (assignments.length) {
    assignments.push('sms_updated_at = ?');
    values.push(isoNow(), teacherId);
    db.prepare(`UPDATE users SET ${assignments.join(', ')} WHERE id = ?`).run(...values);
  }
  return smsConfigFor(db, { teacherId });
}

function timeoutSignal(credentials) {
  return globalThis.AbortSignal?.timeout?.(credentials.timeoutMs);
}

async function smsRequest(credentials, path, { method = 'GET', body = null, fetchImpl = globalThis.fetch } = {}) {
  if (!credentials.enabled) {
    return {
      ok: false,
      queued: true,
      reason: 'SMS_NOT_CONFIGURED',
    };
  }
  let response;
  try {
    response = await fetchImpl(`${credentials.baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-API-KEY': credentials.apiKey,
      },
      ...(body === null ? {} : { body: JSON.stringify(body) }),
      signal: timeoutSignal(credentials),
    });
  } catch (error) {
    return { ok: false, error: `ارتباط با sms.ir برقرار نشد: ${error?.message ?? error}` };
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok || payload?.status !== 1) {
    return {
      ok: false,
      configured: true,
      error: payload?.message ?? `sms.ir پاسخ ${response.status} داد`,
      providerStatus: payload?.status ?? null,
    };
  }
  return { ok: true, configured: true, data: payload?.data ?? null };
}

/**
 * Sends one message through `POST /v1/send/bulk` (one recipient per call, so
 * every student report can have its own text).
 */
export async function deliverSms({ mobile, text, fetchImpl = globalThis.fetch, credentials = null }) {
  const result = await deliverSmsBulk({ mobiles: [mobile], text, fetchImpl, credentials });
  if (!result.ok) return result;
  return {
    ok: true,
    providerMessageId: result.providerMessageIds?.[0] ?? null,
    packId: result.packId ?? null,
    cost: result.cost ?? null,
  };
}

/** Bulk send (sms.ir accepts at most 100 mobiles per request). */
export async function deliverSmsBulk({ mobiles, text, fetchImpl = globalThis.fetch, credentials = null }) {
  const unique = [...new Set((mobiles ?? []).map((mobile) => String(mobile).trim()).filter(Boolean))];
  if (unique.length === 0) return { ok: false, error: 'شمارهٔ گیرنده‌ای ارسال نشده است' };
  if (unique.length > 100) return { ok: false, error: 'sms.ir حداکثر ۱۰۰ شماره در هر درخواست می‌پذیرد' };
  const provider = credentials ?? resolveSmsProvider(null);
  if (!provider.enabled) return { ok: false, queued: true, reason: 'SMS_NOT_CONFIGURED' };
  const lineNumber = Number(provider.lineNumber);
  if (!Number.isFinite(lineNumber)) return { ok: false, error: 'شماره خط sms.ir معتبر نیست' };

  const result = await smsRequest(provider, '/v1/send/bulk', {
    method: 'POST',
    body: {
      lineNumber,
      messageText: text,
      mobiles: unique,
      sendDateTime: null,
    },
    fetchImpl,
  });
  if (!result.ok) return result;
  return {
    ok: true,
    providerMessageIds: result.data?.messageIds ?? [],
    packId: result.data?.packId ?? null,
    cost: result.data?.cost ?? null,
  };
}

/** Current account credit, in Rial, from `GET /v1/credit`. */
export async function fetchSmsCredit({ fetchImpl = globalThis.fetch, credentials = null } = {}) {
  const provider = credentials ?? resolveSmsProvider(null);
  if (!provider.enabled) return { ok: false, configured: false, reason: 'SMS_NOT_CONFIGURED' };
  const result = await smsRequest(provider, '/v1/credit', { fetchImpl });
  if (!result.ok) return { ...result, configured: true };
  const data = result.data;
  const credit = typeof data === 'number' ? data : Number(data?.credit ?? data?.remainingCredit ?? NaN);
  return { ok: true, configured: true, credit: Number.isFinite(credit) ? credit : null, raw: data };
}

/** Active lines from `GET /v1/line`. */
export async function fetchSmsLines({ fetchImpl = globalThis.fetch, credentials = null } = {}) {
  const provider = credentials ?? resolveSmsProvider(null);
  if (!provider.enabled) return { ok: false, configured: false, reason: 'SMS_NOT_CONFIGURED' };
  const result = await smsRequest(provider, '/v1/line', { fetchImpl });
  if (!result.ok) return { ...result, configured: true };
  const lines = Array.isArray(result.data) ? result.data : [];
  return { ok: true, configured: true, lines };
}

/** Stores a message before delivery so nothing is lost on provider failure. */
export function queueMessage(db, { leagueId, studentId = null, mobile, body, kind = 'daily_report', reportDate = '' }) {
  const info = db.prepare(`
    INSERT INTO sms_messages (league_id, student_id, mobile, kind, report_date, body, status, provider, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?)
  `).run(leagueId, studentId, mobile, kind, reportDate, body, SMS_PROVIDER, isoNow());
  return Number(info.lastInsertRowid);
}

export function markMessage(db, id, { status, providerMessageId = null, error = '' }) {
  const sentAt = status === 'sent' ? isoNow() : null;
  db.prepare('UPDATE sms_messages SET status = ?, provider_message_id = ?, error = ?, sent_at = ? WHERE id = ?')
    .run(status, providerMessageId === null ? null : String(providerMessageId), String(error ?? '').slice(0, 500), sentAt, id);
}

/* --------------------------- admin SMS console --------------------------- */

export function queueCampaign(db, { adminId = null, kind = 'bulk', mobile, body }) {
  const info = db.prepare(`
    INSERT INTO sms_campaigns (admin_id, kind, mobile, body, status, provider, created_at)
    VALUES (?, ?, ?, ?, 'queued', ?, ?)
  `).run(adminId, kind, mobile, body, SMS_PROVIDER, isoNow());
  return Number(info.lastInsertRowid);
}

export function markCampaign(db, id, { status, providerMessageId = null, error = '' }) {
  const sentAt = status === 'sent' ? isoNow() : null;
  db.prepare('UPDATE sms_campaigns SET status = ?, provider_message_id = ?, error = ?, sent_at = ? WHERE id = ?')
    .run(status, providerMessageId === null ? null : String(providerMessageId), String(error ?? '').slice(0, 500), sentAt, id);
}

function campaignJson(row) {
  return {
    id: row.id,
    kind: row.kind,
    mobile: row.mobile,
    body: row.body,
    status: row.status,
    provider: row.provider,
    providerMessageId: row.provider_message_id,
    error: row.error,
    createdAt: row.created_at,
    sentAt: row.sent_at,
  };
}

export function listCampaigns(db, { limit = 50, status = '' } = {}) {
  const rows = status
    ? db.prepare('SELECT * FROM sms_campaigns WHERE status = ? ORDER BY id DESC LIMIT ?').all(status, limit)
    : db.prepare('SELECT * FROM sms_campaigns ORDER BY id DESC LIMIT ?').all(limit);
  return rows.map(campaignJson);
}

/** Every league report message, with its teacher and student for the admin view. */
export function listOutbox(db, { limit = 50, status = '' } = {}) {
  const rows = status
    ? db.prepare(`
        SELECT m.*, l.name AS league_name, u.display_name AS teacher_name, s.name AS student_name
        FROM sms_messages m
        JOIN leagues l ON l.id = m.league_id
        JOIN users u ON u.id = l.teacher_id
        LEFT JOIN students s ON s.id = m.student_id
        WHERE m.status = ? ORDER BY m.id DESC LIMIT ?
      `).all(status, limit)
    : db.prepare(`
        SELECT m.*, l.name AS league_name, u.display_name AS teacher_name, s.name AS student_name
        FROM sms_messages m
        JOIN leagues l ON l.id = m.league_id
        JOIN users u ON u.id = l.teacher_id
        LEFT JOIN students s ON s.id = m.student_id
        ORDER BY m.id DESC LIMIT ?
      `).all(limit);
  return rows.map((row) => ({
    id: row.id,
    leagueId: row.league_id,
    leagueName: row.league_name,
    teacherName: row.teacher_name,
    studentId: row.student_id,
    studentName: row.student_name ?? '',
    mobile: row.mobile,
    kind: row.kind,
    reportDate: row.report_date,
    body: row.body,
    status: row.status,
    provider: row.provider,
    providerMessageId: row.provider_message_id,
    error: row.error,
    createdAt: row.created_at,
    sentAt: row.sent_at,
  }));
}

export function smsCounts(db) {
  const empty = { queued: 0, sent: 0, failed: 0 };
  const outbox = { ...empty };
  const campaigns = { ...empty };
  for (const row of db.prepare('SELECT status, COUNT(*) AS n FROM sms_messages GROUP BY status').all()) {
    if (row.status in outbox) outbox[row.status] = row.n;
  }
  for (const row of db.prepare('SELECT status, COUNT(*) AS n FROM sms_campaigns GROUP BY status').all()) {
    if (row.status in campaigns) campaigns[row.status] = row.n;
  }
  return { outbox, campaigns };
}

/** Re-sends one failed/queued league report message with its teacher's account. */
export async function retryOutboxMessage(db, id, { fetchImpl = globalThis.fetch } = {}) {
  const row = db.prepare(`
    SELECT m.*, l.teacher_id AS teacherId
    FROM sms_messages m JOIN leagues l ON l.id = m.league_id
    WHERE m.id = ?
  `).get(id);
  if (!row) return null;
  const credentials = resolveSmsProvider(db, { teacherId: row.teacherId });
  const result = await deliverSms({ mobile: row.mobile, text: row.body, fetchImpl, credentials });
  if (result.ok) {
    markMessage(db, row.id, { status: 'sent', providerMessageId: result.providerMessageId });
  } else {
    markMessage(db, row.id, { status: 'failed', error: result.error ?? result.reason ?? 'ارسال ناموفق' });
  }
  return { id: row.id, delivery: result };
}

/** Re-sends one admin campaign message with the server account. */
export async function retryCampaign(db, id, { fetchImpl = globalThis.fetch } = {}) {
  const row = db.prepare('SELECT * FROM sms_campaigns WHERE id = ?').get(id);
  if (!row) return null;
  const result = await deliverSms({ mobile: row.mobile, text: row.body, fetchImpl });
  if (result.ok) {
    markCampaign(db, row.id, { status: 'sent', providerMessageId: result.providerMessageId });
  } else {
    markCampaign(db, row.id, { status: 'failed', error: result.error ?? result.reason ?? 'ارسال ناموفق' });
  }
  return { id: row.id, delivery: result };
}

/** Newest messages of a league, optionally filtered to one report date. */
export function recentMessages(db, leagueId, { limit = 25, reportDate = '' } = {}) {
  const rows = reportDate
    ? db.prepare(`
        SELECT m.*, s.name AS studentName
        FROM sms_messages m LEFT JOIN students s ON s.id = m.student_id
        WHERE m.league_id = ? AND m.report_date = ?
        ORDER BY m.id DESC LIMIT ?
      `).all(leagueId, reportDate, limit)
    : db.prepare(`
        SELECT m.*, s.name AS studentName
        FROM sms_messages m LEFT JOIN students s ON s.id = m.student_id
        WHERE m.league_id = ?
        ORDER BY m.id DESC LIMIT ?
      `).all(leagueId, limit);
  return rows.map((row) => ({
    id: row.id,
    studentId: row.student_id,
    studentName: row.studentName ?? '',
    mobile: row.mobile,
    body: row.body,
    status: row.status,
    provider: row.provider,
    providerMessageId: row.provider_message_id,
    error: row.error,
    reportDate: row.report_date,
    createdAt: row.created_at,
    sentAt: row.sent_at,
  }));
}
