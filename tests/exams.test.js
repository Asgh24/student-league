import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildFixture } from './fixtures.js';
import { createClient, createTestDatabase } from './helpers.js';

let ctx;
let fixture;
let teacher;
let student;
let otherTeacher;

function mcq(body, points = 10, correctIndex = 0) {
  return {
    body,
    points,
    options: ['گزینه الف', 'گزینه ب', 'گزینه ج'],
    correctIndex,
  };
}

async function createQuestion(body, points = 10, correctIndex = 0) {
  const res = await teacher.post(`/api/v1/leagues/${fixture.leagueA.id}/questions`, mcq(body, points, correctIndex));
  expect(res.status).toBe(201);
  return res.body.question;
}

async function createExam(overrides = {}) {
  const first = await createQuestion('دو به علاوه دو چند است؟', 10, 2);
  const second = await createQuestion('پایتخت ایران کجاست؟', 15, 0);
  const res = await teacher.post(`/api/v1/leagues/${fixture.leagueA.id}/exams`, {
    title: 'آزمون میان‌ترم',
    description: 'فصل اول',
    subject: 'ریاضی',
    durationMinutes: 30,
    passPercent: 50,
    maxAttempts: 2,
    rewardPoints: 100,
    shuffleQuestions: false,
    shuffleOptions: false,
    showAnswers: true,
    questionIds: [first.id, second.id],
    ...overrides,
  });
  return { res, first, second };
}

beforeEach(async () => {
  ctx = createTestDatabase();
  fixture = buildFixture(ctx.db);
  teacher = createClient(ctx.db);
  otherTeacher = createClient(ctx.db);
  student = createClient(ctx.db);
  await teacher.login('teacher-a', 'password-a1');
  await otherTeacher.login('teacher-b', 'password-b1');
  await student.login('student-a', 'student-a1');
});

afterEach(() => {
  ctx.cleanup();
});

describe('exam authoring', () => {
  it('creates a draft exam, lists it with stats and publishes it', async () => {
    const { res } = await createExam();
    expect(res.status).toBe(201);
    expect(res.body.exam.status).toBe('draft');
    expect(res.body.exam.questionCount).toBe(2);
    expect(res.body.questions).toHaveLength(2);
    expect(res.body.questions[0].correctIndex).toBeTypeOf('number');

    const list = await teacher.get(`/api/v1/leagues/${fixture.leagueA.id}/exams`);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.stats.drafts).toBe(1);

    const published = await teacher.post(`/api/v1/leagues/${fixture.leagueA.id}/exams/${res.body.exam.id}/publish`, {});
    expect(published.status).toBe(200);
    expect(published.body.exam.status).toBe('published');
  });

  it('rejects text-only questions and foreign questions', async () => {
    const legacy = ctx.db.prepare(`
      INSERT INTO questions (league_id, body, points, is_open, created_at) VALUES (?, ?, 5, 1, ?)
    `).run(fixture.leagueA.id, 'سؤال تشریحی', new Date().toISOString());
    const textRes = await teacher.post(`/api/v1/leagues/${fixture.leagueA.id}/exams`, {
      title: 'آزمون نامعتبر',
      questionIds: [Number(legacy.lastInsertRowid)],
    });
    expect(textRes.status).toBe(400);
    expect(textRes.body.error.code).toBe('QUESTION_NOT_MCQ');

    const foreign = await otherTeacher.post(`/api/v1/leagues/${fixture.leagueB.id}/questions`, mcq('سؤال معلم دیگر'));
    const res = await teacher.post(`/api/v1/leagues/${fixture.leagueA.id}/exams`, {
      title: 'آزمون نامعتبر',
      questionIds: [foreign.body.question.id],
    });
    expect(res.status).toBe(400);
  });

  it('updates settings and question selection', async () => {
    const { res, first } = await createExam();
    const updated = await teacher.put(`/api/v1/leagues/${fixture.leagueA.id}/exams/${res.body.exam.id}`, {
      title: 'آزمون نهایی',
      durationMinutes: 45,
      questionIds: [first.id],
      shuffleOptions: false,
    });
    expect(updated.status).toBe(200);
    expect(updated.body.exam.title).toBe('آزمون نهایی');
    expect(updated.body.exam.durationMinutes).toBe(45);
    expect(updated.body.exam.questionCount).toBe(1);
  });

  it('hides exams from another teacher', async () => {
    const { res } = await createExam();
    const list = await otherTeacher.get(`/api/v1/leagues/${fixture.leagueA.id}/exams`);
    expect(list.status).toBe(403);
    const one = await otherTeacher.get(`/api/v1/leagues/${fixture.leagueA.id}/exams/${res.body.exam.id}`);
    expect(one.status).toBe(403);
  });
});

