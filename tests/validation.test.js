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

describe('input validation', () => {
  it('rejects an empty league name with structured details', async () => {
    const res = await client.post('/api/v1/leagues', { name: '   ' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details[0]).toHaveProperty('path');
    expect(res.body.error.details[0]).toHaveProperty('message');
  });

  it('rejects an empty student name', async () => {
    const res = await client.post(`/api/v1/leagues/${fixture.leagueA.id}/students`, { name: '' });
    expect(res.status).toBe(400);
    expect(res.body.error.details.some((d) => d.path === 'name')).toBe(true);
  });

  it('rejects a score commit with no changes', async () => {
    const res = await client.post(`/api/v1/leagues/${fixture.leagueA.id}/scores/commit`, {
      studentId: fixture.studentsA[0].id,
      changes: [],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a zero delta when recording a score with a reason', async () => {
    const res = await client.post(`/api/v1/leagues/${fixture.leagueA.id}/scores/record`, {
      studentId: fixture.studentsA[0].id,
      columnId: fixture.columnsA[0].id,
      delta: 0,
      reason: 'بی دلیل',
    });
    expect(res.status).toBe(400);
  });

  it('rejects a malformed attendance date', async () => {
    const res = await client.post(`/api/v1/leagues/${fixture.leagueA.id}/attendance`, {
      date: '1405/08/10',
      records: [{ studentId: fixture.studentsA[0].id, status: 'present' }],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.details.some((d) => d.path === 'date')).toBe(true);
  });

  it('rejects an unknown attendance status', async () => {
    const res = await client.post(`/api/v1/leagues/${fixture.leagueA.id}/attendance`, {
      date: '2026-08-01',
      records: [{ studentId: fixture.studentsA[0].id, status: 'maybe' }],
    });
    expect(res.status).toBe(400);
  });

  it('rejects an unknown setting key payload shape', async () => {
    const res = await client.put(`/api/v1/leagues/${fixture.leagueA.id}/settings`, { latePenalty: 'abc' });
    expect(res.status).toBe(400);
  });

  it('rejects a wheel with a single segment', async () => {
    const res = await client.put(`/api/v1/leagues/${fixture.leagueA.id}/tools/wheel`, { segments: [{ label: 'تنها' }] });
    expect(res.status).toBe(400);
  });

  it('returns a not found error for a missing league', async () => {
    const res = await client.get('/api/v1/leagues/999999');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns a not found error for an unknown api route', async () => {
    const res = await client.get('/api/v1/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('rejects a team with a duplicate name', async () => {
    const res = await client.post(`/api/v1/leagues/${fixture.leagueA.id}/teams`, { name: 'تیم آبی' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('TEAM_EXISTS');
  });
});
