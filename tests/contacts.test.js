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

describe('parent and student contact numbers', () => {
  it('lists every student with empty numbers and the login flag', async () => {
    const res = await client.get(`/api/v1/leagues/${fixture.leagueA.id}/contacts`);
    expect(res.status).toBe(200);
    expect(res.body.league.name).toBe('لیگ الف');
    expect(res.body.items).toHaveLength(3);
    expect(res.body.items[0]).toMatchObject({
      id: fixture.studentsA[0].id,
      name: 'آرش آزمون',
      parentPhone: '',
      studentPhone: '',
      shadPvUrl: '',
      hasLogin: true,
      hasParentPhone: false,
      hasShadPvUrl: false,
    });
    expect(res.body.items[1].hasLogin).toBe(false);
  });

  it('normalizes Persian digits and the +98 prefix before storing', async () => {
    const studentId = fixture.studentsA[0].id;
    const res = await client.patch(`/api/v1/leagues/${fixture.leagueA.id}/contacts/${studentId}`, {
      parentPhone: '۰۹۱۲۳۴۵۶۷۸۹',
      studentPhone: '+98 912 111 2233',
    });
    expect(res.status).toBe(200);
    expect(res.body.student.parentPhone).toBe('09123456789');
    expect(res.body.student.studentPhone).toBe('09121112233');
    expect(res.body.student.hasParentPhone).toBe(true);

    const stored = ctx.db.prepare('SELECT parent_phone, student_phone FROM students WHERE id = ?').get(studentId);
    expect(stored).toEqual({ parent_phone: '09123456789', student_phone: '09121112233' });
  });

  it('rejects a malformed number without touching the stored one', async () => {
    const studentId = fixture.studentsA[0].id;
    await client.patch(`/api/v1/leagues/${fixture.leagueA.id}/contacts/${studentId}`, { parentPhone: '09120000000', studentPhone: '' });

    const res = await client.patch(`/api/v1/leagues/${fixture.leagueA.id}/contacts/${studentId}`, { parentPhone: '12345', studentPhone: '' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_MOBILE');

    const stored = ctx.db.prepare('SELECT parent_phone FROM students WHERE id = ?').get(studentId);
    expect(stored.parent_phone).toBe('09120000000');
  });

  it('clears a number when an empty value is sent', async () => {
    const studentId = fixture.studentsA[1].id;
    await client.patch(`/api/v1/leagues/${fixture.leagueA.id}/contacts/${studentId}`, { parentPhone: '09120000000', studentPhone: '09121112233' });
    const res = await client.patch(`/api/v1/leagues/${fixture.leagueA.id}/contacts/${studentId}`, { parentPhone: '', studentPhone: '' });
    expect(res.status).toBe(200);
    expect(res.body.student.parentPhone).toBe('');
    expect(res.body.student.studentPhone).toBe('');
    expect(res.body.student.hasParentPhone).toBe(false);
  });

  it('hides the numbers from other teachers and from students', async () => {
    const other = createClient(ctx.db);
    await other.login('teacher-b', 'password-b1');
    const foreign = await other.get(`/api/v1/leagues/${fixture.leagueA.id}/contacts`);
    expect(foreign.status).toBe(403);

    const student = createClient(ctx.db);
    await student.login('student-a', 'student-a1');
    const forbidden = await student.get(`/api/v1/leagues/${fixture.leagueA.id}/contacts`);
    expect(forbidden.status).toBe(403);
  });

  it('stores a valid Shad PV link and rejects dangerous protocols', async () => {
    const studentId = fixture.studentsA[0].id;
    const saved = await client.patch(`/api/v1/leagues/${fixture.leagueA.id}/contacts/${studentId}`, {
      parentPhone: '09120000000',
      studentPhone: '',
      shadPvUrl: ' https://web.shad.ir/#/pv/abc ',
    });
    expect(saved.status).toBe(200);
    expect(saved.body.student.shadPvUrl).toBe('https://web.shad.ir/#/pv/abc');
    expect(saved.body.student.hasShadPvUrl).toBe(true);
    expect(saved.body.student.parentPhone).toBe('09120000000');

    // A phone-only update keeps the stored link.
    await client.patch(`/api/v1/leagues/${fixture.leagueA.id}/contacts/${studentId}`, {
      parentPhone: '09120000001',
      studentPhone: '',
    });
    const kept = await client.get(`/api/v1/leagues/${fixture.leagueA.id}/contacts`);
    expect(kept.body.items[0].shadPvUrl).toBe('https://web.shad.ir/#/pv/abc');

    const unsafe = await client.patch(`/api/v1/leagues/${fixture.leagueA.id}/contacts/${studentId}`, {
      parentPhone: '09120000001',
      studentPhone: '',
      shadPvUrl: 'javascript:alert(1)',
    });
    expect(unsafe.status).toBe(400);
    expect(unsafe.body.error.code).toBe('INVALID_SHAD_URL');

    const cleared = await client.patch(`/api/v1/leagues/${fixture.leagueA.id}/contacts/${studentId}`, {
      parentPhone: '09120000001',
      studentPhone: '',
      shadPvUrl: '',
    });
    expect(cleared.status).toBe(200);
    expect(cleared.body.student.shadPvUrl).toBe('');
    expect(cleared.body.student.hasShadPvUrl).toBe(false);
  });
});