describe('student exam attempts', () => {
  async function publishedExam(overrides = {}) {
    const created = await createExam(overrides);
    await teacher.post(`/api/v1/leagues/${fixture.leagueA.id}/exams/${created.res.body.exam.id}/publish`, {});
    return created.res.body.exam;
  }

  it('rejects starting a draft exam even when the id is known', async () => {
    const { res } = await createExam();
    const start = await student.post(`/api/v1/student/exams/${res.body.exam.id}/start`, {});
    expect(start.status).toBe(400);
    expect(start.body.error.code).toBe('EXAM_NOT_PUBLISHED');
  });

  it('lists only published exams and never leaks correctIndex before grading', async () => {
    await createExam();
    const exam = await publishedExam();
    const list = await student.get('/api/v1/student/exams');
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].id).toBe(exam.id);
    expect(list.body.items[0].available).toBe(true);
    expect(list.body.items[0].attemptsRemaining).toBe(2);

    const started = await student.post(`/api/v1/student/exams/${exam.id}/start`, {});
    expect(started.status).toBe(200);
    expect(started.body.questions).toHaveLength(2);
    expect(JSON.stringify(started.body)).not.toContain('correctIndex');
    expect(started.body.remainingSeconds).toBeGreaterThan(0);
    expect(started.body.attempt.status).toBe('in_progress');
  });

  it('autosaves answers, grades server-side and awards league points', async () => {
    const exam = await publishedExam();
    const started = await student.post(`/api/v1/student/exams/${exam.id}/start`, {});
    const [questionOne, questionTwo] = started.body.questions;

    // First question has correct index 2 in the bank, second index 0.
    const saveOne = await student.put(
      `/api/v1/student/exams/attempts/${started.body.attempt.id}/answers/${questionOne.id}`,
      { optionIndex: 2 },
    );
    expect(saveOne.status).toBe(200);
    await student.put(
      `/api/v1/student/exams/attempts/${started.body.attempt.id}/answers/${questionTwo.id}`,
      { optionIndex: 1 },
    );

    const submitted = await student.post(
      `/api/v1/student/exams/attempts/${started.body.attempt.id}/submit`,
      {},
    );
    expect(submitted.status).toBe(200);
    expect(submitted.body.result.correctCount).toBe(1);
    expect(submitted.body.result.percent).toBe(50);
    expect(submitted.body.result.passed).toBe(true);
    expect(submitted.body.result.awardedPoints).toBe(50);
    expect(submitted.body.questions[0].correctIndex).toBe(2);

    const score = ctx.db.prepare('SELECT COALESCE(SUM(value), 0) AS total FROM scores WHERE student_id = ?')
      .get(fixture.studentsA[0].id).total;
    expect(score).toBe(50);
  });

  it('enforces the attempt limit and hides answers when showAnswers is false', async () => {
    const exam = await publishedExam({ maxAttempts: 1, showAnswers: false, rewardPoints: 0 });
    const first = await student.post(`/api/v1/student/exams/${exam.id}/start`, {});
    await student.post(`/api/v1/student/exams/attempts/${first.body.attempt.id}/submit`, {});

    const again = await student.post(`/api/v1/student/exams/${exam.id}/start`, {});
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe('ATTEMPTS_EXHAUSTED');

    const result = await student.get(`/api/v1/student/exams/attempts/${first.body.attempt.id}`);
    expect(result.body.result).toBeTruthy();
    expect(result.body.questions[0].correctIndex).toBeUndefined();
    expect(result.body.questions[0].isCorrect).toBeUndefined();
  });

  it('finishes an expired attempt with the saved answers', async () => {
    const exam = await publishedExam();
    const started = await student.post(`/api/v1/student/exams/${exam.id}/start`, {});
    await student.put(
      `/api/v1/student/exams/attempts/${started.body.attempt.id}/answers/${started.body.questions[0].id}`,
      { optionIndex: 2 },
    );
    ctx.db.prepare('UPDATE exam_attempts SET expires_at = ? WHERE id = ?')
      .run(new Date(Date.now() - 60_000).toISOString(), started.body.attempt.id);

    const after = await student.get(`/api/v1/student/exams/attempts/${started.body.attempt.id}`);
    expect(after.body.attempt.status).toBe('submitted');
    expect(after.body.result.percent).toBe(50);
  });

  it('shows the teacher results, attempt list and per-question analytics', async () => {
    const exam = await publishedExam();
    const started = await student.post(`/api/v1/student/exams/${exam.id}/start`, {});
    await student.put(
      `/api/v1/student/exams/attempts/${started.body.attempt.id}/answers/${started.body.questions[0].id}`,
      { optionIndex: 0 },
    );
    await student.post(`/api/v1/student/exams/attempts/${started.body.attempt.id}/submit`, {});

    const results = await teacher.get(`/api/v1/leagues/${fixture.leagueA.id}/exams/${exam.id}/results`);
    expect(results.status).toBe(200);
    expect(results.body.summary.attempts).toBe(1);
    expect(results.body.summary.students).toBe(1);
    expect(results.body.attempts[0].studentName).toBe('آرش آزمون');
    expect(results.body.analytics).toHaveLength(2);
    expect(results.body.analytics.some((row) => row.unanswered === 1)).toBe(true);
  });

  it('rejects saving an option outside the paper and a foreign attempt', async () => {
    const exam = await publishedExam();
    const started = await student.post(`/api/v1/student/exams/${exam.id}/start`, {});
    const answerId = started.body.questions[0].id;
    const invalid = await student.put(
      `/api/v1/student/exams/attempts/${started.body.attempt.id}/answers/${answerId}`,
      { optionIndex: 3 },
    );
    expect(invalid.status).toBe(400);

    ctx.db.prepare('UPDATE exam_attempts SET student_id = ? WHERE id = ?')
      .run(fixture.studentsA[1].id, started.body.attempt.id);
    const foreign = await student.get(`/api/v1/student/exams/attempts/${started.body.attempt.id}`);
    expect(foreign.status).toBe(404);
  });
});
