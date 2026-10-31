import { Router } from 'express';
import { badRequest, notFound } from '../lib/errors.js';
import { isoNow, todayIso } from '../lib/http.js';import { schemas, validate } from '../lib/validate.js';
import {
  completeLeague,
  createLeague,
  deleteLeague,
  getColumns,
  listLeagues,
  reactivateLeague,
  readSettings,
  renameLeague,
  requireLeague,
  writeSettings,
} from '../repositories/leagues.js';
import { requireTeacher, loadOwnedLeague, requirePermission, requireOwnerTeacher, teacherId } from '../middleware/auth.js';
import { rankingForLeague, titleForPoints } from '../services/scoring.js';
import { todayCounters } from '../services/attendance.js';
import { teamStandings } from '../services/teams.js';

function serializeSettings(settings) {
  return {
    individualAffectsTeam: settings.individualAffectsTeam,
    latePenalty: settings.latePenalty,
    absentPenalty: settings.absentPenalty,
    grade: settings.grade ?? '',
  };
}

function timerPayload(db, leagueId) {
  const row = db.prepare('SELECT ends_at AS endsAt, duration_seconds AS durationSeconds, updated_at AS updatedAt FROM timers WHERE league_id = ?').get(leagueId);
  if (!row) return { endsAt: null, durationSeconds: 0, remainingMs: 0, expired: false };
  const remainingMs = new Date(row.endsAt).getTime() - Date.now();
  return {
    endsAt: row.endsAt,
    durationSeconds: row.durationSeconds,
    updatedAt: row.updatedAt,
    remainingMs: Math.max(0, remainingMs),
    expired: remainingMs <= 0,
  };
}

function summaryFor(db, league) {
  const counters = todayCounters(db, league.id, todayIso());
  const average = db.prepare('SELECT AVG(total) AS avg FROM (SELECT COALESCE(SUM(value), 0) AS total FROM scores WHERE league_id = ? GROUP BY student_id)')
    .get(league.id)?.avg ?? 0;
  const teams = db.prepare('SELECT COUNT(*) AS n FROM teams WHERE league_id = ?').get(league.id).n;
  const studentCount = db.prepare('SELECT COUNT(*) AS n FROM students WHERE league_id = ?').get(league.id).n;
  return {
    studentCount,
    presentToday: counters.present,
    absentToday: counters.absent,
    lateToday: counters.late,
    unmarkedToday: counters.unmarked,
    averageScore: Math.round(average),
    teamCount: teams,
    columnCount: getColumns(db, league.id).length,
  };
}

