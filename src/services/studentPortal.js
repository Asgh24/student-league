import { notFound } from '../lib/errors.js';
import { config } from '../config.js';
import { getColumns, readSettings } from '../repositories/leagues.js';
import { studentAttendance } from './attendance.js';
import {
  championshipCount,
  championshipsFor,
  columnValues,
  historyCount,
  rankingForLeague,
  studentHistory,
  studentRank,
  titleForPoints,
} from './scoring.js';
import { studentTeam } from './teams.js';
import { seatForStudent } from './seating.js';

/** Resolves the student row (and league) for a logged in student account. */
export function studentContext(db, userId) {
  const row = db.prepare(`
    SELECT s.id, s.name, s.league_id AS leagueId, s.created_at AS createdAt,
           l.name AS leagueName, l.status AS leagueStatus, l.teacher_id AS teacherId
    FROM students s JOIN leagues l ON l.id = s.league_id
    WHERE s.user_id = ?
  `).get(userId);
  return row ?? null;
}

export function requireStudentContext(db, userId) {
  const context = studentContext(db, userId);
  if (!context) throw notFound('برای حساب شما دانش‌آموزی ثبت نشده است');
  return context;
}

/** Cumulative point series used by the student chart. */
export function pointsSeries(db, studentId) {
  const rows = db.prepare(`
    SELECT id, delta, total_after AS totalAfter, column_name AS columnName, reason, created_at AS createdAt
    FROM score_history WHERE student_id = ? ORDER BY id ASC
  `).all(studentId);
  if (rows.length === 0) return { start: 0, points: [] };
  const start = rows[0].totalAfter - rows[0].delta;
  return {
    start,
    points: rows.map((row) => ({
      id: row.id,
      delta: row.delta,
      total: row.totalAfter,
      columnName: row.columnName,
      reason: row.reason,
      createdAt: row.createdAt,
    })),
  };
}

export function dashboard(db, student) {
  const { rank, totalStudents, total } = studentRank(db, student.leagueId, student.id);
  const medals = championshipsFor(db, student.id);
  const league = db.prepare('SELECT status, name, created_at AS createdAt FROM leagues WHERE id = ?').get(student.leagueId);
  const settings = db.prepare('SELECT 1 AS ok').get();
  void settings;
  const completed = league?.status === 'completed' ? 1 : 0;
  const team = studentTeam(db, student.leagueId, student.id);
  const { start, points } = pointsSeries(db, student.id);
  const title = titleForPoints(total);

  return {
    studentId: student.id,
    name: student.name,
    leagueId: student.leagueId,
    leagueName: league?.name ?? student.leagueName,
    leagueStatus: league?.status ?? 'active',
    points: total,
    rank,
    totalStudents,
    championships: medals.length,
    completedLeagues: completed,
    title,
    bestChampionship: medals[0]?.title ?? null,
    medals: medals.slice(0, 6),
    team: team ? { id: team.id, name: team.name, rank: team.rank, members: team.members.length } : null,
    seat: seatForStudent(db, student.id),
    series: { start, points },
  };
}

/**
 * Derives a qualitative label for a recorded change from its size relative to
 * the column's step (the usual point value of that subject). Negative changes
 * are reported as such instead of being rated.
 */
export function qualityFor(delta, step) {
  const value = Number(delta) || 0;
  if (value < 0) return { key: 'negative', label: 'کسر امتیاز', icon: '⚠️' };
  if (value === 0) return { key: 'none', label: 'بدون امتیاز', icon: '➖' };
  const size = Math.max(1, Number(step) || 1);
  const ratio = value / size;
  if (ratio >= 2) return { key: 'excellent', label: 'عالی', icon: '🌟' };
  if (ratio >= 1) return { key: 'very-good', label: 'خیلی خوب', icon: '💎' };
  if (ratio >= 0.5) return { key: 'good', label: 'خوب', icon: '👍' };
  return { key: 'fair', label: 'قابل قبول', icon: '🙂' };
}

/** UTC instant of the start of a local (league timezone) calendar day. */
function startOfLocalDay(isoDate, offsetMinutes) {
  return new Date(Date.parse(`${isoDate}T00:00:00.000Z`) - offsetMinutes * 60000).toISOString();
}

/** UTC instant of the end of a local (league timezone) calendar day. */
function endOfLocalDay(isoDate, offsetMinutes) {
  return new Date(Date.parse(`${isoDate}T00:00:00.000Z`) + 86400000 - offsetMinutes * 60000 - 1).toISOString();
}

