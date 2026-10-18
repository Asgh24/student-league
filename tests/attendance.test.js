import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildFixture } from './fixtures.js';
import { createClient, createTestDatabase } from './helpers.js';

let ctx;
let fixture;
let client;
const DAY = '2026-08-10';

beforeEach(async () => {
  ctx = createTestDatabase();
  fixture = buildFixture(ctx.db);
  client = createClient(ctx.db);
  await client.login('teacher-a', 'password-a1');
});

afterEach(() => {
  ctx.cleanup();
});

describe('attendance', () => {
  it('records a daily sheet and derives the dashboard counters', async () => {
    const res = await client.post(`/api/v1/leagues/${fixture.leagueA.id}/attendance`, {
      date: DAY,
      records: [
        { studentId: fixture.studentsA[0].id, status: 'present' },
        { studentId: fixture.studentsA[1].id, status: 'absent' },
        { studentId: fixture.studentsA[2].id, status: 'late' },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.counters).toMatchObject({ present: 1, absent: 1, late: 1, total: 3, unmarked: 0 });

    const sheet = await client.get(`/api/v1/leagues/${fixture.leagueA.id}/attendance?date=${DAY}`);
    expect(sheet.body.items.map((i) => i.status)).toEqual(['present', 'absent', 'late']);
  });

  it('updates an existing record instead of duplicating it', async () => {
    await client.post(`/api/v1/leagues/${fixture.leagueA.id}/attendance`, {
      date: DAY,
      records: [{ studentId: fixture.studentsA[0].id, status: 'absent' }],
    });
    await client.post(`/api/v1/leagues/${fixture.leagueA.id}/attendance`, {
      date: DAY,
      records: [{ studentId: fixture.studentsA[0].id, status: 'present' }],
    });
    const count = ctx.db.prepare('SELECT COUNT(*) AS n FROM attendance WHERE student_id = ?').get(fixture.studentsA[0].id).n;
    expect(count).toBe(1);
    const counters = await client.get(`/api/v1/leagues/${fixture.leagueA.id}/attendance?date=${DAY}`);
    expect(counters.body.counters).toMatchObject({ present: 1, absent: 0 });
  });

  it('marks every student present in one bulk call', async () => {
    const res = await client.post(`/api/v1/leagues/${fixture.leagueA.id}/attendance/bulk`, { date: DAY, status: 'present' });
    expect(res.status).toBe(200);
    expect(res.body.applied).toBe(3);
    expect(res.body.counters).toMatchObject({ present: 3, unmarked: 0 });
  });

  it('reports the attendance ratio per student', async () => {
    for (const day of ['2026-08-08', '2026-08-09', '2026-08-10']) {
      await client.post(`/api/v1/leagues/${fixture.leagueA.id}/attendance`, {
        date: day,
        records: [{ studentId: fixture.studentsA[0].id, status: day === '2026-08-09' ? 'absent' : 'present' }],
      });
    }
    const summary = await client.get(`/api/v1/leagues/${fixture.leagueA.id}/attendance/summary`);
    const row = summary.body.items.find((i) => i.studentId === fixture.studentsA[0].id);
    expect(row.recorded).toBe(3);
    expect(row.attended).toBe(2);
  });

  it('lists historical days with per status counters', async () => {
    await client.post(`/api/v1/leagues/${fixture.leagueA.id}/attendance/bulk`, { date: '2026-08-09', status: 'present' });
    await client.post(`/api/v1/leagues/${fixture.leagueA.id}/attendance/bulk`, { date: DAY, status: 'late' });
    const res = await client.get(`/api/v1/leagues/${fixture.leagueA.id}/attendance/history`);
    expect(res.body.total).toBe(2);
    expect(res.body.items[0].day).toBe(DAY);
    expect(res.body.items[0].late).toBe(3);
  });

  it('applies and reverses configured penalties on the discipline column', async () => {
    await client.put(`/api/v1/leagues/${fixture.leagueA.id}/settings`, { latePenalty: -5, absentPenalty: -20 });
    const student = fixture.studentsA[0];

    await client.post(`/api/v1/leagues/${fixture.leagueA.id}/attendance`, {
      date: DAY,
      records: [{ studentId: student.id, status: 'absent' }],
    });
    let total = ctx.db.prepare('SELECT COALESCE(SUM(value), 0) AS t FROM scores WHERE student_id = ?').get(student.id).t;
    expect(total).toBe(-20);

    // Moving to late replaces the absent penalty instead of stacking.
    await client.post(`/api/v1/leagues/${fixture.leagueA.id}/attendance`, {
      date: DAY,
      records: [{ studentId: student.id, status: 'late' }],
    });
    total = ctx.db.prepare('SELECT COALESCE(SUM(value), 0) AS t FROM scores WHERE student_id = ?').get(student.id).t;
    expect(total).toBe(-5);

    // Present clears the penalty completely.
    await client.post(`/api/v1/leagues/${fixture.leagueA.id}/attendance`, {
      date: DAY,
      records: [{ studentId: student.id, status: 'present' }],
    });
    total = ctx.db.prepare('SELECT COALESCE(SUM(value), 0) AS t FROM scores WHERE student_id = ?').get(student.id).t;
    expect(total).toBe(0);

    const history = ctx.db.prepare("SELECT delta FROM score_history WHERE student_id = ? AND reason LIKE 'حضور%' ORDER BY id").all(student.id);
    expect(history.map((h) => h.delta)).toEqual([-20, 15, 5]);
  });

  it('does not touch scores when no penalties are configured', async () => {
    await client.post(`/api/v1/leagues/${fixture.leagueA.id}/attendance`, {
      date: DAY,
      records: [{ studentId: fixture.studentsA[0].id, status: 'absent' }],
    });
    const n = ctx.db.prepare('SELECT COUNT(*) AS n FROM score_history').get().n;
    expect(n).toBe(0);
  });

  it('shows the attendance counters on the league summary', async () => {
    const today = new Date(Date.now() + 210 * 60 * 1000).toISOString().slice(0, 10);
    await client.post(`/api/v1/leagues/${fixture.leagueA.id}/attendance/bulk`, { date: today, status: 'present' });
    const res = await client.get(`/api/v1/leagues/${fixture.leagueA.id}/summary`);
    expect(res.body.summary.presentToday).toBe(3);
    expect(res.body.summary.absentToday).toBe(0);
    expect(res.body.summary.studentCount).toBe(3);
    expect(res.body.summary.teamCount).toBe(2);
  });
});
