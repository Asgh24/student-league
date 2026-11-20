import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildFixture, STUDENT_A, TEACHER_A, TEACHER_B } from './fixtures.js';
import { createClient, createTestDatabase } from './helpers.js';

let ctx;
let fixture;
let teacher;

beforeEach(async () => {
  ctx = createTestDatabase();
  fixture = buildFixture(ctx.db);
  teacher = createClient(ctx.db);
  await teacher.login(TEACHER_A.username, TEACHER_A.password);
});

afterEach(() => ctx.cleanup());

describe('persistent student roster', () => {
  it('creates a new league with the old roster while keeping competition data separate', async () => {
    const sourceStudent = fixture.studentsA[0];
    const sourceColumn = fixture.columnsA[0];
    ctx.db.prepare(`
      INSERT INTO scores (league_id, student_id, column_id, value, updated_at)
      VALUES (?, ?, ?, 175, ?)
    `).run(fixture.leagueA.id, sourceStudent.id, sourceColumn.id, new Date().toISOString());
    ctx.db.prepare(`
      UPDATE students SET parent_phone = '09123456789', student_phone = '09121112222'
      WHERE id = ?
    `).run(sourceStudent.id);

    const created = await teacher.post('/api/v1/leagues', {
      name: 'لیگ تازه',
      sourceLeagueId: fixture.leagueA.id,
    });
    expect(created.status).toBe(201);
    expect(created.body.transfer).toMatchObject({ sourceCount: 3, imported: 3, skipped: 0 });
    const targetId = created.body.league.id;

    const target = await teacher.get(`/api/v1/leagues/${targetId}/students`);
    expect(target.status).toBe(200);
    expect(target.body.items).toHaveLength(3);
    expect(target.body.items.every((student) => student.total === 0)).toBe(true);
    const copied = target.body.items.find((student) => student.name === sourceStudent.name);
    expect(copied).toBeDefined();

    const oldScore = ctx.db.prepare('SELECT value FROM scores WHERE student_id = ? AND column_id = ?')
      .get(sourceStudent.id, sourceColumn.id);
    expect(oldScore.value).toBe(175);
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM students WHERE league_id = ?').get(fixture.leagueA.id).n).toBe(3);

    const copiedRow = ctx.db.prepare('SELECT * FROM students WHERE id = ?').get(copied.id);
    expect(copiedRow.parent_phone).toBe('09123456789');
    expect(copiedRow.student_phone).toBe('09121112222');
    expect(copiedRow.user_id).toBe(fixture.studentUserA.id);
    expect(ctx.db.prepare('SELECT user_id FROM students WHERE id = ?').get(sourceStudent.id).user_id).toBeNull();

    const student = createClient(ctx.db);
    expect((await student.login(STUDENT_A.username, STUDENT_A.password)).status).toBe(200);
    const dashboard = await student.get('/api/v1/student/dashboard');
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.leagueId).toBe(targetId);
    expect(dashboard.body.points).toBe(0);
  });

  it('lists one durable profile with both memberships and skips duplicate imports', async () => {
    const target = await teacher.post('/api/v1/leagues', { name: 'لیگ دوم' });
    const targetId = target.body.league.id;
    const first = await teacher.post(`/api/v1/leagues/${targetId}/students/import`, {
      sourceLeagueId: fixture.leagueA.id,
    });
    expect(first.status).toBe(200);
    expect(first.body.result.imported).toBe(3);

    const second = await teacher.post(`/api/v1/leagues/${targetId}/students/import`, {
      sourceLeagueId: fixture.leagueA.id,
    });
    expect(second.status).toBe(200);
    expect(second.body.result).toMatchObject({ imported: 0, skipped: 3 });

    const roster = await teacher.get('/api/v1/students/roster');
    expect(roster.status).toBe(200);
    expect(roster.body.items).toHaveLength(3);
    const profile = roster.body.items.find((item) => item.name === fixture.studentsA[0].name);
    expect(profile.memberships).toHaveLength(2);
    expect(profile.memberships.find((item) => item.leagueId === targetId).currentLogin).toBe(true);
  });

  it('does not import a league owned by another teacher', async () => {
    const target = await teacher.post('/api/v1/leagues', { name: 'لیگ امن' });
    const response = await teacher.post(`/api/v1/leagues/${target.body.league.id}/students/import`, {
      sourceLeagueId: fixture.leagueB.id,
    });
    expect(response.status).toBe(403);

    const other = createClient(ctx.db);
    await other.login(TEACHER_B.username, TEACHER_B.password);
    const otherRoster = await other.get('/api/v1/students/roster');
    expect(otherRoster.status).toBe(200);
    expect(otherRoster.body.items).toHaveLength(1);
  });

  it('keeps the copied students and their login after the old league is deleted', async () => {
    const target = await teacher.post('/api/v1/leagues', {
      name: 'لیگ بعدی',
      sourceLeagueId: fixture.leagueA.id,
    });
    const targetId = target.body.league.id;

    const removed = await teacher.del(`/api/v1/leagues/${fixture.leagueA.id}`);
    expect(removed.status).toBe(200);
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM students WHERE league_id = ?').get(targetId).n).toBe(3);
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM student_profiles WHERE teacher_id = ?').get(fixture.teacherA.id).n).toBe(3);

    const student = createClient(ctx.db);
    expect((await student.login(STUDENT_A.username, STUDENT_A.password)).status).toBe(200);
    const me = await student.get('/api/v1/student/me');
    expect(me.status).toBe(200);
    expect(me.body.student.leagueId).toBe(targetId);
  });

  it('copies contact edits made after the persistent profile is created', async () => {
    // Reading the roster upgrades direct legacy fixture rows into profiles.
    expect((await teacher.get('/api/v1/students/roster')).status).toBe(200);
    const sourceStudent = fixture.studentsA[0];
    const contact = await teacher.patch(
      `/api/v1/leagues/${fixture.leagueA.id}/contacts/${sourceStudent.id}`,
      {
        parentPhone: '09123456789',
        studentPhone: '09121112222',
        shadPvUrl: 'https://web.shad.ir/#/pv/parent-example',
      },
    );
    expect(contact.status).toBe(200);

    const target = await teacher.post('/api/v1/leagues', {
      name: 'لیگ تماس‌ها',
      sourceLeagueId: fixture.leagueA.id,
    });
    const copied = ctx.db.prepare(`
      SELECT parent_phone, student_phone, shad_pv_url
      FROM students WHERE league_id = ? AND name = ?
    `).get(target.body.league.id, sourceStudent.name);
    expect(copied).toEqual({
      parent_phone: '09123456789',
      student_phone: '09121112222',
      shad_pv_url: 'https://web.shad.ir/#/pv/parent-example',
    });
  });

  it('moves parent-phone credentials to the new membership and disables sync on the old row', async () => {
    await teacher.get('/api/v1/students/roster');
    const sourceStudent = fixture.studentsA[0];
    await teacher.patch(`/api/v1/leagues/${fixture.leagueA.id}/contacts/${sourceStudent.id}`, {
      parentPhone: '09123456789',
      studentPhone: '',
      shadPvUrl: '',
    });
    const enabled = await teacher.put(`/api/v1/students/${sourceStudent.id}/credentials`, {
      useParentPhone: true,
    });
    expect(enabled.status).toBe(200);

    const target = await teacher.post('/api/v1/leagues', {
      name: 'لیگ ورود والد',
      sourceLeagueId: fixture.leagueA.id,
    });
    const sourceRow = ctx.db.prepare('SELECT user_id, credentials_from_parent FROM students WHERE id = ?').get(sourceStudent.id);
    const targetRow = ctx.db.prepare(`
      SELECT user_id, credentials_from_parent FROM students
      WHERE league_id = ? AND name = ?
    `).get(target.body.league.id, sourceStudent.name);
    expect(sourceRow).toEqual({ user_id: null, credentials_from_parent: 0 });
    expect(targetRow.user_id).toBe(fixture.studentUserA.id);
    expect(targetRow.credentials_from_parent).toBe(1);

    const student = createClient(ctx.db);
    expect((await student.login('09123456789', '09123456789')).status).toBe(200);
    expect((await student.get('/api/v1/student/me')).body.student.leagueId).toBe(target.body.league.id);
  });

  it('rolls back league creation when the selected source belongs to another teacher', async () => {
    const before = ctx.db.prepare('SELECT COUNT(*) AS n FROM leagues WHERE teacher_id = ?').get(fixture.teacherA.id).n;
    const response = await teacher.post('/api/v1/leagues', {
      name: 'نباید ساخته شود',
      sourceLeagueId: fixture.leagueB.id,
    });
    expect(response.status).toBe(403);
    const after = ctx.db.prepare('SELECT COUNT(*) AS n FROM leagues WHERE teacher_id = ?').get(fixture.teacherA.id).n;
    expect(after).toBe(before);
  });

  it('rejects the same source and target and refuses a completed target', async () => {
    const same = await teacher.post(`/api/v1/leagues/${fixture.leagueA.id}/students/import`, {
      sourceLeagueId: fixture.leagueA.id,
    });
    expect(same.status).toBe(400);
    expect(same.body.error.code).toBe('SAME_LEAGUE');

    const target = await teacher.post('/api/v1/leagues', { name: 'لیگ بسته' });
    await teacher.post(`/api/v1/leagues/${target.body.league.id}/complete`, {});
    const completed = await teacher.post(`/api/v1/leagues/${target.body.league.id}/students/import`, {
      sourceLeagueId: fixture.leagueA.id,
    });
    expect(completed.status).toBe(400);
    expect(completed.body.error.code).toBe('TARGET_COMPLETED');
  });
});
