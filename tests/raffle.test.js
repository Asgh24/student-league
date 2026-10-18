import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildFixture } from './fixtures.js';
import { createClient, createTestDatabase } from './helpers.js';
import { randomInt, shuffle } from '../src/lib/random.js';

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

describe('raffle', () => {
  it('picks one of the students and stores it in the history', async () => {
    const res = await client.post(`/api/v1/leagues/${fixture.leagueA.id}/tools/raffle`, {});
    expect(res.status).toBe(200);
    expect(fixture.studentsA.map((s) => s.name)).toContain(res.body.winner.name);
    expect(res.body.poolSize).toBe(3);
    expect(res.body.remaining).toBe(2);
    expect(res.body.history).toHaveLength(1);
  });

  it('excludes previously drawn students until everyone has had a turn', async () => {
    const winners = [];
    for (let i = 0; i < 3; i += 1) {
      const res = await client.post(`/api/v1/leagues/${fixture.leagueA.id}/tools/raffle`, { excludePrevious: true });
      winners.push(res.body.winner.studentId);
      expect(res.body.cycled).toBe(false);
    }
    expect(new Set(winners).size).toBe(3);
  });

  it('starts a new cycle once everybody has been drawn', async () => {
    for (let i = 0; i < 3; i += 1) {
      await client.post(`/api/v1/leagues/${fixture.leagueA.id}/tools/raffle`, { excludePrevious: true });
    }
    const res = await client.post(`/api/v1/leagues/${fixture.leagueA.id}/tools/raffle`, { excludePrevious: true });
    expect(res.status).toBe(200);
    expect(res.body.cycled).toBe(true);
    expect(res.body.remaining).toBe(2);
  });

  it('ignores the exclusion list when the option is off', async () => {
    await client.post(`/api/v1/leagues/${fixture.leagueA.id}/tools/raffle`, { excludePrevious: true });
    const res = await client.post(`/api/v1/leagues/${fixture.leagueA.id}/tools/raffle`, { excludePrevious: false });
    expect(res.body.poolSize).toBe(3);
    expect(res.body.remaining).toBe(2);
    expect(res.body.history).toHaveLength(2);
  });

  it('clears the raffle history on request', async () => {
    await client.post(`/api/v1/leagues/${fixture.leagueA.id}/tools/raffle`, {});
    const res = await client.del(`/api/v1/leagues/${fixture.leagueA.id}/tools/raffle/history`);
    expect(res.status).toBe(200);
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM raffle_history').get().n).toBe(0);
  });

  it('refuses to draw from an empty league', async () => {
    const empty = ctx.db.prepare("INSERT INTO leagues (teacher_id, name, status, created_at) VALUES (?, 'خالی', 'active', ?)")
      .run(fixture.teacherA.id, new Date().toISOString());
    const res = await client.post(`/api/v1/leagues/${empty.lastInsertRowid}/tools/raffle`, {});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('NO_STUDENTS');
  });
});

describe('lucky wheel', () => {
  it('falls back to student names when never customised', async () => {
    const res = await client.get(`/api/v1/leagues/${fixture.leagueA.id}/tools/wheel`);
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('students');
    expect(res.body.segments.map((s) => s.label)).toEqual(['آرش آزمون', 'بهار بنفش', 'پویا پیشرو']);
  });

  it('stores custom segments and returns them afterwards', async () => {
    const save = await client.put(`/api/v1/leagues/${fixture.leagueA.id}/tools/wheel`, {
      segments: [{ label: 'جایزه یک' }, { label: 'جایزه دو' }, { label: 'شانس دوباره' }],
    });
    expect(save.status).toBe(200);
    const res = await client.get(`/api/v1/leagues/${fixture.leagueA.id}/tools/wheel`);
    expect(res.body.source).toBe('custom');
    expect(res.body.segments).toHaveLength(3);
  });
});

describe('crypto random helpers', () => {
  it('produces values inside the requested range', () => {
    for (let i = 0; i < 500; i += 1) {
      const value = randomInt(7);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(7);
      expect(Number.isInteger(value)).toBe(true);
    }
  });

  it('rejects an invalid range', () => {
    expect(() => randomInt(0)).toThrowError(RangeError);
  });

  it('shuffles without losing or duplicating items', () => {
    const source = [1, 2, 3, 4, 5, 6, 7, 8];
    const shuffled = shuffle(source);
    expect(shuffled).toHaveLength(source.length);
    expect([...shuffled].sort((a, b) => a - b)).toEqual(source);
    expect(source).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});
