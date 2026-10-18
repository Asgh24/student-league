import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildFixture } from './fixtures.js';
import { createClient, createTestDatabase } from './helpers.js';

let ctx;
let fixture;
let client;

async function setTotal(studentId, delta) {
  const res = await client.post(`/api/v1/leagues/${fixture.leagueA.id}/scores/commit`, {
    studentId,
    changes: [{ columnId: fixture.columnsA[0].id, delta }],
  });
  expect(res.status).toBe(200);
}

beforeEach(async () => {
  ctx = createTestDatabase();
  fixture = buildFixture(ctx.db, { studentNames: ['آرش', 'بهار', 'پویا'] });
  client = createClient(ctx.db);
  await client.login('teacher-a', 'password-a1');
});

afterEach(() => {
  ctx.cleanup();
});

describe('ranking', () => {
  it('orders by total descending and breaks ties by name', async () => {
    await setTotal(fixture.studentsA[1].id, 100); // بهار
    await setTotal(fixture.studentsA[0].id, 100); // آرش
    await setTotal(fixture.studentsA[2].id, 50); // پویا

    const res = await client.get(`/api/v1/leagues/${fixture.leagueA.id}/ranking`);
    expect(res.status).toBe(200);
    expect(res.body.items.map((r) => r.name)).toEqual(['آرش', 'بهار', 'پویا']);
  });

  it('gives tied students the same competition rank and skips the next one', async () => {
    await setTotal(fixture.studentsA[0].id, 100);
    await setTotal(fixture.studentsA[1].id, 100);
    await setTotal(fixture.studentsA[2].id, 50);

    const res = await client.get(`/api/v1/leagues/${fixture.leagueA.id}/ranking`);
    expect(res.body.items.map((r) => r.rank)).toEqual([1, 1, 3]);
  });

  it('treats Persian yeh and kaf variants as equal when comparing names', async () => {
    const league = fixture.leagueB.id;
    const insert = ctx.db.prepare('INSERT INTO students (league_id, name, created_at) VALUES (?, ?, ?)');
    const now = new Date().toISOString();
    const aliArabic = Number(insert.run(league, 'علي', now).lastInsertRowid);
    const aliPersian = Number(insert.run(league, 'علی', now).lastInsertRowid);
    ctx.db.prepare('INSERT INTO scores (league_id, student_id, column_id, value, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(league, aliArabic, fixture.columnsB[0].id, 10, now);
    ctx.db.prepare('INSERT INTO scores (league_id, student_id, column_id, value, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(league, aliPersian, fixture.columnsB[0].id, 10, now);

    const clientB = createClient(ctx.db);
    await clientB.login('teacher-b', 'password-b1');
    const res = await clientB.get(`/api/v1/leagues/${league}/ranking`);
    expect(res.body.items.map((r) => r.rank)).toEqual([1, 1, 3]);
  });

  it('assigns a title ladder based on the total', async () => {
    await setTotal(fixture.studentsA[0].id, 2100);
    const res = await client.get(`/api/v1/leagues/${fixture.leagueA.id}/ranking`);
    expect(res.body.items[0].title.title).toBe('شاهنشاه');
  });

  it('snapshots the final ranking and awards medals when the league completes', async () => {
    await setTotal(fixture.studentsA[0].id, 300);
    await setTotal(fixture.studentsA[1].id, 200);
    await setTotal(fixture.studentsA[2].id, 100);

    const res = await client.post(`/api/v1/leagues/${fixture.leagueA.id}/complete`);
    expect(res.status).toBe(200);
    expect(res.body.league.status).toBe('completed');
    expect(res.body.ranking.map((r) => r.name)).toEqual(['آرش', 'بهار', 'پویا']);

    const medals = ctx.db.prepare('SELECT student_id AS studentId, title, rank, source FROM championships ORDER BY rank').all();
    expect(medals).toHaveLength(3);
    expect(medals[0].title).toBe('قهرمان لیگ');
    expect(medals[0].source).toBe('league_completed');
    expect(medals[1].rank).toBe(2);
  });
});
