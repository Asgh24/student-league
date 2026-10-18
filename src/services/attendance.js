import { isoNow } from '../lib/http.js';
import { findDisciplineColumn, readSettings } from '../repositories/leagues.js';
import { applyScoreDelta } from './scoring.js';

export const ATTENDANCE_STATUSES = ['present', 'absent', 'late'];

export const STATUS_LABELS = {
  present: 'حاضر',
  absent: 'غایب',
  late: 'تأخیر',
};

/** Current status for each student on a given day. */
export function dayStatuses(db, leagueId, day) {
  const rows = db.prepare('SELECT student_id AS studentId, status FROM attendance WHERE league_id = ? AND day = ?').all(leagueId, day);
  return new Map(rows.map((r) => [r.studentId, r.status]));
}

export function attendanceSheet(db, leagueId, day) {
  const students = db.prepare('SELECT id, name FROM students WHERE league_id = ?').all(leagueId);
  const statuses = dayStatuses(db, leagueId, day);
  const ratios = db.prepare(`
    SELECT student_id AS studentId, COUNT(*) AS recorded,
           SUM(CASE WHEN status IN ('present', 'late') THEN 1 ELSE 0 END) AS attended
    FROM attendance WHERE league_id = ? GROUP BY student_id
  `).all(leagueId);
  const ratioMap = new Map(ratios.map((r) => [r.studentId, r]));

  return students.map((student) => {
    const ratio = ratioMap.get(student.id) ?? { attended: 0, recorded: 0 };
    return {
      studentId: student.id,
      name: student.name,
      status: statuses.get(student.id) ?? null,
      attended: ratio.attended ?? 0,
      recorded: ratio.recorded ?? 0,
    };
  });
}

export function todayCounters(db, leagueId, day) {
  const rows = db.prepare('SELECT status, COUNT(*) AS n FROM attendance WHERE league_id = ? AND day = ? GROUP BY status').all(leagueId, day);
  const counters = { present: 0, absent: 0, late: 0 };
  for (const row of rows) counters[row.status] = row.n;
  const total = db.prepare('SELECT COUNT(*) AS n FROM students WHERE league_id = ?').get(leagueId).n;
  counters.total = total;
  counters.unmarked = Math.max(0, total - counters.present - counters.absent - counters.late);
  return counters;
}

function penaltyFor(status, settings) {
  if (status === 'late') return settings.latePenalty || 0;
  if (status === 'absent') return settings.absentPenalty || 0;
  return 0;
}

/**
 * Records attendance for a day. When penalties are configured the difference
 * between the old and new penalty is applied to the discipline column, so
 * repeated edits stay idempotent.
 */
export function setAttendance(db, { leagueId, day, records, actor = null, applyPenalties = true }) {
  const run = db.transaction(() => {
    const settings = applyPenalties ? readSettings(db, leagueId) : null;
    const discipline = applyPenalties && (settings.latePenalty || settings.absentPenalty) ? findDisciplineColumn(db, leagueId) : null;
    const upsert = db.prepare(`
      INSERT INTO attendance (league_id, student_id, day, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (student_id, day) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at
    `);
    const previous = db.prepare('SELECT status FROM attendance WHERE student_id = ? AND day = ?');
    const studentStmt = db.prepare('SELECT * FROM students WHERE id = ? AND league_id = ?');
    let applied = 0;

    for (const record of records) {
      const student = studentStmt.get(record.studentId, leagueId);
      if (!student) continue;
      const before = previous.get(student.id, day)?.status ?? null;
      const now = isoNow();
      upsert.run(leagueId, student.id, day, record.status, now, now);
      applied += 1;

      if (discipline && before !== record.status) {
        const delta = penaltyFor(record.status, settings) - penaltyFor(before, settings);
        if (delta !== 0) {
          const label = STATUS_LABELS[record.status] ?? record.status;
          applyScoreDelta(db, {
            leagueId,
            student,
            column: discipline,
            delta,
            reason: `حضور و غیاب (${label}) - ${day}`,
            actor,
          });
        }
      }
    }
    return { day, applied, counters: todayCounters(db, leagueId, day) };
  });
  return run();
}

export function bulkSetAttendance(db, { leagueId, day, status, actor = null }) {
  const students = db.prepare('SELECT id FROM students WHERE league_id = ?').all(leagueId);
  return setAttendance(db, { leagueId, day, records: students.map((s) => ({ studentId: s.id, status })), actor });
}

export function leagueHistory(db, leagueId, { limit = 50, offset = 0 } = {}) {
  const days = db.prepare(`
    SELECT day,
           SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END) AS present,
           SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END) AS absent,
           SUM(CASE WHEN status = 'late' THEN 1 ELSE 0 END) AS late,
           COUNT(*) AS total
    FROM attendance WHERE league_id = ?
    GROUP BY day ORDER BY day DESC LIMIT ? OFFSET ?
  `).all(leagueId, limit, offset);
  const count = db.prepare('SELECT COUNT(DISTINCT day) AS n FROM attendance WHERE league_id = ?').get(leagueId).n;
  return { items: days, total: count };
}

export function studentAttendance(db, studentId, { limit = 100, offset = 0 } = {}) {
  const items = db.prepare('SELECT day, status, updated_at AS updatedAt FROM attendance WHERE student_id = ? ORDER BY day DESC LIMIT ? OFFSET ?')
    .all(studentId, limit, offset);
  const total = db.prepare('SELECT COUNT(*) AS n FROM attendance WHERE student_id = ?').get(studentId).n;
  const summary = db.prepare(`
    SELECT COUNT(*) AS recorded,
           SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END) AS present,
           SUM(CASE WHEN status = 'late' THEN 1 ELSE 0 END) AS late,
           SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END) AS absent
    FROM attendance WHERE student_id = ?
  `).get(studentId);
  return {
    items,
    total,
    summary: {
      recorded: summary.recorded ?? 0,
      present: summary.present ?? 0,
      late: summary.late ?? 0,
      absent: summary.absent ?? 0,
      attended: (summary.present ?? 0) + (summary.late ?? 0),
    },
  };
}
