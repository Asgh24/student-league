import { badRequest, notFound } from '../lib/errors.js';
import { isoNow } from '../lib/http.js';
import { compareNames } from '../lib/normalize.js';
import { readSettings } from '../repositories/leagues.js';
import { totalsForLeague } from './scoring.js';

/** Rounds half away from zero so team averages are stable for negative scores. */
export function roundHalfUp(value) {
  return Math.sign(value) * Math.round(Math.abs(value));
}

export function listTeams(db, leagueId) {
  return db.prepare('SELECT * FROM teams WHERE league_id = ? ORDER BY id ASC').all(leagueId);
}

export function membersByTeam(db, leagueId) {
  const rows = db.prepare(`
    SELECT tm.team_id AS teamId, tm.student_id AS studentId, s.name AS name
    FROM team_members tm
    JOIN teams t ON t.id = tm.team_id
    JOIN students s ON s.id = tm.student_id
    WHERE t.league_id = ?
    ORDER BY s.id ASC
  `).all(leagueId);
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.teamId)) map.set(row.teamId, []);
    map.get(row.teamId).push({ studentId: row.studentId, name: row.name });
  }
  return map;
}

/**
 * Team standings. When `individualAffectsTeam` is on, a team's final score is
 * its own match points plus the average of its members' individual totals.
 */
export function teamStandings(db, leagueId) {
  const settings = readSettings(db, leagueId);
  const totals = totalsForLeague(db, leagueId);
  const members = membersByTeam(db, leagueId);
  const teams = listTeams(db, leagueId);

  const rows = teams.map((team) => {
    const teamMembers = members.get(team.id) ?? [];
    const sum = teamMembers.reduce((acc, member) => acc + (totals.get(member.studentId) ?? 0), 0);
    const memberAverage = teamMembers.length ? roundHalfUp(sum / teamMembers.length) : 0;
    const finalPoints = team.points + (settings.individualAffectsTeam ? memberAverage : 0);
    return {
      id: team.id,
      name: team.name,
      label: team.label,
      basePoints: team.points,
      individualPoints: sum,
      memberAverage,
      memberCount: teamMembers.length,
      finalPoints,
      members: teamMembers,
    };
  });

  rows.sort((a, b) => (b.finalPoints - a.finalPoints) || compareNames(a.name, b.name));
  let rank = 0;
  let previous = null;
  rows.forEach((row, index) => {
    if (previous === null || row.finalPoints !== previous) {
      rank = index + 1;
      previous = row.finalPoints;
    }
    row.rank = rank;
  });

  return { individualAffectsTeam: settings.individualAffectsTeam, teams: rows };
}

export function unassignedStudents(db, leagueId) {
  const totals = totalsForLeague(db, leagueId);
  const rows = db.prepare(`
    SELECT s.id, s.name FROM students s
    WHERE s.league_id = ?
      AND NOT EXISTS (SELECT 1 FROM team_members tm WHERE tm.student_id = s.id)
    ORDER BY s.id ASC
  `).all(leagueId);
  return rows
    .map((row) => ({ studentId: row.id, name: row.name, total: totals.get(row.id) ?? 0 }))
    .sort((a, b) => compareNames(a.name, b.name));
}

export function createTeam(db, leagueId, { name, label = null }) {
  const exists = db.prepare('SELECT id FROM teams WHERE league_id = ? AND name = ?').get(leagueId, String(name).trim());
  if (exists) throw badRequest('TEAM_EXISTS', 'تیمی با این نام در این لیگ وجود دارد');
  const info = db.prepare('INSERT INTO teams (league_id, name, points, label, created_at) VALUES (?, ?, 0, ?, ?)')
    .run(leagueId, String(name).trim(), label, isoNow());
  return db.prepare('SELECT * FROM teams WHERE id = ?').get(info.lastInsertRowid);
}

export function requireTeam(db, teamId, leagueId) {
  const team = db.prepare('SELECT * FROM teams WHERE id = ? AND league_id = ?').get(teamId, leagueId);
  if (!team) throw notFound('تیم یافت نشد');
  return team;
}

export function updateTeam(db, teamId, { name, label }) {
  const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(teamId);
  if (!team) throw notFound('تیم یافت نشد');
  const nextName = name === undefined ? team.name : String(name).trim();
  if (nextName !== team.name) {
    const clash = db.prepare('SELECT id FROM teams WHERE league_id = ? AND name = ? AND id <> ?').get(team.league_id, nextName, teamId);
    if (clash) throw badRequest('TEAM_EXISTS', 'تیمی با این نام در این لیگ وجود دارد');
  }
  const nextLabel = label === undefined ? team.label : label;
  db.prepare('UPDATE teams SET name = ?, label = ? WHERE id = ?').run(nextName, nextLabel, teamId);
  return db.prepare('SELECT * FROM teams WHERE id = ?').get(teamId);
}

export function deleteTeam(db, teamId) {
  db.prepare('DELETE FROM teams WHERE id = ?').run(teamId);
}

export function adjustTeamPoints(db, { team, delta, reason = '', actor = null }) {
  const run = db.transaction(() => {
    db.prepare('UPDATE teams SET points = points + ? WHERE id = ?').run(delta, team.id);
    db.prepare('INSERT INTO team_points_adjustments (team_id, delta, reason, actor_id, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(team.id, delta, reason, actor?.id ?? null, isoNow());
    return db.prepare('SELECT * FROM teams WHERE id = ?').get(team.id);
  });
  return run();
}

export function teamAdjustmentHistory(db, teamId, { limit = 50 } = {}) {
  return db.prepare(`
    SELECT a.id, a.delta, a.reason, a.created_at AS createdAt, u.display_name AS actorName
    FROM team_points_adjustments a
    LEFT JOIN users u ON u.id = a.actor_id
    WHERE a.team_id = ?
    ORDER BY a.id DESC LIMIT ?
  `).all(teamId, limit);
}

export function assignMember(db, { leagueId, teamId, studentId }) {
  const student = db.prepare('SELECT * FROM students WHERE id = ? AND league_id = ?').get(studentId, leagueId);
  if (!student) throw notFound('دانش‌آموز در این لیگ یافت نشد');
  requireTeam(db, teamId, leagueId);
  db.prepare(`
    INSERT INTO team_members (team_id, student_id, created_at) VALUES (?, ?, ?)
    ON CONFLICT (student_id) DO UPDATE SET team_id = excluded.team_id
  `).run(teamId, studentId, isoNow());
  return membersByTeam(db, leagueId).get(teamId) ?? [];
}

export function removeMember(db, { leagueId, studentId }) {
  const student = db.prepare('SELECT id FROM students WHERE id = ? AND league_id = ?').get(studentId, leagueId);
  if (!student) throw notFound('دانش‌آموز در این لیگ یافت نشد');
  db.prepare('DELETE FROM team_members WHERE student_id = ?').run(studentId);
}

export function studentTeam(db, leagueId, studentId) {
  const membership = db.prepare(`
    SELECT t.id AS teamId FROM team_members tm JOIN teams t ON t.id = tm.team_id
    WHERE tm.student_id = ? AND t.league_id = ?
  `).get(studentId, leagueId);
  if (!membership) return null;
  const standings = teamStandings(db, leagueId);
  const team = standings.teams.find((t) => t.id === membership.teamId);
  return team ?? null;
}