export function createLeaguesRouter({ db }) {
  const router = Router();
  const owned = [requireTeacher, loadOwnedLeague(db)];
  const ownerOwned = [...owned, requireOwnerTeacher];

  router.get('/', requireTeacher, (req, res) => {
    const ownerId = teacherId(req);
    let leagues = listLeagues(db, ownerId);
    if (req.user.assistant) leagues = leagues.filter((league) => league.id === req.user.assistant.leagueId);
    res.json({ items: leagues.map((league) => ({
      id: league.id,
      name: league.name,
      status: league.status,
      createdAt: league.created_at,
      completedAt: league.completed_at,
      studentCount: league.student_count,
      teamCount: league.team_count,
    })) });
  });

  router.post('/', requireTeacher, requireOwnerTeacher, validate({ body: schemas.leagueCreate }), (req, res) => {
    const league = createLeague(db, req.user.id, req.body.name);
    res.status(201).json({ league: { id: league.id, name: league.name, status: league.status, createdAt: league.created_at }, settings: serializeSettings(readSettings(db, league.id)) });
  });

  router.get('/:id', ...owned, (req, res) => {
    const league = requireLeague(db, req.league.id);
    res.json({
      league: {
        id: league.id,
        name: league.name,
        status: league.status,
        createdAt: league.created_at,
        completedAt: league.completed_at,
        finalRanking: league.final_ranking ? JSON.parse(league.final_ranking) : null,
      },
      settings: serializeSettings(readSettings(db, league.id)),
      timer: timerPayload(db, league.id),
      summary: summaryFor(db, league),
      teacher: { id: teacherId(req), displayName: req.user.ownerDisplayName ?? req.user.displayName },
    });
  });

  router.patch('/:id', ...ownerOwned, validate({ body: schemas.leagueUpdate }), (req, res) => {
    let league = requireLeague(db, req.league.id);
    if (req.body.name !== undefined) league = renameLeague(db, league.id, req.body.name);
    if (req.body.status === 'completed') league = completeLeague(db, league.id, rankingForLeague(db, league.id));
    if (req.body.status === 'active' && league.status === 'completed') league = reactivateLeague(db, league.id);
    res.json({ league: { id: league.id, name: league.name, status: league.status, completedAt: league.completed_at } });
  });

  router.delete('/:id', ...ownerOwned, (req, res) => {
    deleteLeague(db, req.league.id);
    res.json({ ok: true });
  });

  router.post('/:id/complete', ...ownerOwned, (req, res) => {
    const ranking = rankingForLeague(db, req.league.id);
    const league = completeLeague(db, req.league.id, ranking);
    res.json({
      league: { id: league.id, name: league.name, status: league.status, completedAt: league.completed_at },
      ranking: ranking.slice(0, 10).map((row) => ({ ...row, title: titleForPoints(row.total) })),
    });
  });

  router.post('/:id/reactivate', ...ownerOwned, (req, res) => {
    const league = reactivateLeague(db, req.league.id);
    res.json({ league: { id: league.id, status: league.status } });
  });

  router.get('/:id/settings', ...owned, (req, res) => {
    res.json({ settings: serializeSettings(readSettings(db, req.league.id)) });
  });

  router.put('/:id/settings', ...ownerOwned, validate({ body: schemas.leagueSettings }), (req, res) => {
    const patch = {
      individualAffectsTeam: req.body.individualAffectsTeam,
      latePenalty: req.body.latePenalty,
      absentPenalty: req.body.absentPenalty,
      grade: req.body.grade,
    };
    res.json({ settings: serializeSettings(writeSettings(db, req.league.id, patch)) });
  });

  router.get('/:id/summary', ...owned, (req, res) => {
    res.json({ summary: summaryFor(db, requireLeague(db, req.league.id)) });
  });

  router.get('/:id/ranking', ...owned, (req, res) => {
    const items = rankingForLeague(db, req.league.id).map((row) => ({ ...row, title: titleForPoints(row.total) }));
    res.json({ items, total: items.length });
  });

  router.get('/:id/timer', ...owned, requirePermission('timer'), (req, res) => {
    res.json({ timer: timerPayload(db, req.league.id) });
  });

  router.put('/:id/timer', ...owned, requirePermission('timer'), validate({ body: schemas.timerSet }), (req, res) => {
    const { days, hours, minutes, seconds } = req.body;
    const durationSeconds = days * 86400 + hours * 3600 + minutes * 60 + seconds;
    if (durationSeconds <= 0) throw badRequest('TIMER_ZERO', 'مدت زمان باید بیشتر از صفر باشد');
    const now = isoNow();
    const endsAt = new Date(Date.now() + durationSeconds * 1000).toISOString();
    db.prepare(`
      INSERT INTO timers (league_id, ends_at, duration_seconds, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (league_id) DO UPDATE SET ends_at = excluded.ends_at, duration_seconds = excluded.duration_seconds, updated_at = excluded.updated_at
    `).run(req.league.id, endsAt, durationSeconds, now, now);
    res.json({ timer: timerPayload(db, req.league.id) });
  });

  router.post('/:id/timer/adjust', ...owned, requirePermission('timer'), (req, res) => {
    const days = Number.parseInt(req.body?.days ?? 0, 10);
    if (!Number.isFinite(days) || days === 0) throw badRequest('INVALID_DAYS', 'تعداد روز نامعتبر است');
    const current = db.prepare('SELECT ends_at AS endsAt FROM timers WHERE league_id = ?').get(req.league.id);
    if (!current) throw notFound('برای این لیگ تایمری تنظیم نشده است');
    const next = new Date(new Date(current.endsAt).getTime() + days * 86400 * 1000).toISOString();
    db.prepare('UPDATE timers SET ends_at = ?, updated_at = ? WHERE league_id = ?').run(next, isoNow(), req.league.id);
    res.json({ timer: timerPayload(db, req.league.id) });
  });

  router.delete('/:id/timer', ...owned, requirePermission('timer'), (req, res) => {
    db.prepare('DELETE FROM timers WHERE league_id = ?').run(req.league.id);
    res.json({ timer: timerPayload(db, req.league.id) });
  });

  router.get('/:id/live', ...owned, requirePermission('live'), (req, res) => {
    const league = requireLeague(db, req.league.id);
    const standings = teamStandings(db, league.id);
    const rows = rankingForLeague(db, league.id).map((row) => ({
      rank: row.rank,
      studentId: row.studentId,
      name: row.name,
      total: row.total,
      title: titleForPoints(row.total),
    }));
    res.json({
      league: { id: league.id, name: league.name, status: league.status },
      teacher: { id: teacherId(req), displayName: req.user.ownerDisplayName ?? req.user.displayName },
      timer: timerPayload(db, league.id),
      students: rows,
      teams: standings.teams.map((team) => ({ rank: team.rank, name: team.name, label: team.label, points: team.finalPoints, members: team.memberCount })),
      updatedAt: isoNow(),
    });
  });

  return router;
}
