import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildFixture } from './fixtures.js';
import { createClient, createTestDatabase } from './helpers.js';

let ctx;
let fixture;
let teacher;
let rival;
let student;

const base = () => `/api/v1/leagues/${fixture.leagueA.id}/report-cards`;

async function addSubject(name, color = '#6366f1') {
  return teacher.post(`${base()}/subjects`, { name, color });
}

async function createCard(studentId = fixture.studentsA[0].id, semester = 'نوبت اول') {
  return teacher.post(`${base()}/students/${studentId}`, { studentId, semester });
}

beforeEach(async () => {
  ctx = createTestDatabase();
  fixture = buildFixture(ctx.db);
  teacher = createClient(ctx.db);
  await teacher.login('teacher-a', 'password-a1');
  rival = createClient(ctx.db);
  await rival.login('teacher-b', 'password-b1');
  student = createClient(ctx.db);
  await student.login('student-a', 'student-a1');
});

afterEach(() => {
  ctx.cleanup();
});

describe('report card subjects', () => {
  it('creates, lists, renames and deletes class-wide subjects', async () => {
    const created = await addSubject('ریاضی');
    expect(created.status).toBe(201);
    expect(created.body.subject.name).toBe('ریاضی');
    expect(created.body.subject.color).toBe('#6366f1');

    await addSubject('فارسی', '#22c55e');
    const list = await teacher.get(`${base()}/subjects`);
    expect(list.status).toBe(200);
    expect(list.body.items.map((item) => item.name)).toEqual(['ریاضی', 'فارسی']);

    const renamed = await teacher.patch(`${base()}/subjects/${created.body.subject.id}`, { name: 'ریاضیات' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.subject.name).toBe('ریاضیات');

    const removed = await teacher.del(`${base()}/subjects/${created.body.subject.id}`);
    expect(removed.status).toBe(200);
    const after = await teacher.get(`${base()}/subjects`);
    expect(after.body.items).toHaveLength(1);
  });

  it('rejects duplicate and empty subject names', async () => {
    await addSubject('ریاضی');
    const duplicate = await addSubject('ریاضی');
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('SUBJECT_EXISTS');

    const empty = await addSubject('   ');
    expect(empty.status).toBe(400);
  });

  it('does not let another teacher touch this league subjects', async () => {
    const res = await rival.get(`${base()}/subjects`);
    expect(res.status).toBe(403);
    const create = await rival.post(`${base()}/subjects`, { name: 'دستکاری' });
    expect(create.status).toBe(403);
  });
});

describe('report cards', () => {
  it('requires subjects before creating a card', async () => {
    const res = await createCard();
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('NO_SUBJECTS');
  });

  it('creates one card per student/semester and fills a grade row per subject', async () => {
    await addSubject('ریاضی');
    await addSubject('فارسی');

    const created = await createCard();
    expect(created.status).toBe(201);
    expect(created.body.card.studentName).toBe('آرش آزمون');
    expect(created.body.card.isPublished).toBe(false);
    expect(created.body.card.grades).toHaveLength(2);
    expect(created.body.card.grades.every((grade) => grade.numeric === null && grade.descriptive === null)).toBe(true);

    const duplicate = await createCard();
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('CARD_EXISTS');
  });

  it('saves numeric and descriptive grades and computes the average percentage', async () => {
    const math = (await addSubject('ریاضی')).body.subject;
    const art = (await addSubject('هنر')).body.subject;
    const card = (await createCard()).body.card;

    const saved = await teacher.put(`${base()}/cards/${card.id}`, {
      notes: 'پیشرفت خوب',
      grades: [
        { subjectId: math.id, numeric: 90, notes: 'عالی' },
        { subjectId: art.id, descriptive: 'good' },
      ],
    });

    expect(saved.status).toBe(200);
    expect(saved.body.card.notes).toBe('پیشرفت خوب');
    // numeric 90 and descriptive good (80) => 85
    expect(saved.body.card.totalPercent).toBe(85);
    expect(saved.body.card.level.value).toBe('good');

    const mathGrade = saved.body.card.grades.find((grade) => grade.subjectId === math.id);
    expect(mathGrade.numeric).toBe(90);
    expect(mathGrade.notes).toBe('عالی');
    const artGrade = saved.body.card.grades.find((grade) => grade.subjectId === art.id);
    expect(artGrade.descriptive).toBe('good');
  });

  it('rejects out-of-range and unknown grades', async () => {
    const math = (await addSubject('ریاضی')).body.subject;
    const card = (await createCard()).body.card;

    const tooHigh = await teacher.put(`${base()}/cards/${card.id}`, {
      grades: [{ subjectId: math.id, numeric: 120 }],
    });
    expect(tooHigh.status).toBe(400);

    const badLevel = await teacher.put(`${base()}/cards/${card.id}`, {
      grades: [{ subjectId: math.id, descriptive: 'excellent' }],
    });
    expect(badLevel.status).toBe(400);
  });

  it('publishes a card and only then exposes it to the student', async () => {
    const math = (await addSubject('ریاضی')).body.subject;
    const card = (await createCard()).body.card;

    await teacher.put(`${base()}/cards/${card.id}`, {
      grades: [{ subjectId: math.id, numeric: 75 }],
    });

    const hiddenList = await student.get('/api/v1/student/report-cards');
    expect(hiddenList.status).toBe(200);
    expect(hiddenList.body.items).toHaveLength(0);

    const hiddenDetail = await student.get(`/api/v1/student/report-cards/${card.id}`);
    expect(hiddenDetail.status).toBe(404);

    const published = await teacher.put(`${base()}/cards/${card.id}`, { isPublished: true });
    expect(published.body.card.isPublished).toBe(true);

    const list = await student.get('/api/v1/student/report-cards');
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].id).toBe(card.id);
    expect(list.body.items[0].grades).toHaveLength(1);

    const detail = await student.get(`/api/v1/student/report-cards/${card.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.card.totalPercent).toBe(75);
    expect(detail.body.card.performance.league.points).toBeTypeOf('number');
    expect(detail.body.card.performance.attendance.recorded).toBeTypeOf('number');
    expect(Array.isArray(detail.body.card.performance.evaluationPoints)).toBe(false);
    expect(Array.isArray(detail.body.card.performance.columns)).toBe(true);
  });

  it('keeps other students and other teachers out', async () => {
    const math = (await addSubject('ریاضی')).body.subject;
    const card = (await createCard()).body.card;
    await teacher.put(`${base()}/cards/${card.id}`, {
      grades: [{ subjectId: math.id, numeric: 88 }],
      isPublished: true,
    });

    const otherStudent = createClient(ctx.db);
    await otherStudent.login('student-b', 'student-b1');
    const res = await otherStudent.get(`/api/v1/student/report-cards/${card.id}`);
    expect(res.status).toBe(404);

    const crossTeacher = await rival.get(`${base()}/cards/${card.id}`);
    expect(crossTeacher.status).toBe(403);
  });

  it('returns the performance panel with evaluations, rank and attendance', async () => {
    await addSubject('ریاضی');
    const card = (await createCard()).body.card;

    const evaluation = await teacher.post(`/api/v1/leagues/${fixture.leagueA.id}/evaluations`, {
      subject: 'ریاضی',
      title: 'آزمون فصل ۱',
      kind: 'numeric',
      scaleMin: 0,
      scaleMax: 20,
      level: 'ابتدایی',
      grade: 'ششم',
      heldOn: '2026-10-12',
    });
    expect(evaluation.status).toBe(201);
    await teacher.put(`/api/v1/leagues/${fixture.leagueA.id}/evaluations/${evaluation.body.evaluation.id}/scores`, {
      scores: [{ studentId: fixture.studentsA[0].id, score: 18 }],
    });

    await teacher.post(`/api/v1/leagues/${fixture.leagueA.id}/attendance`, {
      date: '2026-10-12',
      records: [{ studentId: fixture.studentsA[0].id, status: 'present' }],
    });

    const detail = await teacher.get(`${base()}/cards/${card.id}`);
    expect(detail.status).toBe(200);
    const performance = detail.body.card.performance;
    expect(performance.league.totalStudents).toBe(3);
    expect(performance.league.rank).toBeTypeOf('number');
    expect(performance.league.title).toBeTruthy();
    expect(performance.attendance.present).toBeGreaterThanOrEqual(1);
    expect(performance.evaluations).toHaveLength(1);
    expect(performance.evaluations[0].subject).toBe('ریاضی');
    expect(performance.columns.length).toBeGreaterThan(0);
  });
});

describe('report card assistant permissions', () => {
  async function makeAssistant(permissions) {
    const res = await teacher.post('/api/v1/assistants', {
      leagueId: fixture.leagueA.id,
      username: 'report-assistant',
      password: 'report-pass',
      displayName: 'همیار کارنامه',
      permissions,
    });
    expect(res.status).toBe(201);
    const client = createClient(ctx.db);
    await client.login('report-assistant', 'report-pass');
    return client;
  }

  it('blocks an assistant without the evaluations permission', async () => {
    const assistant = await makeAssistant(['scores']);
    const res = await assistant.get(`${base()}/subjects`);
    expect(res.status).toBe(403);
  });

  it('allows an assistant with the evaluations permission to manage cards', async () => {
    const assistant = await makeAssistant(['evaluations']);
    const created = await assistant.post(`${base()}/subjects`, { name: 'علوم' });
    expect(created.status).toBe(201);

    const card = await assistant.post(`${base()}/students/${fixture.studentsA[0].id}`, {
      studentId: fixture.studentsA[0].id,
      semester: 'نوبت اول',
    });
    expect(card.status).toBe(201);
  });
});
