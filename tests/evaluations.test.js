import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildFixture } from './fixtures.js';
import { createClient, createTestDatabase } from './helpers.js';

let ctx;
let fixture;
let teacher;
let rival;
let student;

const date = '2026-10-12';

async function createEvaluation(overrides = {}) {
  return teacher.post(`/api/v1/leagues/${fixture.leagueA.id}/evaluations`, {
    subject: 'ریاضی',
    title: 'آزمون فصل ۲',
    level: 'ابتدایی',
    grade: 'ششم',
    kind: 'numeric',
    scaleMin: 0,
    scaleMax: 20,
    heldOn: date,
    note: '',
    ...overrides,
  });
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

describe('course evaluations (teacher)', () => {
  it('creates a numeric evaluation and links the matching league column', async () => {
    const res = await createEvaluation();

    expect(res.status).toBe(201);
    expect(res.body.evaluation.subject).toBe('ریاضی');
    expect(res.body.evaluation.title).toBe('آزمون فصل ۲');
    expect(res.body.evaluation.level).toBe('ابتدایی');
    expect(res.body.evaluation.grade).toBe('ششم');
    expect(res.body.evaluation.kind).toBe('numeric');
    expect(res.body.evaluation.scaleMax).toBe(20);
    expect(res.body.evaluation.heldOn).toBe(date);
    expect(res.body.evaluation.columnId).toBe(fixture.columnsA[0].id);
    expect(res.body.evaluation.studentCount).toBe(3);
    expect(res.body.evaluation.gradedCount).toBe(0);
  });

  it('leaves the column link empty when the subject matches no column', async () => {
    const res = await createEvaluation({ subject: 'خطاطی' });
    expect(res.status).toBe(201);
    expect(res.body.evaluation.columnId).toBeNull();
  });

  it('lists evaluations with aggregate stats, subjects and form options', async () => {
    await createEvaluation();
    await createEvaluation({ subject: 'فارسی', title: 'روان‌خوانی درس ۳', heldOn: '2026-10-05' });

    const res = await teacher.get(`/api/v1/leagues/${fixture.leagueA.id}/evaluations`);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items[0].subject).toBe('ریاضی');
    expect(res.body.total).toBe(2);
    expect(res.body.stats.count).toBe(2);
    expect(res.body.stats.subjectCount).toBe(2);
    expect(res.body.stats.studentCount).toBe(3);
    expect(res.body.stats.average).toBeNull();
    expect(res.body.subjects).toEqual(['ریاضی', 'فارسی'].sort((a, b) => a.localeCompare(b, 'fa')));
    expect(res.body.options.levels).toContain('ابتدایی');
    expect(res.body.options.gradesByLevel['ابتدایی']).toContain('ششم');
    expect(res.body.options.descriptive.map((level) => level.key)).toEqual(['excellent', 'good', 'fair', 'needs-work']);
  });

  it('filters the list by subject and date range', async () => {
    await createEvaluation({ heldOn: '2026-09-01' });
    await createEvaluation({ subject: 'فارسی', heldOn: '2026-10-05' });

    const bySubject = await teacher.get(`/api/v1/leagues/${fixture.leagueA.id}/evaluations?subject=${encodeURIComponent('فارسی')}`);
    expect(bySubject.body.items).toHaveLength(1);
    expect(bySubject.body.items[0].subject).toBe('فارسی');

    const byDate = await teacher.get(`/api/v1/leagues/${fixture.leagueA.id}/evaluations?from=2026-10-01&to=2026-10-31`);
    expect(byDate.body.items).toHaveLength(1);
    expect(byDate.body.items[0].subject).toBe('فارسی');
  });

  it('validates the create payload', async () => {
    const noTitle = await createEvaluation({ title: '' });
    expect(noTitle.status).toBe(400);
    expect(noTitle.body.error.code).toBe('VALIDATION_ERROR');

    const badDate = await createEvaluation({ heldOn: '1405/07/20' });
    expect(badDate.status).toBe(400);

    const badScale = await createEvaluation({ scaleMin: 20, scaleMax: 20 });
    expect(badScale.status).toBe(400);

    const badQuery = await teacher.get(`/api/v1/leagues/${fixture.leagueA.id}/evaluations?from=2026%2F13%2F01`);
    expect(badQuery.status).toBe(400);
  });

  it('saves marks for every student and reports averages', async () => {
    const created = await createEvaluation();
    const evaluationId = created.body.evaluation.id;

    const students = await teacher.get(`/api/v1/leagues/${fixture.leagueA.id}/evaluations/${evaluationId}`);
    expect(students.status).toBe(200);
    expect(students.body.students).toHaveLength(3);
    expect(students.body.students.every((row) => row.score === null && row.label === '')).toBe(true);

    const saved = await teacher.put(`/api/v1/leagues/${fixture.leagueA.id}/evaluations/${evaluationId}/scores`, {
      scores: [
        { studentId: fixture.studentsA[0].id, score: 20 },
        { studentId: fixture.studentsA[1].id, score: 15 },
        { studentId: fixture.studentsA[2].id, score: 10 },
      ],
    });

    expect(saved.status).toBe(200);
    expect(saved.body.evaluation.gradedCount).toBe(3);
    expect(saved.body.evaluation.average).toBe(15);
    expect(saved.body.evaluation.minScore).toBe(10);
    expect(saved.body.evaluation.maxScore).toBe(20);
    const byId = new Map(saved.body.students.map((row) => [row.studentId, row]));
    expect(byId.get(fixture.studentsA[0].id).score).toBe(20);

    // re-saving one mark updates it in place, it does not duplicate
    const updated = await teacher.put(`/api/v1/leagues/${fixture.leagueA.id}/evaluations/${evaluationId}/scores`, {
      scores: [{ studentId: fixture.studentsA[0].id, score: 18 }],
    });
    expect(updated.body.evaluation.gradedCount).toBe(3);
    expect(updated.body.evaluation.average).toBe(14.33);
    const rows = ctx.db.prepare('SELECT COUNT(*) AS n FROM evaluation_scores WHERE evaluation_id = ?').get(evaluationId).n;
    expect(rows).toBe(3);
  });

  it('rejects a mark outside the scale and unknown students', async () => {
    const created = await createEvaluation();
    const evaluationId = created.body.evaluation.id;

    const tooHigh = await teacher.put(`/api/v1/leagues/${fixture.leagueA.id}/evaluations/${evaluationId}/scores`, {
      scores: [{ studentId: fixture.studentsA[0].id, score: 21 }],
    });
    expect(tooHigh.status).toBe(400);
    expect(tooHigh.body.error.code).toBe('INVALID_SCORE');

    const negative = await teacher.put(`/api/v1/leagues/${fixture.leagueA.id}/evaluations/${evaluationId}/scores`, {
      scores: [{ studentId: fixture.studentsA[0].id, score: -1 }],
    });
    expect(negative.status).toBe(400);

    // a student from another league is silently skipped, never stored
    const foreign = await teacher.put(`/api/v1/leagues/${fixture.leagueA.id}/evaluations/${evaluationId}/scores`, {
      scores: [{ studentId: fixture.studentsB[0].id, score: 20 }],
    });
    expect(foreign.status).toBe(200);
    expect(foreign.body.evaluation.gradedCount).toBe(0);
  });

  it('supports descriptive evaluations with qualitative levels', async () => {
    const created = await createEvaluation({ kind: 'descriptive', subject: 'هدیه', title: 'ارزشیابی توصیفی مهر' });
    const evaluationId = created.body.evaluation.id;

    const saved = await teacher.put(`/api/v1/leagues/${fixture.leagueA.id}/evaluations/${evaluationId}/scores`, {
      scores: [
        { studentId: fixture.studentsA[0].id, label: 'excellent' },
        { studentId: fixture.studentsA[1].id, label: 'needs-work' },
        { studentId: fixture.studentsA[2].id, score: 19, label: 'good' },
      ],
    });
    expect(saved.status).toBe(200);
    // a descriptive evaluation never keeps a numeric mark
    expect(saved.body.students.find((row) => row.studentId === fixture.studentsA[2].id).score).toBeNull();
    expect(saved.body.students.find((row) => row.studentId === fixture.studentsA[2].id).label).toBe('good');

    const badLabel = await teacher.put(`/api/v1/leagues/${fixture.leagueA.id}/evaluations/${evaluationId}/scores`, {
      scores: [{ studentId: fixture.studentsA[0].id, label: 'perfect' }],
    });
    expect(badLabel.status).toBe(400);
    expect(badLabel.body.error.code).toBe('INVALID_LABEL');
  });

  it('clears a mark when neither score nor label is sent', async () => {
    const created = await createEvaluation();
    const evaluationId = created.body.evaluation.id;
    await teacher.put(`/api/v1/leagues/${fixture.leagueA.id}/evaluations/${evaluationId}/scores`, {
      scores: [{ studentId: fixture.studentsA[0].id, score: 12 }],
    });

    const cleared = await teacher.put(`/api/v1/leagues/${fixture.leagueA.id}/evaluations/${evaluationId}/scores`, {
      scores: [{ studentId: fixture.studentsA[0].id, score: null }],
    });
    expect(cleared.body.evaluation.gradedCount).toBe(0);
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM evaluation_scores WHERE evaluation_id = ?').get(evaluationId).n).toBe(0);
  });

  it('adds the mapped points to the linked column and only the difference on re-save', async () => {
    const created = await createEvaluation();
    const evaluationId = created.body.evaluation.id;
    const columnId = fixture.columnsA[0].id;
    const studentId = fixture.studentsA[0].id;
    const valueOf = () => ctx.db.prepare('SELECT value FROM scores WHERE student_id = ? AND column_id = ?')
      .get(studentId, columnId)?.value ?? 0;

    await teacher.put(`/api/v1/leagues/${fixture.leagueA.id}/evaluations/${evaluationId}/scores`, {
      scores: [{ studentId, score: 20 }],
    });
    expect(valueOf()).toBe(100);
    expect(ctx.db.prepare('SELECT awarded_points AS p FROM evaluation_scores WHERE evaluation_id = ? AND student_id = ?')
      .get(evaluationId, studentId).p).toBe(100);

    // Re-saving the same mark must not add the points twice.
    await teacher.put(`/api/v1/leagues/${fixture.leagueA.id}/evaluations/${evaluationId}/scores`, {
      scores: [{ studentId, score: 20 }],
    });
    expect(valueOf()).toBe(100);

    // 9.99/20 is «نیاز به تلاش» → the award becomes -50 (100 - 50 - 100 = -50 delta).
    await teacher.put(`/api/v1/leagues/${fixture.leagueA.id}/evaluations/${evaluationId}/scores`, {
      scores: [{ studentId, score: 9.99 }],
    });
    expect(valueOf()).toBe(-50);
  });

  it('reverses the awarded points when scoring is disabled or the mark is cleared', async () => {
    const created = await createEvaluation();
    const evaluationId = created.body.evaluation.id;
    const columnId = fixture.columnsA[0].id;
    const studentId = fixture.studentsA[0].id;
    const valueOf = () => ctx.db.prepare('SELECT value FROM scores WHERE student_id = ? AND column_id = ?')
      .get(studentId, columnId)?.value ?? 0;

    await teacher.put(`/api/v1/leagues/${fixture.leagueA.id}/evaluations/${evaluationId}/scores`, {
      scores: [{ studentId, score: 15 }],
    });
    expect(valueOf()).toBe(25);

    const disabled = await teacher.put(`/api/v1/leagues/${fixture.leagueA.id}/evaluations/scoring`, {
      enabled: false,
      excellent: 100,
      good: 25,
      fair: -25,
      needsWork: -50,
    });
    expect(disabled.status).toBe(200);
    expect(disabled.body.scoring.enabled).toBe(false);
    expect(valueOf()).toBe(0);

    // With scoring off new marks stay out of the league.
    await teacher.put(`/api/v1/leagues/${fixture.leagueA.id}/evaluations/${evaluationId}/scores`, {
      scores: [{ studentId, score: 20 }],
    });
    expect(valueOf()).toBe(0);

    // Turning it back on re-applies the current mark (20 → 100).
    await teacher.put(`/api/v1/leagues/${fixture.leagueA.id}/evaluations/scoring`, {
      enabled: true,
      excellent: 100,
      good: 25,
      fair: -25,
      needsWork: -50,
    });
    expect(valueOf()).toBe(100);

    // Clearing the mark removes the points again.
    await teacher.put(`/api/v1/leagues/${fixture.leagueA.id}/evaluations/${evaluationId}/scores`, {
      scores: [{ studentId, score: null }],
    });
    expect(valueOf()).toBe(0);
  });

  it('reverses the awarded points when the evaluation is deleted', async () => {
    const created = await createEvaluation();
    const evaluationId = created.body.evaluation.id;
    const columnId = fixture.columnsA[0].id;
    const studentId = fixture.studentsA[0].id;

    await teacher.put(`/api/v1/leagues/${fixture.leagueA.id}/evaluations/${evaluationId}/scores`, {
      scores: [{ studentId, score: 15 }],
    });
    const valueOf = () => ctx.db.prepare('SELECT value FROM scores WHERE student_id = ? AND column_id = ?')
      .get(studentId, columnId)?.value ?? 0;
    expect(valueOf()).toBe(25);

    await teacher.del(`/api/v1/leagues/${fixture.leagueA.id}/evaluations/${evaluationId}`);
    expect(valueOf()).toBe(0);
  });

  it('moves the points when the subject relinks to another column', async () => {
    const created = await createEvaluation();
    const evaluationId = created.body.evaluation.id;
    const studentId = fixture.studentsA[0].id;

    await teacher.put(`/api/v1/leagues/${fixture.leagueA.id}/evaluations/${evaluationId}/scores`, {
      scores: [{ studentId, score: 18 }],
    });
    const valueIn = (columnId) => ctx.db.prepare('SELECT value FROM scores WHERE student_id = ? AND column_id = ?')
      .get(studentId, columnId)?.value ?? 0;
    expect(valueIn(fixture.columnsA[0].id)).toBe(100);

    await teacher.patch(`/api/v1/leagues/${fixture.leagueA.id}/evaluations/${evaluationId}`, { subject: 'علوم' });
    expect(valueIn(fixture.columnsA[0].id)).toBe(0);
    expect(valueIn(fixture.columnsA[2].id)).toBe(100);
  });

  it('maps descriptive levels to their point values', async () => {
    const created = await createEvaluation({ kind: 'descriptive' });
    const evaluationId = created.body.evaluation.id;
    const columnId = fixture.columnsA[0].id;
    const studentId = fixture.studentsA[0].id;
    const valueOf = () => ctx.db.prepare('SELECT value FROM scores WHERE student_id = ? AND column_id = ?')
      .get(studentId, columnId)?.value ?? 0;

    await teacher.put(`/api/v1/leagues/${fixture.leagueA.id}/evaluations/${evaluationId}/scores`, {
      scores: [{ studentId, label: 'excellent' }],
    });
    expect(valueOf()).toBe(100);

    await teacher.put(`/api/v1/leagues/${fixture.leagueA.id}/evaluations/${evaluationId}/scores`, {
      scores: [{ studentId, label: 'needs-work' }],
    });
    expect(valueOf()).toBe(-50);

    await teacher.put(`/api/v1/leagues/${fixture.leagueA.id}/evaluations/${evaluationId}/scores`, {
      scores: [{ studentId, label: '' }],
    });
    expect(valueOf()).toBe(0);
  });

  it('validates the scoring payload and exposes it in the list', async () => {
    const bad = await teacher.put(`/api/v1/leagues/${fixture.leagueA.id}/evaluations/scoring`, { enabled: true });
    expect(bad.status).toBe(400);

    const foreign = await rival.put(`/api/v1/leagues/${fixture.leagueA.id}/evaluations/scoring`, {
      enabled: true,
      excellent: 1,
      good: 1,
      fair: 1,
      needsWork: 1,
    });
    expect(foreign.status).toBe(403);

    const list = await teacher.get(`/api/v1/leagues/${fixture.leagueA.id}/evaluations`);
    expect(list.body.scoring).toEqual({ enabled: true, excellent: 100, good: 25, fair: -25, needsWork: -50 });
  });

  it('updates and deletes an evaluation', async () => {
    const created = await createEvaluation();
    const evaluationId = created.body.evaluation.id;

    const patched = await teacher.patch(`/api/v1/leagues/${fixture.leagueA.id}/evaluations/${evaluationId}`, {
      title: 'آزمون فصل ۳',
      subject: 'علوم',
    });
    expect(patched.status).toBe(200);
    expect(patched.body.evaluation.title).toBe('آزمون فصل ۳');
    expect(patched.body.evaluation.columnId).toBe(fixture.columnsA[2].id);

    const empty = await teacher.patch(`/api/v1/leagues/${fixture.leagueA.id}/evaluations/${evaluationId}`, {});
    expect(empty.status).toBe(400);

    const removed = await teacher.del(`/api/v1/leagues/${fixture.leagueA.id}/evaluations/${evaluationId}`);
    expect(removed.status).toBe(200);
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM evaluations WHERE id = ?').get(evaluationId).n).toBe(0);

    const missing = await teacher.get(`/api/v1/leagues/${fixture.leagueA.id}/evaluations/${evaluationId}`);
    expect(missing.status).toBe(404);
  });

  it('hides foreign evaluations and blocks other teachers and students', async () => {
    const created = await createEvaluation();
    const evaluationId = created.body.evaluation.id;

    const foreignList = await rival.get(`/api/v1/leagues/${fixture.leagueA.id}/evaluations`);
    expect(foreignList.status).toBe(403);

    const foreignDetail = await rival.get(`/api/v1/leagues/${fixture.leagueB.id}/evaluations/${evaluationId}`);
    expect(foreignDetail.status).toBe(404);

    const foreignWrite = await rival.put(`/api/v1/leagues/${fixture.leagueB.id}/evaluations/${evaluationId}/scores`, {
      scores: [{ studentId: fixture.studentsA[0].id, score: 20 }],
    });
    expect(foreignWrite.status).toBe(404);

    const studentRead = await student.get(`/api/v1/leagues/${fixture.leagueA.id}/evaluations`);
    expect(studentRead.status).toBe(403);
  });

  it('returns the form options used by the create dialog', async () => {
    const res = await teacher.get(`/api/v1/leagues/${fixture.leagueA.id}/evaluations?a=b`);
    expect(res.status).toBe(200);
    expect(res.body.options.kinds.map((kind) => kind.key)).toEqual(['numeric', 'descriptive']);
    expect(res.body.columns.map((column) => column.name)).toContain('ریاضی');
  });
});

