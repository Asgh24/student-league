import { isoNow } from '../lib/http.js';

/** Daily discipline sheet: independent of attendance and scores. */
export const DISCIPLINE_STATUSES = ['orderly', 'disorderly'];

export const DISCIPLINE_LABELS = {
  orderly: 'منظم',
  disorderly: 'بی‌نظمی',
};

export const DISCIPLINE_KIND = {
  orderly: 'ok',
  disorderly: 'bad',
};

const MAX_NOTE_LENGTH = 500;

/** Current entry (status + note) for each student on a given day. */
export function dayDiscipline(db, leagueId, day) {
  const rows = db.prepare(`
    SELECT student_id AS studentId, status, note
    FROM discipline
    WHERE league_id = ? AND day = ?
  `).all(leagueId, day);
  return new Map(rows.map((row) => [row.studentId, { status: row.status, note: row.note ?? '' }]));
}

/** One row per student with the current status, note and league-wide ratio. */
export function disciplineSheet(db, leagueId, day) {
  const students = db.prepare('SELECT id, name FROM students WHERE league_id = ?').all(leagueId);
  const current = dayDiscipline(db, leagueId, day);
  const ratios = db.prepare(`
    SELECT student_id AS studentId, COUNT(*) AS recorded,
           SUM(CASE WHEN status = 'orderly' THEN 1 ELSE 0 END) AS orderly,
           SUM(CASE WHEN status = 'disorderly' THEN 1 ELSE 0 END) AS disorderly
    FROM discipline WHERE league_id = ? GROUP BY student_id
  `).all(leagueId);
  const ratioMap = new Map(ratios.map((row) => [row.studentId, row]));

  return students.map((student) => {
    const entry = current.get(student.id) ?? { status: null, note: '' };
    const ratio = ratioMap.get(student.id) ?? { orderly: 0, disorderly: 0, recorded: 0 };
    return {
      studentId: student.id,
      name: student.name,
      status: entry.status,
      note: entry.note,
      orderly: ratio.orderly ?? 0,
      disorderly: ratio.disorderly ?? 0,
      recorded: ratio.recorded ?? 0,
    };
  });
}

export function todayCounters(db, leagueId, day) {
  const rows = db.prepare('SELECT status, COUNT(*) AS n FROM discipline WHERE league_id = ? AND day = ? GROUP BY status')
    .all(leagueId, day);
  const counters = { orderly: 0, disorderly: 0 };
  for (const row of rows) counters[row.status] = row.n;
  const total = db.prepare('SELECT COUNT(*) AS n FROM students WHERE league_id = ?').get(leagueId).n;
  counters.total = total;
  counters.unmarked = Math.max(0, total - counters.orderly - counters.disorderly);
  return counters;
}

function cleanNote(value) {
  return String(value ?? '').trim().slice(0, MAX_NOTE_LENGTH);
}

/**
 * Saves one day's discipline entries.
 *
 * Each record may contain only `status` (the row buttons), only `note` (the
 * reason field) or both. Omitting a field keeps the stored value; sending
 * `status: null` clears the entry. A student without an existing row and a
 * missing status is ignored, so typing a reason before choosing a status never
 * creates a half-filled record.
 */
export function setDiscipline(db, { leagueId, day, records, actor = null }) {
  const run = db.transaction(() => {
    const studentStmt = db.prepare('SELECT id FROM students WHERE id = ? AND league_id = ?');
    const existingStmt = db.prepare('SELECT status, note FROM discipline WHERE student_id = ? AND day = ?');
    const upsert = db.prepare(`
      INSERT INTO discipline (league_id, student_id, day, status, note, actor_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (student_id, day) DO UPDATE SET
        status = excluded.status,
        note = excluded.note,
        actor_id = excluded.actor_id,
        updated_at = excluded.updated_at
    `);
    const remove = db.prepare('DELETE FROM discipline WHERE student_id = ? AND day = ?');
    let applied = 0;

    for (const record of records) {
      const student = studentStmt.get(record.studentId, leagueId);
      if (!student) continue;

      const existing = existingStmt.get(student.id, day) ?? null;
      const status = record.status === undefined ? (existing?.status ?? null) : record.status;
      const note = record.note === undefined ? (existing?.note ?? '') : cleanNote(record.note);

      if (!status) {
        if (record.status === null && existing) {
          remove.run(student.id, day);
          applied += 1;
        }
        continue;
      }

      const now = isoNow();
      upsert.run(leagueId, student.id, day, status, note, actor?.id ?? null, now, now);
      applied += 1;
    }

    return { day, applied, counters: todayCounters(db, leagueId, day) };
  });
  return run();
}

export function bulkSetDiscipline(db, { leagueId, day, status, actor = null }) {
  const students = db.prepare('SELECT id FROM students WHERE league_id = ?').all(leagueId);
  return setDiscipline(db, {
    leagueId,
    day,
    records: students.map((student) => ({ studentId: student.id, status })),
    actor,
  });
}

export function leagueHistory(db, leagueId, { limit = 50, offset = 0 } = {}) {
  const days = db.prepare(`
    SELECT day,
           SUM(CASE WHEN status = 'orderly' THEN 1 ELSE 0 END) AS orderly,
           SUM(CASE WHEN status = 'disorderly' THEN 1 ELSE 0 END) AS disorderly,
           COUNT(*) AS total
    FROM discipline WHERE league_id = ?
    GROUP BY day ORDER BY day DESC LIMIT ? OFFSET ?
  `).all(leagueId, limit, offset);
  const count = db.prepare('SELECT COUNT(DISTINCT day) AS n FROM discipline WHERE league_id = ?').get(leagueId).n;
  return { items: days, total: count };
}

/** Personal discipline history used by the student portal. */
export function studentDiscipline(db, studentId, { limit = 100, offset = 0 } = {}) {
  const items = db.prepare(`
    SELECT day, status, note, updated_at AS updatedAt
    FROM discipline WHERE student_id = ? ORDER BY day DESC LIMIT ? OFFSET ?
  `).all(studentId, limit, offset);
  const total = db.prepare('SELECT COUNT(*) AS n FROM discipline WHERE student_id = ?').get(studentId).n;
  const summary = db.prepare(`
    SELECT COUNT(*) AS recorded,
           SUM(CASE WHEN status = 'orderly' THEN 1 ELSE 0 END) AS orderly,
           SUM(CASE WHEN status = 'disorderly' THEN 1 ELSE 0 END) AS disorderly
    FROM discipline WHERE student_id = ?
  `).get(studentId);
  return {
    items,
    total,
    summary: {
      recorded: summary.recorded ?? 0,
      orderly: summary.orderly ?? 0,
      disorderly: summary.disorderly ?? 0,
    },
  };
}
