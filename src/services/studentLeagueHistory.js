/**
 * Read-only view of the leagues a student has been part of. The login follows
 * the durable profile across league transfers, so the old memberships keep
 * their scores and final ranking even though the account now points at a new
 * league row (see studentRoster.js).
 */

import { notFound } from '../lib/errors.js';
import { listPublishedReportCards } from './reports.js';
import { rankingForLeague, studentRank, titleForPoints } from './scoring.js';
import { reportCard } from './studentPortal.js';

function membershipsFor(db, userId) {
  return db.prepare(`
    SELECT s.id AS studentId, s.name AS studentName, s.league_id AS leagueId,
           l.name AS leagueName, l.status AS leagueStatus,
           l.created_at AS leagueCreatedAt, l.completed_at AS completedAt,
           (s.user_id = ?) AS isCurrent
    FROM students s
    JOIN leagues l ON l.id = s.league_id
    LEFT JOIN student_profiles p ON p.id = s.profile_id
    WHERE p.user_id = ? OR s.user_id = ?
    ORDER BY l.id DESC
  `).all(userId, userId, userId);
}

export function listStudentLeagues(db, userId) {
  const items = membershipsFor(db, userId).map((row) => {
    const { rank, totalStudents, total } = studentRank(db, row.leagueId, row.studentId);
    return {
      studentId: row.studentId,
      leagueId: row.leagueId,
      leagueName: row.leagueName,
      leagueStatus: row.leagueStatus,
      leagueCreatedAt: row.leagueCreatedAt,
      completedAt: row.completedAt,
      isCurrent: Boolean(row.isCurrent),
      rank,
      totalStudents,
      total,
    };
  });
  return { items };
}

function finalRanking(db, leagueId, raw) {
  if (raw) {
    try {
      const rows = JSON.parse(raw);
      if (Array.isArray(rows)) return rows;
    } catch {
      /* fall back to the live ranking below */
    }
  }
  return rankingForLeague(db, leagueId);
}

export function studentLeagueResult(db, userId, leagueId) {
  const membership = membershipsFor(db, userId).find((row) => row.leagueId === leagueId);
  if (!membership) throw notFound('لیگ یافت نشد');

  const league = db.prepare(`
    SELECT name, status, completed_at AS completedAt, final_ranking AS finalRanking
    FROM leagues WHERE id = ?
  `).get(leagueId);
  const card = reportCard(db, {
    id: membership.studentId,
    name: membership.studentName,
    leagueId,
    leagueName: league?.name ?? membership.leagueName,
  });
  const ranking = finalRanking(db, leagueId, league?.finalRanking).map((row) => ({
    studentId: row.studentId,
    name: row.name,
    total: row.total,
    rank: row.rank,
    isMe: row.studentId === membership.studentId,
    title: titleForPoints(row.total).title,
  }));
  const medals = db.prepare(`
    SELECT id, title, rank, source, created_at AS createdAt
    FROM championships WHERE student_id = ? AND league_id = ? ORDER BY id DESC
  `).all(membership.studentId, leagueId);

  return {
    ...card,
    leagueStatus: league?.status ?? membership.leagueStatus,
    completedAt: league?.completedAt ?? null,
    isCurrent: Boolean(membership.isCurrent),
    ranking,
    medals,
    reportCards: listPublishedReportCards(db, leagueId, membership.studentId),
  };
}
