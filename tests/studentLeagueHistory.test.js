import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildFixture, STUDENT_A, STUDENT_B, TEACHER_A } from './fixtures.js';
import { createClient, createTestDatabase } from './helpers.js';

let ctx;
let fixture;
let teacher;
let student;
let oldLeagueId;
let newLeagueId;

beforeEach(async () => {
  ctx = createTestDatabase();
  fixture = buildFixture(ctx.db);
  oldLeagueId = fixture.leagueA.id;
  teacher = createClient(ctx.db);
  await teacher.login(TEACHER_A.username, TEACHER_A.password);
  student = createClient(ctx.db);
  await student.login(STUDENT_A.username, STUDENT_A.password);

  const scored = await teacher.post(`/api/v1/leagues/${oldLeagueId}/scores/commit`, {
    studentId: fixture.studentsA[0].id,
    changes: [{ columnId: fixture.columnsA[0].id, delta: 120 }],
    reason: 'آزمون پایانی',
  });
  expect(scored.status).toBe(200);

  const created = await teacher.post('/api/v1/leagues', { name: 'لیگ دوم', sourceLeagueId: oldLeagueId });
  expect(created.status).toBe(201);
  newLeagueId = created.body.league.id;

  const completed = await teacher.post(`/api/v1/leagues/${oldLeagueId}/complete`);
  expect(completed.status).toBe(200);
});

afterEach(() => ctx.cleanup());

describe('student league history', () => {
  it('lists every membership, including the completed league and the current one', async () => {
    const res = await student.get('/api/v1/student/leagues');
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);

    const oldLeague = res.body.items.find((item) => item.leagueId === oldLeagueId);
    const newLeague = res.body.items.find((item) => item.leagueId === newLeagueId);
    expect(oldLeague).toMatchObject({ leagueName: 'لیگ الف', leagueStatus: 'completed', isCurrent: false, total: 120, rank: 1, totalStudents: 3 });
    expect(oldLeague.completedAt).toBeTruthy();
    expect(newLeague).toMatchObject({ leagueStatus: 'active', isCurrent: true, total: 0 });

    // The old membership is history: the account still points at the new league.
    const dashboard = await student.get('/api/v1/student/dashboard');
    expect(dashboard.body.leagueId).toBe(newLeagueId);
  });

  it('reads the old scores, sessions, final ranking and medal without changing the current league', async () => {
    const res = await student.get(`/api/v1/student/leagues/${oldLeagueId}/results`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      leagueId: oldLeagueId,
      leagueName: 'لیگ الف',
      leagueStatus: 'completed',
      isCurrent: false,
      total: 120,
      rank: 1,
      totalStudents: 3,
      sessionCount: 1,
    });
    expect(res.body.items[0]).toMatchObject({ name: 'ریاضی', value: 120 });
    expect(res.body.sessions[0]).toMatchObject({ columnName: 'ریاضی', topic: 'آزمون پایانی', delta: 120 });
    expect(res.body.ranking[0]).toMatchObject({ rank: 1, total: 120, isMe: true });
    expect(res.body.medals).toEqual([expect.objectContaining({ source: 'league_completed', rank: 1 })]);
    expect(Array.isArray(res.body.reportCards)).toBe(true);

    const current = await student.get(`/api/v1/student/leagues/${newLeagueId}/results`);
    expect(current.body).toMatchObject({ leagueStatus: 'active', isCurrent: true, total: 0, sessionCount: 0 });
  });

  it('never exposes another student\'s or another teacher\'s league', async () => {
    const otherTeacher = await student.get(`/api/v1/student/leagues/${fixture.leagueB.id}/results`);
    expect(otherTeacher.status).toBe(404);

    const otherStudent = createClient(ctx.db);
    expect((await otherStudent.login(STUDENT_B.username, 'student-b1')).status).toBe(200);
    expect((await otherStudent.get(`/api/v1/student/leagues/${oldLeagueId}/results`)).status).toBe(404);
    const list = await otherStudent.get('/api/v1/student/leagues');
    expect(list.body.items.map((item) => item.leagueId)).toEqual([fixture.leagueB.id]);
  });
});
