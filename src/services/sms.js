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

/**
 * Sends one message through `POST /v1/send/bulk` (one recipient per call, so
 * every student report can have its own text).
 */
export async function deliverSms({ mobile, text, fetchImpl = globalThis.fetch }) {
  const sms = config.sms;
  if (!sms.enabled) {
    return { ok: false, queued: true, reason: 'SMS_NOT_CONFIGURED' };
  }
  let response;
  const timeoutSignal = globalThis.AbortSignal?.timeout?.(sms.timeoutMs);
  try {
    response = await fetchImpl(`${sms.baseUrl}/v1/send/bulk`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-API-KEY': sms.apiKey,
      },
      body: JSON.stringify({
        lineNumber: Number(sms.lineNumber),
        messageText: text,
        mobiles: [mobile],
        sendDateTime: null,
      }),
      signal: timeoutSignal,
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
      error: payload?.message ?? `sms.ir پاسخ ${response.status} داد`,
      providerStatus: payload?.status ?? null,
    };
  }

  return {
    ok: true,
    providerMessageId: payload?.data?.messageIds?.[0] ?? null,
    packId: payload?.data?.packId ?? null,
    cost: payload?.data?.cost ?? null,
  };
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
