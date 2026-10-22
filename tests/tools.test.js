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

/** Every new class question is multiple-choice (the legacy text flow is read-only). */
function mcq(body, points = 0, { options = ['گزینه یک', 'گزینه دو', 'گزینه سه'], correctIndex = 0 } = {}) {
  return { body, points, options, correctIndex };
}

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
  it('creates a multiple-choice question and collects the selected option', async () => {
    const created = await client.post(
      `/api/v1/leagues/${fixture.leagueA.id}/questions`,
      mcq('۲+۲ چند است؟', 10, { options: ['سه', 'چهار', 'پنج'], correctIndex: 1 }),
    );
    expect(created.status).toBe(201);
    expect(created.body.question).toMatchObject({
      type: 'multiple_choice',
      options: ['سه', 'چهار', 'پنج'],
      correctIndex: 1,
    });
    const questionId = created.body.question.id;

    const student = createClient(ctx.db);
    await student.login('student-a', 'student-a1');
    const missing = await student.post(`/api/v1/student/questions/${questionId}/answers`, {});
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe('VALIDATION_ERROR');

    const invalid = await student.post(`/api/v1/student/questions/${questionId}/answers`, { optionIndex: 3 });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('OPTION_INVALID');

    const answer = await student.post(`/api/v1/student/questions/${questionId}/answers`, { optionIndex: 1 });
    expect(answer.status).toBe(201);

    const list = await client.get(`/api/v1/questions/${questionId}/answers`);
    expect(list.body.question.correctIndex).toBe(1);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({
      body: 'چهار',
      selectedIndex: 1,
      isCorrect: true,
    });
  });

  it('never exposes the correct option to students but still returns the choices', async () => {
    const created = await client.post(
      `/api/v1/leagues/${fixture.leagueA.id}/questions`,
      mcq('پایتخت ایران؟', 5, { options: ['تهران', 'شیراز'], correctIndex: 0 }),
    );
    const student = createClient(ctx.db);
    await student.login('student-a', 'student-a1');
    await student.post(`/api/v1/student/questions/${created.body.question.id}/answers`, { optionIndex: 0 });

    const payload = await student.get('/api/v1/student/questions');
    const question = payload.body.items.find((item) => item.id === created.body.question.id);
    expect(question.options).toEqual(['تهران', 'شیراز']);
    expect(question.type).toBe('multiple_choice');
    expect(question.correctIndex).toBeUndefined();
    expect(question.myOptionIndex).toBe(0);
    expect(question.myAnswer).toBe('تهران');
  });

  it('rejects malformed multiple-choice questions', async () => {
    const url = `/api/v1/leagues/${fixture.leagueA.id}/questions`;
    const tooFew = await client.post(url, mcq('سؤال', 0, { options: ['یک'], correctIndex: 0 }));
    expect(tooFew.status).toBe(400);
    expect(tooFew.body.error.code).toBe('VALIDATION_ERROR');

    const badCorrect = await client.post(url, mcq('سؤال', 0, { correctIndex: 9 }));
    expect(badCorrect.status).toBe(400);
    expect(badCorrect.body.error.code).toBe('VALIDATION_ERROR');

    const blank = await client.post(url, mcq('سؤال', 0, { options: ['یک', ' '], correctIndex: 0 }));
    expect(blank.status).toBe(400);
    expect(blank.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('keeps legacy free-text questions answerable', async () => {
    const info = ctx.db.prepare(`
      INSERT INTO questions (league_id, teacher_id, body, points, is_open, created_at)
      VALUES (?, ?, ?, 5, 1, ?)
    `).run(fixture.leagueA.id, fixture.teacherA.id, 'پرسش قدیمی', new Date().toISOString());
    const student = createClient(ctx.db);
    await student.login('student-a', 'student-a1');
    const answer = await student.post(`/api/v1/student/questions/${info.lastInsertRowid}/answers`, { body: 'پاسخ متنی' });
    expect(answer.status).toBe(201);

    const payload = await student.get('/api/v1/student/questions');
    const question = payload.body.items.find((item) => item.id === Number(info.lastInsertRowid));
    expect(question.type).toBe('text');
    expect(question.options).toEqual([]);
    expect(question.myAnswer).toBe('پاسخ متنی');
  });

  it('awards points to the discipline column once and corrects them later', async () => {
    const created = await client.post(`/api/v1/leagues/${fixture.leagueA.id}/questions`, mcq('سوال', 15));
    const questionId = created.body.question.id;
    const student = createClient(ctx.db);
    await student.login('student-a', 'student-a1');
    await student.post(`/api/v1/student/questions/${questionId}/answers`, { optionIndex: 1 });
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

  it('runs a presentation quiz, scores it and awards the question points once', async () => {
    const first = await client.post(`/api/v1/leagues/${fixture.leagueA.id}/questions`, mcq('پایتخت ایران؟', 10));
    const second = await client.post(`/api/v1/leagues/${fixture.leagueA.id}/questions`, mcq('۲×۳؟', 20));
    const third = await client.post(`/api/v1/leagues/${fixture.leagueA.id}/questions`, mcq('آب چیست؟', 30));

    const res = await client.post(`/api/v1/leagues/${fixture.leagueA.id}/quiz-sessions`, {
      studentId: fixture.studentsA[0].id,
      items: [
        { questionId: first.body.question.id, correct: true },
        { questionId: second.body.question.id, correct: false },
        { questionId: third.body.question.id, correct: true },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.session.total).toBe(3);
    expect(res.body.session.correct).toBe(2);
    expect(res.body.session.percent).toBe(67);
    expect(res.body.session.awardedPoints).toBe(40);
    expect(res.body.session.studentName).toBe(fixture.studentsA[0].name);
    expect(res.body.session.items.map((item) => item.correct)).toEqual([true, false, true]);
    expect(res.body.pointsApplied).toBe(true);

    const discipline = ctx.db
      .prepare('SELECT id FROM columns WHERE league_id = ? AND name = ?')
      .get(fixture.leagueA.id, 'انضباطی');
    const points = ctx.db
      .prepare('SELECT COALESCE(SUM(value), 0) AS total FROM scores WHERE student_id = ? AND column_id = ?')
      .get(fixture.studentsA[0].id, discipline.id);
    expect(points.total).toBe(40);

    const history = ctx.db.prepare('SELECT reason FROM score_history ORDER BY id DESC LIMIT 1').get();
    expect(history.reason).toContain('2 از 3');
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM quiz_sessions').get().n).toBe(1);

    const list = await client.get(`/api/v1/leagues/${fixture.leagueA.id}/questions`);
    expect(list.body.recent).toHaveLength(1);
    expect(list.body.recent[0].correct).toBe(2);
    expect(list.body.recent[0].awardedPoints).toBe(40);
  });

  it('validates a presentation quiz and rejects foreign rows', async () => {
    const own = await client.post(`/api/v1/leagues/${fixture.leagueA.id}/questions`, mcq('سؤال خودی', 5));
    const foreign = ctx.db
      .prepare('INSERT INTO questions (league_id, body, points, is_open, created_at) VALUES (?, ?, ?, 1, ?)')
      .run(fixture.leagueB.id, 'سؤال غریبه', 5, new Date().toISOString());

    const empty = await client.post(`/api/v1/leagues/${fixture.leagueA.id}/quiz-sessions`, {
      studentId: fixture.studentsA[0].id,
      items: [],
    });
    expect(empty.status).toBe(400);

    const duplicate = await client.post(`/api/v1/leagues/${fixture.leagueA.id}/quiz-sessions`, {
      studentId: fixture.studentsA[0].id,
      items: [
        { questionId: own.body.question.id, correct: true },
        { questionId: own.body.question.id, correct: true },
      ],
    });
    expect(duplicate.status).toBe(400);
    expect(duplicate.body.error.code).toBe('DUPLICATE_QUESTION');

    const foreignQuestion = await client.post(`/api/v1/leagues/${fixture.leagueA.id}/quiz-sessions`, {
      studentId: fixture.studentsA[0].id,
      items: [{ questionId: Number(foreign.lastInsertRowid), correct: true }],
    });
    expect(foreignQuestion.status).toBe(400);
    expect(foreignQuestion.body.error.code).toBe('QUESTION_NOT_FOUND');

    const foreignStudent = await client.post(`/api/v1/leagues/${fixture.leagueA.id}/quiz-sessions`, {
      studentId: fixture.studentsB[0].id,
      items: [{ questionId: own.body.question.id, correct: true }],
    });
    expect(foreignStudent.status).toBe(404);

    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM quiz_sessions').get().n).toBe(0);
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM scores').get().n).toBe(0);
  });

  it('hides presentation quizzes from other teachers', async () => {
    const question = await client.post(`/api/v1/leagues/${fixture.leagueA.id}/questions`, mcq('سؤال', 5));
    const other = createClient(ctx.db);
    await other.login('teacher-b', 'password-b1');
    const denied = await other.post(`/api/v1/leagues/${fixture.leagueA.id}/quiz-sessions`, {
      studentId: fixture.studentsA[0].id,
      items: [{ questionId: question.body.question.id, correct: true }],
    });
    expect(denied.status).toBe(403);

    const student = createClient(ctx.db);
    await student.login('student-a', 'student-a1');
    const forbidden = await student.get(`/api/v1/leagues/${fixture.leagueA.id}/quiz-sessions`);
    expect(forbidden.status).toBe(403);
  });

  it('closes a question so students can no longer answer', async () => {
    const created = await client.post(`/api/v1/leagues/${fixture.leagueA.id}/questions`, mcq('بسته شدنی'));
    await client.post(`/api/v1/questions/${created.body.question.id}/close`, {});
    const student = createClient(ctx.db);
    await student.login('student-a', 'student-a1');
    const res = await student.post(`/api/v1/student/questions/${created.body.question.id}/answers`, { optionIndex: 0 });
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
