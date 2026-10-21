/**
 * Condensed daily report for parents: the score changes of one local day,
 * grouped per student, plus delivery through sms.ir (or the local outbox when
 * the provider is not configured).
 */

import { config } from '../config.js';
import { badRequest } from '../lib/errors.js';
import { formatJalaliDate } from '../lib/jalali.js';
import { toPersianDigits } from '../lib/normalize.js';
import { getLeague } from '../repositories/leagues.js';
import { contactsList } from './contacts.js';
import { deliverSms, markMessage, queueMessage, recentMessages, smsConfig } from './sms.js';

/** UTC window of one local (league timezone) calendar day. */
function localDayWindow(date) {
  const [year, month, day] = String(date).split('-').map(Number);
  const start = Date.UTC(year, month - 1, day) - config.tzOffsetMinutes * 60 * 1000;
  return { start: new Date(start).toISOString(), end: new Date(start + 86400000).toISOString() };
}

function signedFa(value) {
  const number = Number(value) || 0;
  if (number === 0) return toPersianDigits(0);
  return `${number > 0 ? '+' : '-'}${toPersianDigits(Math.abs(number))}`;
}

export const MAX_REPORT_LINES = 4;

/** Builds the SMS text of one student's day (exported for tests). */
export function buildDailyMessage({ leagueName, studentName, date, lines = [], totalDelta = 0 }) {
  const dateText = formatJalaliDate(date);
  const breakdown = [...lines]
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, MAX_REPORT_LINES)
    .map((line) => `${line.columnName} ${signedFa(line.delta)}`);
  if (lines.length > MAX_REPORT_LINES) breakdown.push(`و ${toPersianDigits(lines.length - MAX_REPORT_LINES)} مورد دیگر`);
  const detail = breakdown.length ? breakdown.join('، ') : 'امروز تغییری ثبت نشده است';
  return `${leagueName} | گزارش روزانه ${dateText}\n${studentName}: ${detail}\nجمع تغییرات: ${signedFa(totalDelta)}`;
}

/** Daily score changes per student, with the exact message that would be sent. */
export function dailyReport(db, leagueId, date) {
  const league = getLeague(db, leagueId);
  if (!league) throw badRequest('LEAGUE_NOT_FOUND', 'لیگ یافت نشد');
  const { start, end } = localDayWindow(date);

  const grouped = db.prepare(`
    SELECT h.student_id AS studentId, h.column_name AS columnName,
           SUM(h.delta) AS delta, COUNT(*) AS changes
    FROM score_history h
    WHERE h.league_id = ? AND h.created_at >= ? AND h.created_at < ?
    GROUP BY h.student_id, h.column_name
    ORDER BY h.student_id ASC, h.column_name ASC
  `).all(leagueId, start, end);

  const byStudent = new Map();
  for (const row of grouped) {
    if (!byStudent.has(row.studentId)) byStudent.set(row.studentId, []);
    byStudent.get(row.studentId).push({ columnName: row.columnName, delta: row.delta, changes: row.changes });
  }

  const contacts = new Map(contactsList(db, leagueId).map((row) => [row.id, row]));
  const items = [];
  for (const contact of contacts.values()) {
    const lines = byStudent.get(contact.id) ?? [];
    const totalDelta = lines.reduce((sum, line) => sum + line.delta, 0);
    const changes = lines.reduce((sum, line) => sum + line.changes, 0);
    items.push({
      studentId: contact.id,
      name: contact.name,
      parentPhone: contact.parentPhone,
      studentPhone: contact.studentPhone,
      hasParentPhone: contact.hasParentPhone,
      totalDelta,
      changes,
      lines,
      message: buildDailyMessage({ leagueName: league.name, studentName: contact.name, date, lines, totalDelta }),
    });
  }

  const messages = recentMessages(db, leagueId, { reportDate: date, limit: 50 });
  return {
    date,
    league: { id: league.id, name: league.name },
    items,
    summary: {
      students: items.length,
      changed: items.filter((item) => item.changes > 0).length,
      withoutParentPhone: items.filter((item) => !item.hasParentPhone).length,
      sent: messages.filter((message) => message.status === 'sent').length,
      queued: messages.filter((message) => message.status === 'queued').length,
      failed: messages.filter((message) => message.status === 'failed').length,
    },
    sms: smsConfig(),
    recent: messages.slice(0, 25),
  };
}

/**
 * Sends the report of the selected students to their parents. Students without
 * a parent number are reported as skipped; a provider failure leaves the row
 * in the outbox with status `failed` so it can be retried from the UI later.
 */
export async function sendDailyReports(db, { leagueId, date, studentIds, fetchImpl }) {
  const report = dailyReport(db, leagueId, date);
  const selected = new Set(studentIds);
  const chosen = report.items.filter((item) => selected.has(item.studentId));
  if (chosen.length === 0) throw badRequest('NO_STUDENTS', 'هیچ دانش‌آموزی برای ارسال انتخاب نشده است');

  const results = [];
  for (const item of chosen) {
    if (!item.hasParentPhone) {
      results.push({ studentId: item.studentId, name: item.name, status: 'skipped', reason: 'NO_PARENT_PHONE', message: item.message });
      continue;
    }
    const messageId = queueMessage(db, {
      leagueId,
      studentId: item.studentId,
      mobile: item.parentPhone,
      body: item.message,
      kind: 'daily_report',
      reportDate: date,
    });
    const outcome = await deliverSms({ mobile: item.parentPhone, text: item.message, fetchImpl });
    if (outcome.ok) {
      markMessage(db, messageId, { status: 'sent', providerMessageId: outcome.providerMessageId });
      results.push({ studentId: item.studentId, name: item.name, status: 'sent', messageId, message: item.message });
    } else if (outcome.queued) {
      results.push({ studentId: item.studentId, name: item.name, status: 'queued', messageId, message: item.message });
    } else {
      markMessage(db, messageId, { status: 'failed', error: outcome.error });
      results.push({ studentId: item.studentId, name: item.name, status: 'failed', messageId, error: outcome.error, message: item.message });
    }
  }

  const counts = { sent: 0, queued: 0, failed: 0, skipped: 0 };
  for (const result of results) counts[result.status] += 1;

  const fresh = dailyReport(db, leagueId, date);
  return { ...fresh, results, counts, smsConfigured: fresh.sms.configured };
}

export { localDayWindow };
