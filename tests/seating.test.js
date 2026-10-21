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

describe('classroom seating', () => {
  it('starts with an empty plan and every student without a seat', async () => {
    const res = await client.get(`/api/v1/leagues/${fixture.leagueA.id}/seating`);
    expect(res.status).toBe(200);
    expect(res.body.layout).toEqual({ rows: 4, cols: 6 });
    expect(res.body.seats).toEqual([]);
    expect(res.body.unassigned).toHaveLength(3);
    expect(res.body.unassigned[0].name).toBe(fixture.studentsA[0].name);
  });

  it('saves a hand-made plan and remembers the grid size', async () => {
    const res = await client.put(`/api/v1/leagues/${fixture.leagueA.id}/seating`, {
      rows: 3,
      cols: 4,
      seats: [
        { row: 0, col: 0, studentId: fixture.studentsA[0].id },
        { row: 0, col: 2, studentId: fixture.studentsA[1].id },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.layout).toEqual({ rows: 3, cols: 4 });
    expect(res.body.seats).toHaveLength(2);
    expect(res.body.unassigned).toHaveLength(1);
    expect(res.body.unassigned[0].id).toBe(fixture.studentsA[2].id);

    const stored = ctx.db.prepare('SELECT * FROM seating_seats WHERE league_id = ? ORDER BY row_index').all(fixture.leagueA.id);
    expect(stored).toHaveLength(2);
    const settings = ctx.db.prepare('SELECT key, value FROM league_settings WHERE league_id = ?').all(fixture.leagueA.id);
    expect(settings).toContainEqual({ key: 'seatingRows', value: '3' });
    expect(settings).toContainEqual({ key: 'seatingCols', value: '4' });
  });

  it('rejects impossible plans without touching the saved one', async () => {
    const base = {
      rows: 2,
      cols: 2,
      seats: [{ row: 0, col: 0, studentId: fixture.studentsA[0].id }],
    };
    await client.put(`/api/v1/leagues/${fixture.leagueA.id}/seating`, base);

    const duplicateSeat = await client.put(`/api/v1/leagues/${fixture.leagueA.id}/seating`, {
      rows: 2,
      cols: 2,
      seats: [
        { row: 0, col: 0, studentId: fixture.studentsA[0].id },
        { row: 0, col: 0, studentId: fixture.studentsA[1].id },
      ],
    });
    expect(duplicateSeat.status).toBe(400);
    expect(duplicateSeat.body.error.code).toBe('DUPLICATE_SEAT');

    const duplicateStudent = await client.put(`/api/v1/leagues/${fixture.leagueA.id}/seating`, {
      rows: 2,
      cols: 2,
      seats: [
        { row: 0, col: 0, studentId: fixture.studentsA[0].id },
        { row: 1, col: 1, studentId: fixture.studentsA[0].id },
      ],
    });
    expect(duplicateStudent.status).toBe(400);
    expect(duplicateStudent.body.error.code).toBe('DUPLICATE_STUDENT');

    const outside = await client.put(`/api/v1/leagues/${fixture.leagueA.id}/seating`, {
      rows: 2,
      cols: 2,
      seats: [{ row: 5, col: 0, studentId: fixture.studentsA[0].id }],
    });
    expect(outside.status).toBe(400);
    expect(outside.body.error.code).toBe('SEAT_OUT_OF_RANGE');

    const foreign = await client.put(`/api/v1/leagues/${fixture.leagueA.id}/seating`, {
      rows: 2,
      cols: 2,
      seats: [{ row: 0, col: 0, studentId: fixture.studentsB[0].id }],
    });
    expect(foreign.status).toBe(400);
    expect(foreign.body.error.code).toBe('UNKNOWN_STUDENT');

    const kept = await client.get(`/api/v1/leagues/${fixture.leagueA.id}/seating`);
    expect(kept.body.seats).toHaveLength(1);
    expect(kept.body.layout).toEqual({ rows: 2, cols: 2 });
  });

  it('shuffles the class so nobody keeps the same seat', async () => {
    await client.put(`/api/v1/leagues/${fixture.leagueA.id}/seating`, {
      rows: 2,
      cols: 2,
      seats: [
        { row: 0, col: 0, studentId: fixture.studentsA[0].id },
        { row: 0, col: 1, studentId: fixture.studentsA[1].id },
        { row: 1, col: 0, studentId: fixture.studentsA[2].id },
      ],
    });

    const res = await client.post(`/api/v1/leagues/${fixture.leagueA.id}/seating/shuffle`, {});
    expect(res.status).toBe(200);
    expect(res.body.seats).toHaveLength(3);
    const positions = new Set(res.body.seats.map((seat) => `${seat.row}:${seat.col}`));
    expect(positions.size).toBe(3);
    const before = new Map([[0, '0:0'], [1, '0:1'], [2, '1:0']]);
    const kept = res.body.seats.filter((seat) => before.get(fixture.studentsA.findIndex((s) => s.id === seat.studentId)) === `${seat.row}:${seat.col}`);
    expect(kept).toEqual([]);
  });

  it('clears every seat but keeps the grid size', async () => {
    await client.put(`/api/v1/leagues/${fixture.leagueA.id}/seating`, {
      rows: 5,
      cols: 5,
      seats: [{ row: 1, col: 1, studentId: fixture.studentsA[0].id }],
    });
    const res = await client.del(`/api/v1/leagues/${fixture.leagueA.id}/seating`);
    expect(res.status).toBe(200);
    expect(res.body.seats).toEqual([]);
    expect(res.body.layout).toEqual({ rows: 5, cols: 5 });
    expect(res.body.unassigned).toHaveLength(3);
  });

  it('hides the plan from other teachers and from students', async () => {
    const other = createClient(ctx.db);
    await other.login('teacher-b', 'password-b1');
    const denied = await other.get(`/api/v1/leagues/${fixture.leagueA.id}/seating`);
    expect(denied.status).toBe(403);

    const student = createClient(ctx.db);
    await student.login('student-a', 'student-a1');
    const forbidden = await student.put(`/api/v1/leagues/${fixture.leagueA.id}/seating`, {
      rows: 2,
      cols: 2,
      seats: [{ row: 0, col: 0, studentId: fixture.studentsA[0].id }],
    });
    expect(forbidden.status).toBe(403);
  });
});