describe('course evaluations (student)', () => {
  it('shows only its own marks with class aggregates', async () => {
    const created = await createEvaluation();
    const evaluationId = created.body.evaluation.id;
    await teacher.put(`/api/v1/leagues/${fixture.leagueA.id}/evaluations/${evaluationId}/scores`, {
      scores: [
        { studentId: fixture.studentsA[0].id, score: 20 },
        { studentId: fixture.studentsA[1].id, score: 16 },
        { studentId: fixture.studentsA[2].id, score: 14 },
      ],
    });

    const res = await student.get('/api/v1/student/evaluations');
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    const [item] = res.body.items;
    expect(item.subject).toBe('ریاضی');
    expect(item.score).toBe(20);
    expect(item.band.label).toBe('عالی');
    expect(item.average).toBe(16.67);
    expect(item.topScore).toBe(20);
    expect(item.rank).toBe(1);
    expect(item.gradedCount).toBe(3);
    expect(item.studentCount).toBe(3);
    expect(res.body.stats.count).toBe(1);
    expect(res.body.stats.average).toBe(20);
    expect(res.body.stats.bestSubject).toBe('ریاضی');
    expect(res.body.stats.subjects).toEqual([{ subject: 'ریاضی', average: 20, count: 1 }]);

    // no other student is ever identified
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('بهار بنفش');
    expect(raw).not.toContain('پویا پیشرو');
    expect(raw).not.toContain('studentId');
  });

  it('reports a low mark with the matching band and a middle rank', async () => {
    const created = await createEvaluation();
    await teacher.put(`/api/v1/leagues/${fixture.leagueA.id}/evaluations/${created.body.evaluation.id}/scores`, {
      scores: [
        { studentId: fixture.studentsA[0].id, score: 12 },
        { studentId: fixture.studentsA[1].id, score: 15 },
        { studentId: fixture.studentsA[2].id, score: 19 },
      ],
    });

    const res = await student.get('/api/v1/student/evaluations');
    const [item] = res.body.items;
    expect(item.band.key).toBe('fair');
    expect(item.band.label).toBe('قابل قبول');
    expect(item.rank).toBe(3);
  });

  it('shows an ungraded evaluation as pending', async () => {
    await createEvaluation();
    const res = await student.get('/api/v1/student/evaluations');
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].score).toBeNull();
    expect(res.body.items[0].band).toBeNull();
    expect(res.body.items[0].rank).toBeNull();
    expect(res.body.stats.average).toBeNull();
  });

  it('keeps descriptive marks free of numeric aggregates', async () => {
    const created = await createEvaluation({ kind: 'descriptive', subject: 'هدیه' });
    await teacher.put(`/api/v1/leagues/${fixture.leagueA.id}/evaluations/${created.body.evaluation.id}/scores`, {
      scores: [{ studentId: fixture.studentsA[0].id, label: 'good' }],
    });

    const res = await student.get('/api/v1/student/evaluations');
    expect(res.body.items[0].label).toBe('good');
    expect(res.body.items[0].band).toEqual({ key: 'good', label: 'خوب', icon: '👍' });
    expect(res.body.items[0].average).toBeNull();
    expect(res.body.stats.average).toBeNull();
  });

  it('requires a student session', async () => {
    const anonymous = createClient(ctx.db);
    const res = await anonymous.get('/api/v1/student/evaluations');
    expect(res.status).toBe(401);
  });
});
