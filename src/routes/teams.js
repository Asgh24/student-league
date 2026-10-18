import { Router } from 'express';
import { asyncHandler } from '../lib/http.js';
import { schemas, validate } from '../lib/validate.js';
import { requireTeacher, loadOwnedLeague } from '../middleware/auth.js';
import { ownedRow } from '../middleware/ownership.js';
import { readSettings } from '../repositories/leagues.js';
import {
  adjustTeamPoints,
  assignMember,
  createTeam,
  deleteTeam,
  removeMember,
  teamAdjustmentHistory,
  teamStandings,
  unassignedStudents,
  updateTeam,
} from '../services/teams.js';

/** League scoped team collection + the "no team" panel. */
export function createLeagueTeamsRouter({ db }) {
  const router = Router({ mergeParams: true });
  router.use(requireTeacher, loadOwnedLeague(db));

  router.get('/', (req, res) => {
    const standings = teamStandings(db, req.league.id);
    res.json({
      ...standings,
      unassigned: unassignedStudents(db, req.league.id),
      settings: readSettings(db, req.league.id),
    });
  });

  router.post('/', validate({ body: schemas.teamCreate }), (req, res) => {
    const team = createTeam(db, req.league.id, req.body);
    res.status(201).json({ team, standings: teamStandings(db, req.league.id) });
  });

  router.post('/assign', validate({ body: schemas.teamAssign }), (req, res) => {
    const members = assignMember(db, { leagueId: req.league.id, teamId: req.body.teamId, studentId: req.body.studentId });
    res.json({ members, standings: teamStandings(db, req.league.id), unassigned: unassignedStudents(db, req.league.id) });
  });

  router.delete('/members/:studentId', asyncHandler(async (req, res) => {
    removeMember(db, { leagueId: req.league.id, studentId: Number.parseInt(req.params.studentId, 10) });
    res.json({ standings: teamStandings(db, req.league.id), unassigned: unassignedStudents(db, req.league.id) });
  }));

  return router;
}

/** Single team operations, authorized through the owning league. */
export function createTeamsRouter({ db }) {
  const router = Router();
  const owned = [requireTeacher, ownedRow(db, 'teams', { as: 'team' })];

  router.patch('/:id', ...owned, validate({ body: schemas.teamUpdate }), (req, res) => {
    const team = updateTeam(db, req.team.id, req.body);
    res.json({ team, standings: teamStandings(db, team.league_id) });
  });

  router.delete('/:id', ...owned, (req, res) => {
    deleteTeam(db, req.team.id);
    res.json({ ok: true, standings: teamStandings(db, req.team.league_id) });
  });

  router.post('/:id/adjust', ...owned, validate({ body: schemas.teamAdjust }), (req, res) => {
    const team = adjustTeamPoints(db, {
      team: req.team,
      delta: req.body.delta,
      reason: req.body.reason ?? '',
      actor: req.user,
    });
    res.json({ team, standings: teamStandings(db, req.team.league_id) });
  });

  router.get('/:id/history', ...owned, (req, res) => {
    res.json({ items: teamAdjustmentHistory(db, req.team.id) });
  });

  router.post('/:id/members', ...owned, validate({ body: schemas.teamMember }), (req, res) => {
    const members = assignMember(db, { leagueId: req.team.league_id, teamId: req.team.id, studentId: req.body.studentId });
    res.json({ members, standings: teamStandings(db, req.team.league_id), unassigned: unassignedStudents(db, req.team.league_id) });
  });

  router.delete('/:id/members/:studentId', ...owned, (req, res) => {
    removeMember(db, { leagueId: req.team.league_id, studentId: Number.parseInt(req.params.studentId, 10) });
    res.json({ standings: teamStandings(db, req.team.league_id), unassigned: unassignedStudents(db, req.team.league_id) });
  });

  return router;
}
