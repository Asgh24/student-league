/**
 * sms.ir REST API (https://sms.ir/rest-api/) wrapper plus the local outbox.
 *
 * Every message is stored in `sms_messages` first. When credentials are
 * configured the provider is called; otherwise the row stays `queued` so the
 * teacher can see exactly what would have been sent.
 */

import { config } from '../config.js';
import { isoNow } from '../lib/http.js';

export const SMS_PROVIDER = 'sms.ir';

export function smsConfig() {
  const sms = config.sms;
  return {
    provider: SMS_PROVIDER,
    configured: sms.enabled,
    lineNumber: sms.lineNumber,
    baseUrl: sms.baseUrl,
    hasApiKey: Boolean(sms.apiKey),
  };
}

function timeoutSignal() {
  return globalThis.AbortSignal?.timeout?.(config.sms.timeoutMs);
}

async function smsRequest(path, { method = 'GET', body = null, fetchImpl = globalThis.fetch } = {}) {
  const sms = config.sms;
  if (!sms.enabled) return { ok: false, queued: true, reason: 'SMS_NOT_CONFIGURED' };
  let response;
  try {
    response = await fetchImpl(`${sms.baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-API-KEY': sms.apiKey,
      },
      ...(body === null ? {} : { body: JSON.stringify(body) }),
      signal: timeoutSignal(),
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
export async function deliverSms({ mobile, text, fetchImpl = globalThis.fetch }) {
  const result = await deliverSmsBulk({ mobiles: [mobile], text, fetchImpl });
  if (!result.ok) return result;
  return {
    ok: true,
    providerMessageId: result.providerMessageIds?.[0] ?? null,
    packId: result.packId ?? null,
    cost: result.cost ?? null,
  };
}

/** Bulk send (sms.ir accepts at most 100 mobiles per request). */
export async function deliverSmsBulk({ mobiles, text, fetchImpl = globalThis.fetch }) {
  const unique = [...new Set((mobiles ?? []).map((mobile) => String(mobile).trim()).filter(Boolean))];
  if (unique.length === 0) return { ok: false, error: 'شمارهٔ گیرنده‌ای ارسال نشده است' };
  if (unique.length > 100) return { ok: false, error: 'sms.ir حداکثر ۱۰۰ شماره در هر درخواست می‌پذیرد' };
  if (!config.sms.enabled) return { ok: false, queued: true, reason: 'SMS_NOT_CONFIGURED' };

  const result = await smsRequest('/v1/send/bulk', {
    method: 'POST',
    body: {
      lineNumber: Number(config.sms.lineNumber),
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
export async function fetchSmsCredit({ fetchImpl = globalThis.fetch } = {}) {
  if (!config.sms.enabled) return { ok: false, configured: false, reason: 'SMS_NOT_CONFIGURED' };
  const result = await smsRequest('/v1/credit', { fetchImpl });
  if (!result.ok) return { ...result, configured: true };
  const data = result.data;
  const credit = typeof data === 'number' ? data : Number(data?.credit ?? data?.remainingCredit ?? NaN);
  return { ok: true, configured: true, credit: Number.isFinite(credit) ? credit : null, raw: data };
}

/** Active lines from `GET /v1/line`. */
export async function fetchSmsLines({ fetchImpl = globalThis.fetch } = {}) {
  if (!config.sms.enabled) return { ok: false, configured: false, reason: 'SMS_NOT_CONFIGURED' };
  const result = await smsRequest('/v1/line', { fetchImpl });
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

/** Re-sends one failed/queued league report message. */
export async function retryOutboxMessage(db, id, { fetchImpl = globalThis.fetch } = {}) {
  const row = db.prepare('SELECT * FROM sms_messages WHERE id = ?').get(id);
  if (!row) return null;
  const result = await deliverSms({ mobile: row.mobile, text: row.body, fetchImpl });
  if (result.ok) {
    markMessage(db, row.id, { status: 'sent', providerMessageId: result.providerMessageId });
  } else {
    markMessage(db, row.id, { status: 'failed', error: result.error ?? result.reason ?? 'ارسال ناموفق' });
  }
  return { id: row.id, delivery: result };
}

/** Re-sends one admin campaign message. */
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
