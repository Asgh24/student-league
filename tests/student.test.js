import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildFixture } from './fixtures.js';
import { createClient, createTestDatabase } from './helpers.js';

let ctx;
let fixture;
let teacher;
let student;

beforeEach(async () => {
  ctx = createTestDatabase();
  fixture = buildFixture(ctx.db);
  teacher = createClient(ctx.db);
  await teacher.login('teacher-a', 'password-a1');
  student = createClient(ctx.db);
  await student.login('student-a', 'student-a1');
});

afterEach(() => {
  ctx.cleanup();
});

async function give(studentId, delta, reason = '') {
  const res = await teacher.post(`/api/v1/leagues/${fixture.leagueA.id}/scores/commit`, {
    studentId,
    changes: [{ columnId: fixture.columnsA[0].id, delta }],
    reason,
  });
  expect(res.status).toBe(200);
}

describe('student portal', () => {
  it('reports the identity and league of the logged in student', async () => {
    const res = await student.get('/api/v1/student/me');
    expect(res.status).toBe(200);
    expect(res.body.student.name).toBe('آرش آزمون');
    expect(res.body.student.leagueName).toBe('لیگ الف');
  });

  it('builds the dashboard with points, rank, medals and a chart series', async () => {
    await give(fixture.studentsA[1].id, 500);
    await give(fixture.studentsA[0].id, 100, 'مشارکت');
    await give(fixture.studentsA[0].id, 50, 'تمرین');

    const res = await student.get('/api/v1/student/dashboard');
    expect(res.status).toBe(200);
    expect(res.body.points).toBe(150);
    expect(res.body.rank).toBe(2);
    expect(res.body.totalStudents).toBe(3);
    expect(res.body.championships).toBe(0);
    expect(res.body.series.start).toBe(0);
    expect(res.body.series.points.map((p) => p.total)).toEqual([100, 150]);
    expect(res.body.series.points[0].reason).toBe('مشارکت');
    expect(res.body.title.title).toBe('جنگجو');
  });

  it('lists the report card per score column', async () => {
    await give(fixture.studentsA[0].id, 75);
    const res = await student.get('/api/v1/student/report-card');
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(8);
    expect(res.body.items[0].name).toBe('ریاضی');
    expect(res.body.items[0].value).toBe(75);
    expect(res.body.total).toBe(75);
  });

  it('rates a recorded change from its size relative to the subject step', async () => {
    await give(fixture.studentsA[0].id, 50, 'هفته ۴');
    const full = await student.get('/api/v1/student/report-card');
    expect(full.body.sessionCount).toBe(1);
    expect(full.body.sessions[0].columnName).toBe('ریاضی');
    expect(full.body.sessions[0].topic).toBe('هفته ۴');
    expect(full.body.sessions[0].delta).toBe(50);
    expect(full.body.sessions[0].quality).toEqual({ key: 'excellent', label: 'عالی', icon: '🌟' });

    await give(fixture.studentsA[0].id, 15, 'تمرین');
    const small = await student.get('/api/v1/student/report-card');
    expect(small.body.sessions[0].quality.key).toBe('good');
    expect(small.body.sessions[0].totalAfter).toBe(65);
  });

  it('reports a negative change without rating it', async () => {
    await give(fixture.studentsA[0].id, -5, 'بی‌نظمی');
    const res = await student.get('/api/v1/student/report-card');
    expect(res.body.sessions[0].quality.key).toBe('negative');
    expect(res.body.sessions[0].quality.label).toBe('کسر امتیاز');
  });

  it('filters the sessions by subject while keeping every column total', async () => {
    const commit = await teacher.post(`/api/v1/leagues/${fixture.leagueA.id}/scores/commit`, {
      studentId: fixture.studentsA[0].id,
      changes: [
        { columnId: fixture.columnsA[0].id, delta: 25 },
        { columnId: fixture.columnsA[1].id, delta: 25 },
      ],
      reason: 'تمرین کلاسی',
    });
    expect(commit.status).toBe(200);

    const all = await student.get('/api/v1/student/report-card');
    expect(all.body.sessionCount).toBe(2);

    const filtered = await student.get(`/api/v1/student/report-card?columnId=${fixture.columnsA[1].id}`);
    expect(filtered.body.sessionCount).toBe(1);
    expect(filtered.body.sessions[0].columnName).toBe('فارسی');
    expect(filtered.body.filters.columnId).toBe(fixture.columnsA[1].id);
    expect(filtered.body.items).toHaveLength(8);
    expect(filtered.body.total).toBe(50);
  });

  it('filters the sessions by a Gregorian date range', async () => {
    const insert = ctx.db.prepare(`
      INSERT INTO score_history
        (league_id, student_id, column_id, column_name, delta, reason, actor_name, total_after, created_at)
      VALUES (?, ?, ?, 'ریاضی', 25, ?, '', 0, ?)
    `);
    const studentId = fixture.studentsA[0].id;
    insert.run(fixture.leagueA.id, studentId, fixture.columnsA[0].id, 'قدیمی', '2026-01-10T09:00:00.000Z');
    insert.run(fixture.leagueA.id, studentId, fixture.columnsA[0].id, 'جدید', '2026-02-10T09:00:00.000Z');

    const res = await student.get('/api/v1/student/report-card?from=2026-02-01&to=2026-02-28');
    expect(res.status).toBe(200);
    expect(res.body.sessionCount).toBe(1);
    expect(res.body.sessions[0].topic).toBe('جدید');

    const empty = await student.get('/api/v1/student/report-card?from=2025-01-01&to=2025-01-31');
    expect(empty.body.sessionCount).toBe(0);
    expect(empty.body.sessions).toEqual([]);
  });

  it('rejects malformed report card filters', async () => {
    const badDate = await student.get('/api/v1/student/report-card?from=2026/02/01');
    expect(badDate.status).toBe(400);
    expect(badDate.body.error.code).toBe('VALIDATION_ERROR');

    const badId = await student.get('/api/v1/student/report-card?columnId=abc');
    expect(badId.status).toBe(400);
    expect(badId.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('shows the grade configured on the league', async () => {
    const saved = await teacher.put(`/api/v1/leagues/${fixture.leagueA.id}/settings`, { grade: 'ششم' });
    expect(saved.status).toBe(200);
    expect(saved.body.settings.grade).toBe('ششم');

    const res = await student.get('/api/v1/student/report-card');
    expect(res.body.grade).toBe('ششم');

    const detail = await teacher.get(`/api/v1/leagues/${fixture.leagueA.id}`);
    expect(detail.body.settings.grade).toBe('ششم');
  });

  it('exposes only its own attendance with a summary', async () => {
    await teacher.post(`/api/v1/leagues/${fixture.leagueA.id}/attendance`, {
      date: '2026-08-09',
      records: [
        { studentId: fixture.studentsA[0].id, status: 'present' },
        { studentId: fixture.studentsA[1].id, status: 'absent' },
      ],
    });
    const res = await student.get('/api/v1/student/attendance');
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.summary.present).toBe(1);
    expect(res.body.summary.absent).toBe(0);
  });

  it('shows the personal history with pagination and a timeline', async () => {
    await give(fixture.studentsA[0].id, 10);
    await give(fixture.studentsA[0].id, -5);
    const res = await student.get('/api/v1/student/history');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.items[0].delta).toBe(-5);
    expect(res.body.series.points.map((p) => p.total)).toEqual([10, 5]);

    const timeline = await student.get('/api/v1/student/timeline?page=1&limit=1');
    expect(timeline.body.page).toBe(1);
    expect(timeline.body.items).toHaveLength(1);
  });

  it('reports the team and its rank', async () => {
    await teacher.post(`/api/v1/leagues/${fixture.leagueA.id}/teams/assign`, {
      teamId: fixture.teamsA[0].id,
      studentId: fixture.studentsA[0].id,
    });
    const res = await student.get('/api/v1/student/team');
    expect(res.status).toBe(200);
    expect(res.body.team.name).toBe('تیم آبی');
    expect(res.body.members).toHaveLength(1);
    expect(res.body.rank).toBe(1);
  });

  it('returns an empty team payload when unassigned', async () => {
    const res = await student.get('/api/v1/student/team');
    expect(res.body.team).toBeNull();
    expect(res.body.members).toEqual([]);
  });

  it('lets a student like classmates up to the daily limit', async () => {
    const first = await student.post('/api/v1/student/likes', { toStudentId: fixture.studentsA[1].id, achievement: 'بهترین تمرین' });
    expect(first.status).toBe(201);
    expect(first.body.remainingToday).toBe(9);

    const self = await student.post('/api/v1/student/likes', { toStudentId: fixture.studentsA[0].id, achievement: '' });
    expect(self.status).toBe(400);
    expect(self.body.error.code).toBe('SELF_LIKE');

    const state = await student.get('/api/v1/student/likes');
    expect(state.body.givenToday).toBe(1);
    expect(state.body.dailyLimit).toBe(10);
    expect(state.body.given[0].toName).toBe('بهار بنفش');
  });

  it('enforces the daily like quota', async () => {
    process.env.LIKES_PER_DAY = '2';
    try {
      const limited = createClient(ctx.db);
      await limited.login('student-a', 'student-a1');
      await limited.post('/api/v1/student/likes', { toStudentId: fixture.studentsA[1].id });
      await limited.post('/api/v1/student/likes', { toStudentId: fixture.studentsA[2].id });
      const third = await limited.post('/api/v1/student/likes', { toStudentId: fixture.studentsA[1].id });
      expect(third.status).toBe(429);
    } finally {
      delete process.env.LIKES_PER_DAY;
    }
  });

  it('shows classmates with rank and points only', async () => {
    await give(fixture.studentsA[1].id, 100);
    const res = await student.get('/api/v1/student/classmates');
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(3);
    const me = res.body.items.find((i) => i.isMe);
    expect(me.name).toBe('آرش آزمون');
    const keys = Object.keys(res.body.items[0]).sort();
    expect(keys).toEqual(['isMe', 'name', 'rank', 'studentId', 'title', 'total']);
  });

  it('lets the student toggle Persian digits', async () => {
    const res = await student.patch('/api/v1/student/settings', { persianDigits: false });
    expect(res.status).toBe(200);
    expect(res.body.persianDigits).toBe(false);
    const me = await student.get('/api/v1/student/me');
    expect(me.body.user.persianDigits).toBe(false);
  });

  it('lists homework with the student own status', async () => {
    const created = await teacher.post(`/api/v1/leagues/${fixture.leagueA.id}/homework`, { title: 'تکلیف شب', description: 'تمرین ۳' });
    await teacher.post(`/api/v1/homework/${created.body.homework.id}/status`, { studentId: fixture.studentsA[0].id, status: 'done' });
    const res = await student.get('/api/v1/student/homework');
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].status).toBe('done');
    expect(res.body.items[0].description).toBe('تمرین ۳');
  });

  it('sees open questions and reads the weekly schedule and files', async () => {
    await teacher.post(`/api/v1/leagues/${fixture.leagueA.id}/questions`, { body: 'پرسش کلاسی', points: 5 });
    await teacher.put(`/api/v1/leagues/${fixture.leagueA.id}/schedule`, { slots: [{ dayIndex: 0, period: 0, subject: 'ریاضی' }] });
    await teacher.upload(`/api/v1/leagues/${fixture.leagueA.id}/files`, {
      filename: 'help.pdf',
      buffer: Buffer.from('%PDF-1.4\n%%EOF\n'),
      contentType: 'application/pdf',
    });

    const questions = await student.get('/api/v1/student/questions');
    expect(questions.body.items[0].body).toBe('پرسش کلاسی');
    expect(questions.body.items[0].myAnswer).toBeNull();

    const schedule = await student.get('/api/v1/student/schedule');
    expect(schedule.body.slots).toHaveLength(1);

    const files = await student.get('/api/v1/student/files');
    expect(files.body.items[0].originalName).toBe('help.pdf');
  });

  it('records a championship and surfaces it in the medals section', async () => {
    await teacher.post(`/api/v1/students/${fixture.studentsA[0].id}/championships`, { title: 'قهرمان مسابقه', rank: 1 });
    const res = await student.get('/api/v1/student/medals');
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].title).toBe('قهرمان مسابقه');

    const removed = await teacher.del(`/api/v1/students/${fixture.studentsA[0].id}/championships`);
    expect(removed.status).toBe(200);
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM championships').get().n).toBe(0);
  });
});