/**
 * Report card: the per-column totals (kept for the table and chart) plus the
 * individual score "sessions" the student can read like a term report - each
 * entry shows its subject, the teacher's topic/reason, the date, the awarded
 * points and a derived quality label. Filters: subject, Gregorian date range.
 */
export function reportCard(db, student, { columnId = null, from = null, to = null, limit = 200 } = {}) {
  const columns = getColumns(db, student.leagueId);
  const values = new Map(columnValues(db, student.id).map((row) => [row.columnId, row.value]));
  const items = columns.map((column) => ({
    columnId: column.id,
    name: column.name,
    step: column.step,
    value: values.get(column.id) ?? 0,
  }));
  const total = items.reduce((acc, item) => acc + item.value, 0);
  const { rank, totalStudents } = studentRank(db, student.leagueId, student.id);
  const settings = readSettings(db, student.leagueId);
  const offset = config.tzOffsetMinutes;

  const where = ['student_id = ?'];
  const params = [student.id];
  if (Number.isFinite(columnId)) {
    where.push('column_id = ?');
    params.push(columnId);
  }
  if (from) {
    where.push('created_at >= ?');
    params.push(startOfLocalDay(from, offset));
  }
  if (to) {
    where.push('created_at <= ?');
    params.push(endOfLocalDay(to, offset));
  }

  const rows = db.prepare(`
    SELECT id, column_id AS columnId, column_name AS columnName, delta, reason,
           actor_name AS actorName, total_after AS totalAfter, created_at AS createdAt
    FROM score_history
    WHERE ${where.join(' AND ')}
    ORDER BY id DESC
    LIMIT ?
  `).all(...params, limit);

  const stepById = new Map(columns.map((column) => [column.id, column.step]));
  const sessions = rows.map((row) => ({
    id: row.id,
    columnId: row.columnId,
    columnName: row.columnName,
    topic: row.reason ?? '',
    delta: row.delta,
    actorName: row.actorName ?? '',
    totalAfter: row.totalAfter,
    createdAt: row.createdAt,
    quality: qualityFor(row.delta, stepById.get(row.columnId) ?? 25),
  }));

  return {
    studentId: student.id,
    name: student.name,
    leagueId: student.leagueId,
    leagueName: student.leagueName,
    grade: settings.grade ?? '',
    items,
    total,
    rank,
    totalStudents,
    title: titleForPoints(total),
    columns: columns.map((column) => ({ id: column.id, name: column.name, step: column.step })),
    filters: { columnId: Number.isFinite(columnId) ? columnId : null, from: from ?? null, to: to ?? null, limit },
    sessions,
    sessionCount: sessions.length,
  };
}

export function myAttendance(db, student, options) {
  return studentAttendance(db, student.id, options);
}

export function myTeam(db, student) {
  const team = studentTeam(db, student.leagueId, student.id);
  if (!team) {
    return { team: null, members: [], rank: null, totalTeams: 0 };
  }
  const standings = teamStandingsSafe(db, student.leagueId);
  return {
    team: { id: team.id, name: team.name, label: team.label, finalPoints: team.finalPoints, memberAverage: team.memberAverage, basePoints: team.basePoints },
    members: team.members.map((member) => ({ studentId: member.studentId, name: member.name })),
    rank: team.rank,
    totalTeams: standings,
  };
}

function teamStandingsSafe(db, leagueId) {
  return db.prepare('SELECT COUNT(*) AS n FROM teams WHERE league_id = ?').get(leagueId).n;
}

export function myHistory(db, student, { limit = 50, offset = 0 } = {}) {
  return {
    items: studentHistory(db, student.id, { limit, offset }),
    total: historyCount(db, student.id),
    series: pointsSeries(db, student.id),
  };
}

/** League leaderboard: names, points and rank only - no private data. */
export function leagueLeaderboard(db, student) {
  const ranking = rankingForLeague(db, student.leagueId);
  return {
    leagueId: student.leagueId,
    total: ranking.length,
    items: ranking.map((row) => ({
      studentId: row.studentId,
      name: row.name,
      total: row.total,
      rank: row.rank,
      isMe: row.studentId === student.id,
      title: titleForPoints(row.total).title,
    })),
  };
}

export function myMedals(db, student) {
  const medals = championshipsFor(db, student.id);
  const counts = championshipCount(db, student.leagueId).get(student.id) ?? 0;
  return { total: counts, items: medals, currentTitle: titleForPoints(studentRank(db, student.leagueId, student.id).total) };
}
