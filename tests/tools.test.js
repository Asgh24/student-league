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

describe('homework', () => {
  it('creates an assignment and tracks per student completion', async () => {
    const created = await client.post(`/api/v1/leagues/${fixture.leagueA.id}/homework`, {
      title: 'تمرین ریاضی',
      description: 'صفحه ۱۲',
      dueDate: '2026-08-20',
    });
    expect(created.status).toBe(201);
    const homeworkId = created.body.homework.id;
    expect(created.body.homework.pendingCount).toBe(3);

    const mark = await client.post(`/api/v1/homework/${homeworkId}/status`, {
      studentId: fixture.studentsA[0].id,
      status: 'done',
    });
    expect(mark.status).toBe(200);
    expect(mark.body.items.find((i) => i.studentId === fixture.studentsA[0].id).status).toBe('done');

    const list = await client.get(`/api/v1/leagues/${fixture.leagueA.id}/homework`);
    expect(list.body.items[0].doneCount).toBe(1);
    expect(list.body.items[0].pendingCount).toBe(2);
  });

  it('marks every student at once', async () => {
    const created = await client.post(`/api/v1/leagues/${fixture.leagueA.id}/homework`, { title: 'روخوانی', description: '' });
    const res = await client.post(`/api/v1/homework/${created.body.homework.id}/status/bulk`, { status: 'done' });
    expect(res.status).toBe(200);
    expect(res.body.items.every((i) => i.status === 'done')).toBe(true);
  });

  it('updates and deletes an assignment', async () => {
    const created = await client.post(`/api/v1/leagues/${fixture.leagueA.id}/homework`, { title: 'قدیمی' });
    const updated = await client.patch(`/api/v1/homework/${created.body.homework.id}`, { title: 'جدید' });
    expect(updated.body.homework.title).toBe('جدید');
    const removed = await client.del(`/api/v1/homework/${created.body.homework.id}`);
    expect(removed.status).toBe(200);
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM homework').get().n).toBe(0);
  });

  it('rejects a status update for a student of another league', async () => {
    const created = await client.post(`/api/v1/leagues/${fixture.leagueA.id}/homework`, { title: 'تمرین' });
    const res = await client.post(`/api/v1/homework/${created.body.homework.id}/status`, {
      studentId: fixture.studentsB[0].id,
      status: 'done',
    });
    expect(res.status).toBe(404);
  });
});

describe('questions and answers', () => {
  it('creates a question and collects a student answer', async () => {
    const created = await client.post(`/api/v1/leagues/${fixture.leagueA.id}/questions`, { body: '۲+۲ چند است؟', points: 10 });
    expect(created.status).toBe(201);
    const questionId = created.body.question.id;

    const student = createClient(ctx.db);
    await student.login('student-a', 'student-a1');
    const answer = await student.post(`/api/v1/student/questions/${questionId}/answers`, { body: 'چهار' });
    expect(answer.status).toBe(201);

    const list = await client.get(`/api/v1/questions/${questionId}/answers`);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].body).toBe('چهار');
  });

  it('awards points to the discipline column once and corrects them later', async () => {
    const created = await client.post(`/api/v1/leagues/${fixture.leagueA.id}/questions`, { body: 'سوال', points: 15 });
    const questionId = created.body.question.id;
    const student = createClient(ctx.db);
    await student.login('student-a', 'student-a1');
    await student.post(`/api/v1/student/questions/${questionId}/answers`, { body: 'پاسخ' });
    const answerId = ctx.db.prepare('SELECT id FROM answers WHERE question_id = ?').get(questionId).id;

    const first = await client.post(`/api/v1/answers/${answerId}/award`, { points: 30 });
    expect(first.status).toBe(200);
    expect(first.body.answer.delta).toBe(30);

    const corrected = await client.post(`/api/v1/answers/${answerId}/award`, { points: 30 });
    expect(corrected.body.answer.delta).toBe(0);
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM score_history').get().n).toBe(1);

    const revoked = await client.post(`/api/v1/answers/${answerId}/award`, { points: 0 });
    expect(revoked.body.answer.delta).toBe(-30);
    const total = ctx.db.prepare('SELECT COALESCE(SUM(value), 0) AS t FROM scores WHERE student_id = ?').get(fixture.studentsA[0].id).t;
    expect(total).toBe(0);
  });

  it('closes a question so students can no longer answer', async () => {
    const created = await client.post(`/api/v1/leagues/${fixture.leagueA.id}/questions`, { body: 'بسته شدنی' });
    await client.post(`/api/v1/questions/${created.body.question.id}/close`, {});
    const student = createClient(ctx.db);
    await student.login('student-a', 'student-a1');
    const res = await student.post(`/api/v1/student/questions/${created.body.question.id}/answers`, { body: 'دیر رسیدم' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('QUESTION_CLOSED');
  });
});

