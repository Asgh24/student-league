import { badRequest, notFound } from '../lib/errors.js';
import { isoNow } from '../lib/http.js';
import { compareNames } from '../lib/normalize.js';

const TITLE_LADDER = [
  { min: 2000, title: 'شاهنشاه', icon: '👑' },
  { min: 1500, title: 'امپراتور', icon: '🏛️' },
  { min: 1000, title: 'پادشاه', icon: '🤴' },
  { min: 700, title: 'شاهزاده', icon: '🎖️' },
  { min: 400, title: 'سردار', icon: '⚔️' },
  { min: 200, title: 'فرمانده', icon: '🛡️' },
  { min: 50, title: 'جنگجو', icon: '🗡️' },
  { min: -Infinity, title: 'نوآموز', icon: '🌱' },
];

export function titleForPoints(total) {
  const found = TITLE_LADDER.find((tier) => total >= tier.min);
  return { title: found.title, icon: found.icon };
}

export function studentTotal(db, studentId) {
  const row = db.prepare('SELECT COALESCE(SUM(value), 0) AS total FROM scores WHERE student_id = ?').get(studentId);
  return row?.total ?? 0;
}

export function totalsForLeague(db, leagueId) {
  const rows = db.prepare(`
    SELECT s.id AS studentId, COALESCE(SUM(sc.value), 0) AS total
    FROM students s
    LEFT JOIN scores sc ON sc.student_id = s.id
    WHERE s.league_id = ?
    GROUP BY s.id
  `).all(leagueId);
  return new Map(rows.map((r) => [r.studentId, r.total]));
}

/**
 * Leaderboard ordered by total (desc) with ties broken by Persian-aware name
 * comparison. Tied totals share a competition rank (1, 2, 2, 4).
 */
export function rankingForLeague(db, leagueId) {
  const rows = db.prepare(`
    SELECT s.id AS studentId, s.name AS name, COALESCE(SUM(sc.value), 0) AS total
    FROM students s
    LEFT JOIN scores sc ON sc.student_id = s.id
    WHERE s.league_id = ?
    GROUP BY s.id
  `).all(leagueId);

  rows.sort((a, b) => (b.total - a.total) || compareNames(a.name, b.name));

  let rank = 0;
  let previousTotal = null;
  rows.forEach((row, index) => {
    if (previousTotal === null || row.total !== previousTotal) {
      rank = index + 1;
      previousTotal = row.total;
    }
    row.rank = rank;
  });
  return rows;
}

export function studentRank(db, leagueId, studentId) {
  const ranking = rankingForLeague(db, leagueId);
  const index = ranking.findIndex((r) => r.studentId === studentId);
  if (index === -1) return { rank: null, totalStudents: ranking.length, total: 0 };
  return { rank: ranking[index].rank, totalStudents: ranking.length, total: ranking[index].total };
}

/**
 * Applies a single delta to a student/column pair and appends a history row.
 * Must be called inside an outer transaction when batching.
 */
