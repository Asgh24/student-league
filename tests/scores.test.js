import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildFixture } from './fixtures.js';
import { createClient, createTestDatabase } from './helpers.js';

let ctx;
let fixture;
let client;

beforeEach(async () => {
  ctx = createTestDatabase();
  fixture = buildFixture(ctx.db);
  client = createClient(ctx.db);
  await client.login('teacher-a', 'password-a1');
});

afterEach(() => {
  ctx.cleanup();
});

describe('score commit transaction', () => {
  it('applies several deltas atomically and reports the new total', async () => {
    const [maths, farsi, science] = fixture.columnsA;
    const res = await client.post(`/api/v1/leagues/${fixture.leagueA.id}/scores/commit`, {
      studentId: fixture.studentsA[0].id,
      changes: [
        { columnId: maths.id, delta: 25 },
        { columnId: farsi.id, delta: 50 },
        { columnId: science.id, delta: -10 },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.applied).toBe(3);
    expect(res.body.total).toBe(65);

    const scores = ctx.db.prepare('SELECT column_id AS columnId, value FROM scores WHERE student_id = ? ORDER BY column_id').all(fixture.studentsA[0].id);
    expect(scores).toHaveLength(3);
    expect(scores.map((s) => s.value).sort((a, b) => a - b)).toEqual([-10, 25, 50]);
  });

  it('writes one history row per applied delta with the resulting total', async () => {
    const columnId = fixture.columnsA[0].id;
    await client.post(`/api/v1/leagues/${fixture.leagueA.id}/scores/commit`, {
      studentId: fixture.studentsA[0].id,
      changes: [{ columnId, delta: 25 }, { columnId, delta: 25 }],
      reason: 'فعالیت کلاسی',
    });

    const rows = ctx.db.prepare('SELECT * FROM score_history WHERE student_id = ? ORDER BY id ASC').all(fixture.studentsA[0].id);
    expect(rows).toHaveLength(2);
    expect(rows[0].delta).toBe(25);
    expect(rows[0].total_after).toBe(25);
    expect(rows[1].total_after).toBe(50);
    expect(rows[1].reason).toBe('فعالیت کلاسی');
    expect(rows[1].actor_name).toBe('خانم الف');
    expect(rows[1].column_name).toBe(fixture.columnsA[0].name);
  });

  it('rolls the whole batch back when one column does not belong to the league', async () => {
    const good = fixture.columnsA[0];
    const res = await client.post(`/api/v1/leagues/${fixture.leagueA.id}/scores/commit`, {
      studentId: fixture.studentsA[0].id,
      changes: [
        { columnId: good.id, delta: 25 },
        { columnId: 999999, delta: 10 },
      ],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('COLUMN_NOT_FOUND');

    const total = ctx.db.prepare('SELECT COALESCE(SUM(value), 0) AS total FROM scores WHERE student_id = ?').get(fixture.studentsA[0].id).total;
    expect(total).toBe(0);
    const history = ctx.db.prepare('SELECT COUNT(*) AS n FROM score_history WHERE student_id = ?').get(fixture.studentsA[0].id).n;
    expect(history).toBe(0);
  });

  it('rejects a column that belongs to another league', async () => {
    const res = await client.post(`/api/v1/leagues/${fixture.leagueA.id}/scores/commit`, {
      studentId: fixture.studentsA[0].id,
      changes: [{ columnId: fixture.columnsB[0].id, delta: 25 }],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('COLUMN_NOT_FOUND');
  });

  it('rejects a student that is not in the league', async () => {
    const res = await client.post(`/api/v1/leagues/${fixture.leagueA.id}/scores/commit`, {
      studentId: fixture.studentsB[0].id,
      changes: [{ columnId: fixture.columnsA[0].id, delta: 25 }],
    });
    expect(res.status).toBe(404);
  });

  it('ignores zero deltas instead of writing empty history rows', async () => {
    const res = await client.post(`/api/v1/leagues/${fixture.leagueA.id}/scores/commit`, {
      studentId: fixture.studentsA[0].id,
      changes: [{ columnId: fixture.columnsA[0].id, delta: 0 }, { columnId: fixture.columnsA[1].id, delta: 10 }],
    });
    expect(res.status).toBe(200);
    expect(res.body.applied).toBe(1);
    const history = ctx.db.prepare('SELECT COUNT(*) AS n FROM score_history WHERE student_id = ?').get(fixture.studentsA[0].id).n;
    expect(history).toBe(1);
  });

  it('records a single change with a free text reason', async () => {
    const res = await client.post(`/api/v1/leagues/${fixture.leagueA.id}/scores/record`, {
      studentId: fixture.studentsA[1].id,
      columnId: fixture.columnsA[2].id,
      delta: -15,
      reason: 'بی‌دقتی در تمرین',
    });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(-15);
    const row = ctx.db.prepare('SELECT * FROM score_history WHERE student_id = ?').get(fixture.studentsA[1].id);
    expect(row.reason).toBe('بی‌دقتی در تمرین');
    expect(row.delta).toBe(-15);
  });

  it('returns the full scores matrix sorted by total', async () => {
    await client.post(`/api/v1/leagues/${fixture.leagueA.id}/scores/commit`, {
      studentId: fixture.studentsA[1].id,
      changes: [{ columnId: fixture.columnsA[0].id, delta: 100 }],
    });
    await client.post(`/api/v1/leagues/${fixture.leagueA.id}/scores/commit`, {
      studentId: fixture.studentsA[0].id,
      changes: [{ columnId: fixture.columnsA[0].id, delta: 50 }],
    });

    const res = await client.get(`/api/v1/leagues/${fixture.leagueA.id}/scores`);
    expect(res.status).toBe(200);
    expect(res.body.students.map((s) => s.total)).toEqual([100, 50, 0]);
    expect(res.body.students[0].rank).toBe(1);
    expect(res.body.students[0].title.title).toBeTruthy();
    expect(res.body.columns).toHaveLength(8);
  });
});

describe('score history endpoint', () => {
  it('returns history newest first through the teacher student profile', async () => {
    for (let i = 1; i <= 3; i += 1) {
      await client.post(`/api/v1/leagues/${fixture.leagueA.id}/scores/commit`, {
        studentId: fixture.studentsA[0].id,
        changes: [{ columnId: fixture.columnsA[0].id, delta: i * 10 }],
      });
    }

    const teacher = await client.get(`/api/v1/students/${fixture.studentsA[0].id}`);
    expect(teacher.status).toBe(200);
    expect(teacher.body.student.history).toHaveLength(3);
    expect(teacher.body.student.history[0].delta).toBe(30);
    expect(teacher.body.student.total).toBe(60);
  });

  it('refuses a teacher on the student-only history endpoint', async () => {
    const res = await client.get('/api/v1/student/history');
    expect(res.status).toBe(403);
  });
});