describe('weekly schedule', () => {
  it('saves and reads back the weekly grid', async () => {
    const res = await client.put(`/api/v1/leagues/${fixture.leagueA.id}/schedule`, {
      slots: [
        { dayIndex: 0, period: 0, subject: 'ریاضی', note: '' },
        { dayIndex: 0, period: 1, subject: 'فارسی', note: 'کتاب جدید' },
        { dayIndex: 1, period: 0, subject: '', note: '' },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.days).toHaveLength(7);
    expect(res.body.days[0].label).toBe('شنبه');
    expect(res.body.slots).toHaveLength(2);
  });

  it('replaces the grid instead of appending', async () => {
    await client.put(`/api/v1/leagues/${fixture.leagueA.id}/schedule`, { slots: [{ dayIndex: 0, period: 0, subject: 'ریاضی' }] });
    await client.put(`/api/v1/leagues/${fixture.leagueA.id}/schedule`, { slots: [{ dayIndex: 2, period: 3, subject: 'علوم' }] });
    const res = await client.get(`/api/v1/leagues/${fixture.leagueA.id}/schedule`);
    expect(res.body.slots).toHaveLength(1);
    expect(res.body.slots[0].subject).toBe('علوم');
  });
});

describe('league lifecycle', () => {
  it('creates, renames, reactivates and deletes leagues', async () => {
    const created = await client.post('/api/v1/leagues', { name: 'لیگ دوم' });
    expect(created.status).toBe(201);
    const id = created.body.league.id;

    const renamed = await client.patch(`/api/v1/leagues/${id}`, { name: 'لیگ دوم بازنویسی شده' });
    expect(renamed.body.league.name).toBe('لیگ دوم بازنویسی شده');

    const completed = await client.patch(`/api/v1/leagues/${id}`, { status: 'completed' });
    expect(completed.body.league.status).toBe('completed');

    const active = await client.patch(`/api/v1/leagues/${id}`, { status: 'active' });
    expect(active.body.league.status).toBe('active');

    const removed = await client.del(`/api/v1/leagues/${id}`);
    expect(removed.status).toBe(200);
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM leagues WHERE id = ?').get(id).n).toBe(0);
  });

  it('sets, adjusts and clears the league countdown timer', async () => {
    const set = await client.put(`/api/v1/leagues/${fixture.leagueA.id}/timer`, { days: 5, hours: 0, minutes: 0, seconds: 0 });
    expect(set.status).toBe(200);
    expect(set.body.timer.durationSeconds).toBe(5 * 86400);
    expect(set.body.timer.expired).toBe(false);

    const plus = await client.post(`/api/v1/leagues/${fixture.leagueA.id}/timer/adjust`, { days: 10 });
    expect(plus.body.timer.durationSeconds).toBe(5 * 86400);

    const minus = await client.post(`/api/v1/leagues/${fixture.leagueA.id}/timer/adjust`, { days: -1 });
    expect(new Date(minus.body.timer.endsAt).getTime()).toBeGreaterThan(new Date(set.body.timer.endsAt).getTime());

    const cleared = await client.del(`/api/v1/leagues/${fixture.leagueA.id}/timer`);
    expect(cleared.body.timer.endsAt).toBeNull();
  });

  it('rejects a timer with zero duration', async () => {
    const res = await client.put(`/api/v1/leagues/${fixture.leagueA.id}/timer`, { days: 0, hours: 0, minutes: 0, seconds: 0 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('TIMER_ZERO');
  });

  it('exposes the projector live board payload', async () => {
    const res = await client.get(`/api/v1/leagues/${fixture.leagueA.id}/live`);
    expect(res.status).toBe(200);
    expect(res.body.league.name).toBe('لیگ الف');
    expect(res.body.students).toHaveLength(3);
    expect(res.body.teams).toHaveLength(2);
  });
});
