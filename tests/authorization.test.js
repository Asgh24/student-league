import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildFixture } from './fixtures.js';
import { createClient, createTestDatabase } from './helpers.js';

let ctx;
let fixture;
let clientA;
let clientB;

beforeEach(() => {
  ctx = createTestDatabase();
  fixture = buildFixture(ctx.db);
  clientA = createClient(ctx.db);
  clientB = createClient(ctx.db);
});

afterEach(() => {
  ctx.cleanup();
});

describe('authorization - cross teacher isolation', () => {
  beforeEach(async () => {
    await clientA.login('teacher-a', 'password-a1');
    await clientB.login('teacher-b', 'password-b1');
  });

  it('only lists the leagues the teacher owns', async () => {
    const res = await clientA.get('/api/v1/leagues');
    expect(res.status).toBe(200);
    expect(res.body.items.map((l) => l.name)).toEqual(['لیگ الف']);
  });

  it('refuses to read another teacher league', async () => {
    const res = await clientA.get(`/api/v1/leagues/${fixture.leagueB.id}`);
    expect(res.status).toBe(403);
  });

  it('refuses to read another teacher students table', async () => {
    const res = await clientA.get(`/api/v1/leagues/${fixture.leagueB.id}/students`);
    expect(res.status).toBe(403);
  });

  it('refuses to modify another teacher student', async () => {
    const res = await clientA.patch(`/api/v1/students/${fixture.studentsB[0].id}`, { name: 'دستکاری' });
    expect(res.status).toBe(403);
    const name = ctx.db.prepare('SELECT name FROM students WHERE id = ?').get(fixture.studentsB[0].id).name;
    expect(name).toBe('سارا تنها');
  });

  it('refuses to delete another teacher column', async () => {
    const res = await clientA.del(`/api/v1/columns/${fixture.columnsB[0].id}`);
    expect(res.status).toBe(403);
  });

  it('refuses to adjust another teacher team', async () => {
    const teamB = ctx.db.prepare('INSERT INTO teams (league_id, name, points, created_at) VALUES (?, ?, 0, ?)')
      .run(fixture.leagueB.id, 'تیم ب', new Date().toISOString());
    const res = await clientA.post(`/api/v1/teams/${teamB.lastInsertRowid}/adjust`, { delta: 10 });
    expect(res.status).toBe(403);
  });

  it('refuses to write scores into another teacher league', async () => {
    const res = await clientA.post(`/api/v1/leagues/${fixture.leagueB.id}/scores/commit`, {
      studentId: fixture.studentsB[0].id,
      changes: [{ columnId: fixture.columnsB[0].id, delta: 50 }],
    });
    expect(res.status).toBe(403);
    const total = ctx.db.prepare('SELECT COALESCE(SUM(value), 0) AS total FROM scores WHERE league_id = ?').get(fixture.leagueB.id).total;
    expect(total).toBe(0);
  });

  it('keeps each teacher able to work on their own league', async () => {
    const res = await clientB.post(`/api/v1/leagues/${fixture.leagueB.id}/scores/commit`, {
      studentId: fixture.studentsB[0].id,
      changes: [{ columnId: fixture.columnsB[0].id, delta: 50 }],
    });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(50);
  });
});

describe('authorization - student privacy', () => {
  beforeEach(async () => {
    await clientA.login('teacher-a', 'password-a1');
    const seed = await clientA.post(`/api/v1/leagues/${fixture.leagueA.id}/scores/commit`, {
      studentId: fixture.studentsA[1].id,
      changes: [{ columnId: fixture.columnsA[0].id, delta: 75 }],
    });
    expect(seed.status).toBe(200);
  });

  it('blocks a student from every teacher endpoint', async () => {
    const student = createClient(ctx.db);
    await student.login('student-a', 'student-a1');

    const endpoints = [
      `/api/v1/leagues/${fixture.leagueA.id}`,
      `/api/v1/leagues/${fixture.leagueA.id}/students`,
      `/api/v1/leagues/${fixture.leagueA.id}/scores`,
      `/api/v1/leagues/${fixture.leagueA.id}/attendance`,
      `/api/v1/leagues`,
      `/api/v1/students/${fixture.studentsA[1].id}`,
    ];
    for (const endpoint of endpoints) {
      const res = await student.get(endpoint);
      expect(res.status, `expected ${endpoint} to be forbidden`).toBe(403);
    }
  });

  it('lets a student see their own dashboard only', async () => {
    const student = createClient(ctx.db);
    await student.login('student-a', 'student-a1');
    const dash = await student.get('/api/v1/student/dashboard');
    expect(dash.status).toBe(200);
    expect(dash.body.studentId).toBe(fixture.studentsA[0].id);
    expect(dash.body.points).toBe(0);
  });

  it('never exposes another student history through the ranking payload', async () => {
    const student = createClient(ctx.db);
    await student.login('student-a', 'student-a1');
    const res = await student.get('/api/v1/student/ranking');
    expect(res.status).toBe(200);
    const other = res.body.items.find((item) => item.studentId === fixture.studentsA[1].id);
    expect(other.total).toBe(75);
    expect(other).not.toHaveProperty('history');
    expect(other).not.toHaveProperty('attended');
    expect(other).not.toHaveProperty('recorded');
  });

  it('returns only the student own attendance records', async () => {
    const student = createClient(ctx.db);
    await student.login('student-a', 'student-a1');
    const res = await student.get('/api/v1/student/attendance');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.total).toBe(0);
  });
});
