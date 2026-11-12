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

describe('discipline sheet', () => {
  it('records orderly/disorderly entries and derives counters', async () => {
    const res = await client.post(`/api/v1/leagues/${fixture.leagueA.id}/discipline`, {
      date: DAY,
      records: [
        { studentId: fixture.studentsA[0].id, status: 'orderly' },
        { studentId: fixture.studentsA[1].id, status: 'disorderly', note: 'صحبت با همکلاسی' },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.counters).toMatchObject({ orderly: 1, disorderly: 1, total: 3, unmarked: 1 });

    const sheet = await client.get(`/api/v1/leagues/${fixture.leagueA.id}/discipline?date=${DAY}`);
    expect(sheet.status).toBe(200);
    expect(sheet.body.items.map((item) => item.status)).toEqual(['orderly', 'disorderly', null]);
    expect(sheet.body.items[1].note).toBe('صحبت با همکلاسی');
  });

  it('updates an existing row instead of duplicating it', async () => {
    await client.post(`/api/v1/leagues/${fixture.leagueA.id}/discipline`, {
      date: DAY,
      records: [{ studentId: fixture.studentsA[0].id, status: 'disorderly' }],
    });
    await client.post(`/api/v1/leagues/${fixture.leagueA.id}/discipline`, {
      date: DAY,
      records: [{ studentId: fixture.studentsA[0].id, status: 'orderly' }],
    });
    const count = ctx.db.prepare('SELECT COUNT(*) AS n FROM discipline WHERE student_id = ?').get(fixture.studentsA[0].id).n;
    expect(count).toBe(1);
    const sheet = await client.get(`/api/v1/leagues/${fixture.leagueA.id}/discipline?date=${DAY}`);
    expect(sheet.body.counters).toMatchObject({ orderly: 1, disorderly: 0 });
  });

  it('saves the reason without losing the status and clears the entry explicitly', async () => {
    const student = fixture.studentsA[0];
    await client.post(`/api/v1/leagues/${fixture.leagueA.id}/discipline`, {
      date: DAY,
      records: [{ studentId: student.id, status: 'disorderly' }],
    });

    // A note-only update keeps the stored status.
    const noteOnly = await client.post(`/api/v1/leagues/${fixture.leagueA.id}/discipline`, {
      date: DAY,
      records: [{ studentId: student.id, note: 'بی‌توجهی در کلاس' }],
    });
    expect(noteOnly.status).toBe(200);
    let row = ctx.db.prepare('SELECT status, note FROM discipline WHERE student_id = ?').get(student.id);
    expect(row).toEqual({ status: 'disorderly', note: 'بی‌توجهی در کلاس' });

    // `status: null` removes the row.
    await client.post(`/api/v1/leagues/${fixture.leagueA.id}/discipline`, {
      date: DAY,
      records: [{ studentId: student.id, status: null }],
    });
    row = ctx.db.prepare('SELECT status, note FROM discipline WHERE student_id = ?').get(student.id);
    expect(row).toBeUndefined();
  });

  it('ignores a note typed before a status is chosen', async () => {
    const student = fixture.studentsA[0];
    const res = await client.post(`/api/v1/leagues/${fixture.leagueA.id}/discipline`, {
      date: DAY,
      records: [{ studentId: student.id, note: 'فقط توضیح' }],
    });
    expect(res.status).toBe(200);
    expect(res.body.applied).toBe(0);
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM discipline').get().n).toBe(0);
  });

  it('marks every student in one bulk call', async () => {
    const res = await client.post(`/api/v1/leagues/${fixture.leagueA.id}/discipline/bulk`, { date: DAY, status: 'orderly' });
    expect(res.status).toBe(200);
    expect(res.body.applied).toBe(3);
    expect(res.body.counters).toMatchObject({ orderly: 3, unmarked: 0 });
  });

  it('reports the orderly ratio per student and the daily history', async () => {
    const student = fixture.studentsA[0];
    for (const [day, status] of [['2026-08-08', 'orderly'], ['2026-08-09', 'disorderly'], ['2026-08-10', 'orderly']]) {
      await client.post(`/api/v1/leagues/${fixture.leagueA.id}/discipline`, {
        date: day,
        records: [{ studentId: student.id, status }],
      });
    }

    const sheet = await client.get(`/api/v1/leagues/${fixture.leagueA.id}/discipline?date=${DAY}`);
    const row = sheet.body.items.find((item) => item.studentId === student.id);
    expect(row).toMatchObject({ recorded: 3, orderly: 2, disorderly: 1 });

    const history = await client.get(`/api/v1/leagues/${fixture.leagueA.id}/discipline/history`);
    expect(history.body.total).toBe(3);
    expect(history.body.items[0]).toMatchObject({ day: DAY, orderly: 1, disorderly: 0, total: 1 });
  });

  it('does not touch league scores', async () => {
    await client.post(`/api/v1/leagues/${fixture.leagueA.id}/discipline/bulk`, { date: DAY, status: 'disorderly' });
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM score_history').get().n).toBe(0);
  });

  it('is private to the owning league', async () => {
    const other = createClient(ctx.db);
    await other.login('teacher-b', 'password-b1');
    const res = await other.get(`/api/v1/leagues/${fixture.leagueA.id}/discipline?date=${DAY}`);
    expect(res.status).toBe(403);
  });
});