export function applyScoreDelta(db, { leagueId, student, column, delta, reason = '', actor = null }) {
  const now = isoNow();
  db.prepare(`
    INSERT INTO scores (league_id, student_id, column_id, value, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (student_id, column_id)
    DO UPDATE SET value = scores.value + excluded.value, updated_at = excluded.updated_at
  `).run(leagueId, student.id, column.id, delta, now);

  const totalAfter = studentTotal(db, student.id);
  db.prepare(`
    INSERT INTO score_history
      (league_id, student_id, column_id, column_name, delta, reason, actor_id, actor_name, total_after, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    leagueId,
    student.id,
    column.id,
    column.name,
    delta,
    reason,
    actor?.id ?? null,
    actor?.displayName ?? actor?.display_name ?? '',
    totalAfter,
    now,
  );
  return totalAfter;
}

function requireStudent(db, leagueId, studentId) {
  const student = db.prepare('SELECT * FROM students WHERE id = ? AND league_id = ?').get(studentId, leagueId);
  if (!student) throw notFound('دانش‌آموز در این لیگ یافت نشد');
  return student;
}

/** Commits many column deltas for one student atomically (all or nothing). */
export function commitScoreChanges(db, { leagueId, studentId, changes, reason = '', actor = null }) {
  const run = db.transaction(() => {
    const student = requireStudent(db, leagueId, studentId);
    const effective = changes.filter((c) => Number.isFinite(c.delta) && c.delta !== 0);
    for (const change of effective) {
      const column = db.prepare('SELECT * FROM columns WHERE id = ? AND league_id = ?').get(change.columnId, leagueId);
      if (!column) throw badRequest('COLUMN_NOT_FOUND', 'ستون امتیاز یافت نشد');
      applyScoreDelta(db, { leagueId, student, column, delta: change.delta, reason, actor });
    }
    return { studentId: student.id, total: studentTotal(db, student.id), applied: effective.length };
  });
  return run();
}

export function recordScoreChange(db, { leagueId, studentId, columnId, delta, reason = '', actor = null }) {
  const run = db.transaction(() => {
    const student = requireStudent(db, leagueId, studentId);
    const column = db.prepare('SELECT * FROM columns WHERE id = ? AND league_id = ?').get(columnId, leagueId);
    if (!column) throw badRequest('COLUMN_NOT_FOUND', 'ستون امتیاز یافت نشد');
    const total = applyScoreDelta(db, { leagueId, student, column, delta, reason, actor });
    return { studentId: student.id, total, applied: 1 };
  });
  return run();
}

export function studentHistory(db, studentId, { limit = 100, offset = 0 } = {}) {
  return db.prepare(`
    SELECT id, column_id AS columnId, column_name AS columnName, delta, reason,
           actor_name AS actorName, total_after AS totalAfter, created_at AS createdAt
    FROM score_history
    WHERE student_id = ?
    ORDER BY id DESC
    LIMIT ? OFFSET ?
  `).all(studentId, limit, offset);
}

export function historyCount(db, studentId) {
  return db.prepare('SELECT COUNT(*) AS n FROM score_history WHERE student_id = ?').get(studentId).n;
}

export function columnValues(db, studentId) {
  return db.prepare('SELECT column_id AS columnId, value FROM scores WHERE student_id = ?').all(studentId);
}

export function addChampionship(db, { leagueId, studentId, title = 'قهرمانی', rank = 1, source = 'manual' }) {
  const student = requireStudent(db, leagueId, studentId);
  const info = db.prepare('INSERT INTO championships (league_id, student_id, title, rank, source, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(leagueId, student.id, title, rank, source, isoNow());
  return db.prepare('SELECT * FROM championships WHERE id = ?').get(info.lastInsertRowid);
}

export function removeChampionship(db, { leagueId, studentId }) {
  const row = db.prepare('SELECT * FROM championships WHERE league_id = ? AND student_id = ? ORDER BY id DESC LIMIT 1').get(leagueId, studentId);
  if (!row) throw notFound('قهرمانی‌ای برای حذف وجود ندارد');
  db.prepare('DELETE FROM championships WHERE id = ?').run(row.id);
  return row;
}

export function championshipsFor(db, studentId, limit = 50) {
  return db.prepare('SELECT id, title, rank, source, created_at AS createdAt FROM championships WHERE student_id = ? ORDER BY id DESC LIMIT ?')
    .all(studentId, limit);
}

export function championshipCount(db, leagueId) {
  const rows = db.prepare('SELECT student_id AS studentId, COUNT(*) AS count FROM championships WHERE league_id = ? GROUP BY student_id').all(leagueId);
  return new Map(rows.map((r) => [r.studentId, r.count]));
}

/** Attendance ratio per student: attended (present + late) / recorded days. */
export function attendanceRatios(db, leagueId) {
  const rows = db.prepare(`
    SELECT student_id AS studentId,
           COUNT(*) AS recorded,
           SUM(CASE WHEN status IN ('present', 'late') THEN 1 ELSE 0 END) AS attended
    FROM attendance WHERE league_id = ? GROUP BY student_id
  `).all(leagueId);
  return new Map(rows.map((r) => [r.studentId, { attended: r.attended ?? 0, recorded: r.recorded ?? 0 }]));
}

/** Full table payload for the individual league page. */
export function scoresMatrix(db, leagueId) {
  const students = db.prepare('SELECT id, name, user_id AS userId, created_at AS createdAt FROM students WHERE league_id = ?').all(leagueId);
  const totals = totalsForLeague(db, leagueId);
  const ratios = attendanceRatios(db, leagueId);
  const medals = championshipCount(db, leagueId);
  const memberships = db.prepare(`
    SELECT tm.student_id AS studentId, t.id AS teamId, t.name AS teamName
    FROM team_members tm JOIN teams t ON t.id = tm.team_id
    WHERE t.league_id = ?
  `).all(leagueId);
  const teamByStudent = new Map(memberships.map((m) => [m.studentId, m]));

  const scoreRows = db.prepare('SELECT student_id AS studentId, column_id AS columnId, value FROM scores WHERE league_id = ?').all(leagueId);
  const scoreMap = new Map();
  for (const row of scoreRows) {
    if (!scoreMap.has(row.studentId)) scoreMap.set(row.studentId, {});
    scoreMap.get(row.studentId)[row.columnId] = row.value;
  }

  const enriched = students.map((student) => {
    const total = totals.get(student.id) ?? 0;
    const ratio = ratios.get(student.id) ?? { attended: 0, recorded: 0 };
    const team = teamByStudent.get(student.id) ?? null;
    return {
      id: student.id,
      name: student.name,
      hasLogin: student.userId !== null,
      scores: scoreMap.get(student.id) ?? {},
      total,
      attended: ratio.attended,
      recorded: ratio.recorded,
      championships: medals.get(student.id) ?? 0,
      title: titleForPoints(total),
      teamId: team?.teamId ?? null,
      teamName: team?.teamName ?? null,
    };
  });

  enriched.sort((a, b) => (b.total - a.total) || compareNames(a.name, b.name));
  let rank = 0;
  let previousTotal = null;
  enriched.forEach((row, index) => {
    if (previousTotal === null || row.total !== previousTotal) {
      rank = index + 1;
      previousTotal = row.total;
    }
    row.rank = rank;
  });
  return enriched;
}
