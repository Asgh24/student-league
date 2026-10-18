import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildFixture } from './fixtures.js';
import { createClient, createTestDatabase } from './helpers.js';

let ctx;
let fixture;
let client;

function totalOf(studentId) {
  return ctx.db.prepare('SELECT COALESCE(SUM(value), 0) AS total FROM scores WHERE student_id = ?').get(studentId).total;
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

describe('score columns', () => {
  it('creates eight default columns when a league is created', async () => {
    const res = await client.get(`/api/v1/leagues/${fixture.leagueA.id}/columns`);
    expect(res.status).toBe(200);
    expect(res.body.items.map((c) => c.name)).toEqual(['ریاضی', 'فارسی', 'علوم', 'مطالعات', 'هدیه', 'هنری', 'پرورشی', 'انضباطی']);
    expect(res.body.items.every((c) => c.step === 25)).toBe(true);
  });

  it('adds a custom column with its own step', async () => {
    const res = await client.post(`/api/v1/leagues/${fixture.leagueA.id}/columns`, { name: 'قرآن', step: 10 });
    expect(res.status).toBe(201);
    expect(res.body.column.name).toBe('قرآن');
    expect(res.body.column.step).toBe(10);
    expect(res.body.column.position).toBe(8);
  });

  it('renames a column and changes its step', async () => {
    const column = fixture.columnsA[0];
    const res = await client.patch(`/api/v1/columns/${column.id}`, { name: 'ریاضی پیشرفته', step: 50 });
    expect(res.status).toBe(200);
    expect(res.body.column.name).toBe('ریاضی پیشرفته');
    expect(res.body.column.step).toBe(50);
  });

  it('deletes a column and discards its points by default', async () => {
    const column = fixture.columnsA[0];
    await client.post(`/api/v1/leagues/${fixture.leagueA.id}/scores/commit`, {
      studentId: fixture.studentsA[0].id,
      changes: [{ columnId: column.id, delta: 100 }],
    });
    expect(totalOf(fixture.studentsA[0].id)).toBe(100);

    const res = await client.del(`/api/v1/columns/${column.id}`);
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('discard');
    expect(res.body.columns).toHaveLength(7);
    expect(totalOf(fixture.studentsA[0].id)).toBe(0);
  });

  it('keeps the points when deleting with mode=keep by moving them to the next column', async () => {
    const removed = fixture.columnsA[0];
    const next = fixture.columnsA[1];
    await client.post(`/api/v1/leagues/${fixture.leagueA.id}/scores/commit`, {
      studentId: fixture.studentsA[0].id,
      changes: [{ columnId: removed.id, delta: 100 }],
    });

    const res = await client.del(`/api/v1/columns/${removed.id}?mode=keep`);
    expect(res.status).toBe(200);
    expect(totalOf(fixture.studentsA[0].id)).toBe(100);

    const moved = ctx.db.prepare('SELECT value FROM scores WHERE student_id = ? AND column_id = ?').get(fixture.studentsA[0].id, next.id);
    expect(moved.value).toBe(100);
    const history = ctx.db.prepare('SELECT COUNT(*) AS n FROM score_history WHERE student_id = ?').get(fixture.studentsA[0].id).n;
    expect(history).toBe(2);
  });

  it('refuses to keep points when it is the last remaining column', async () => {
    const league = ctx.db.prepare("INSERT INTO leagues (teacher_id, name, status, created_at) VALUES (?, 'single', 'active', ?)")
      .run(fixture.teacherA.id, new Date().toISOString());
    const column = ctx.db.prepare("INSERT INTO columns (league_id, name, step, position, created_at) VALUES (?, 'تنها', 25, 0, ?)")
      .run(league.lastInsertRowid, new Date().toISOString());

    const res = await client.del(`/api/v1/columns/${column.lastInsertRowid}?mode=keep`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('LAST_COLUMN');
  });

  it('rejects an unknown delete mode', async () => {
    const res = await client.del(`/api/v1/columns/${fixture.columnsA[0].id}?mode=whatever`);
    expect(res.status).toBe(400);
  });
});
