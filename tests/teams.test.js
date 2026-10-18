import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildFixture } from './fixtures.js';
import { createClient, createTestDatabase } from './helpers.js';

let ctx;
let fixture;
let client;

async function givePoints(studentId, delta) {
  const res = await client.post(`/api/v1/leagues/${fixture.leagueA.id}/scores/commit`, {
    studentId,
    changes: [{ columnId: fixture.columnsA[0].id, delta }],
  });
  expect(res.status).toBe(200);
}

beforeEach(async () => {
  ctx = createTestDatabase();
  fixture = buildFixture(ctx.db);
  client = createClient(ctx.db);
  await client.login('teacher-a', 'password-a1');
});

afterEach(() => {
  ctx.cleanup();
});

describe('team scoring formula', () => {
  it('uses only the team own points when individual points do not affect teams', async () => {
    await client.put(`/api/v1/leagues/${fixture.leagueA.id}/settings`, { individualAffectsTeam: false });
    await client.post(`/api/v1/teams/${fixture.teamsA[0].id}/adjust`, { delta: 40, reason: 'برد مسابقه' });
    await givePoints(fixture.studentsA[0].id, 1000);
    await givePoints(fixture.studentsA[2].id, 4000);
    await client.post(`/api/v1/leagues/${fixture.leagueA.id}/teams/assign`, { teamId: fixture.teamsA[0].id, studentId: fixture.studentsA[0].id });
    await client.post(`/api/v1/leagues/${fixture.leagueA.id}/teams/assign`, { teamId: fixture.teamsA[0].id, studentId: fixture.studentsA[2].id });

    const res = await client.get(`/api/v1/leagues/${fixture.leagueA.id}/teams`);
    expect(res.status).toBe(200);
    expect(res.body.individualAffectsTeam).toBe(false);
    const team = res.body.teams.find((t) => t.id === fixture.teamsA[0].id);
    expect(team.basePoints).toBe(40);
    expect(team.individualPoints).toBe(5000);
    expect(team.memberAverage).toBe(2500);
    expect(team.finalPoints).toBe(40);
  });

  it('adds the member average when individual points affect teams', async () => {
    await client.put(`/api/v1/leagues/${fixture.leagueA.id}/settings`, { individualAffectsTeam: true });
    await client.post(`/api/v1/teams/${fixture.teamsA[0].id}/adjust`, { delta: 40 });
    await givePoints(fixture.studentsA[0].id, 1000);
    await givePoints(fixture.studentsA[2].id, 4000);
    await client.post(`/api/v1/leagues/${fixture.leagueA.id}/teams/assign`, { teamId: fixture.teamsA[0].id, studentId: fixture.studentsA[0].id });
    await client.post(`/api/v1/leagues/${fixture.leagueA.id}/teams/assign`, { teamId: fixture.teamsA[0].id, studentId: fixture.studentsA[2].id });

    const res = await client.get(`/api/v1/leagues/${fixture.leagueA.id}/teams`);
    const team = res.body.teams.find((t) => t.id === fixture.teamsA[0].id);
    expect(team.memberCount).toBe(2);
    expect(team.memberAverage).toBe(2500);
    expect(team.finalPoints).toBe(2540);
  });

  it('keeps settings isolated per league', async () => {
    await client.put(`/api/v1/leagues/${fixture.leagueA.id}/settings`, { individualAffectsTeam: true });
    const b = await client.get(`/api/v1/leagues/${fixture.leagueA.id}/settings`);
    expect(b.body.settings.individualAffectsTeam).toBe(true);
    const other = await client.get(`/api/v1/leagues/${fixture.leagueA.id}/teams`);
    expect(other.body.individualAffectsTeam).toBe(true);
  });

  it('ranks teams by final points and breaks ties by name', async () => {
    await client.put(`/api/v1/leagues/${fixture.leagueA.id}/settings`, { individualAffectsTeam: false });
    await client.post(`/api/v1/teams/${fixture.teamsA[0].id}/adjust`, { delta: 100 });
    await client.post(`/api/v1/teams/${fixture.teamsA[1].id}/adjust`, { delta: 100 });
    const res = await client.get(`/api/v1/leagues/${fixture.leagueA.id}/teams`);
    expect(res.body.teams[0].rank).toBe(1);
    expect(res.body.teams[1].rank).toBe(1);
  });

  it('adjusts team points in both directions and records an audit row', async () => {
    await client.post(`/api/v1/teams/${fixture.teamsA[0].id}/adjust`, { delta: 50, reason: 'امتیاز نظم' });
    const res = await client.post(`/api/v1/teams/${fixture.teamsA[0].id}/adjust`, { delta: -20, reason: 'جریمه' });
    expect(res.status).toBe(200);
    expect(res.body.team.points).toBe(30);

    const history = await client.get(`/api/v1/teams/${fixture.teamsA[0].id}/history`);
    expect(history.body.items).toHaveLength(2);
    expect(history.body.items[0].delta).toBe(-20);
    expect(history.body.items[0].actorName).toBe('خانم الف');
  });

  it('assigns, moves and removes members', async () => {
    const student = fixture.studentsA[0];
    const [teamA, teamB] = fixture.teamsA;

    let res = await client.post(`/api/v1/leagues/${fixture.leagueA.id}/teams/assign`, { teamId: teamA.id, studentId: student.id });
    expect(res.body.standings.teams.find((t) => t.id === teamA.id).memberCount).toBe(1);

    res = await client.post(`/api/v1/leagues/${fixture.leagueA.id}/teams/assign`, { teamId: teamB.id, studentId: student.id });
    expect(res.body.standings.teams.find((t) => t.id === teamA.id).memberCount).toBe(0);
    expect(res.body.standings.teams.find((t) => t.id === teamB.id).memberCount).toBe(1);

    res = await client.del(`/api/v1/leagues/${fixture.leagueA.id}/teams/members/${student.id}`);
    expect(res.status).toBe(200);
    expect(res.body.unassigned.map((s) => s.studentId)).toContain(student.id);
  });

  it('lists every student in the no-team panel and exposes their totals', async () => {
    await givePoints(fixture.studentsA[1].id, 60);
    const res = await client.get(`/api/v1/leagues/${fixture.leagueA.id}/teams`);
    expect(res.body.unassigned).toHaveLength(3);
    const row = res.body.unassigned.find((s) => s.studentId === fixture.studentsA[1].id);
    expect(row.total).toBe(60);
  });

  it('deletes a team without touching the students', async () => {
    const res = await client.del(`/api/v1/teams/${fixture.teamsA[0].id}`);
    expect(res.status).toBe(200);
    expect(res.body.standings.teams).toHaveLength(1);
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM students WHERE league_id = ?').get(fixture.leagueA.id).n).toBe(3);
  });
});
