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

const base = () => `/api/v1/leagues/${fixture.leagueA.id}/tools/representative`;

describe('class representative', () => {
  it('starts at cycle 1 with nobody selected', async () => {
    const res = await client.get(base());

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      cycle: 1,
      totalStudents: 3,
      selectedCount: 0,
      remainingCount: 3,
      percent: 0,
      completed: false,
      lastSelected: null,
    });
    expect(res.body.students).toHaveLength(3);
    expect(res.body.students.every((student) => student.selected === false)).toBe(true);
    expect(res.body.cycles).toHaveLength(1);
  });

  it('picks every student exactly once per cycle and reports progress', async () => {
    const winners = [];
    for (let index = 0; index < 3; index += 1) {
      const res = await client.post(`${base()}/draw`, {});
      expect(res.status).toBe(200);
      expect(res.body.completed).toBe(index === 2);
      expect(res.body.remaining).toBe(2 - index);
      winners.push(res.body.winner.studentId);
    }

    expect(new Set(winners).size).toBe(3);
    expect(winners.sort()).toEqual(fixture.studentsA.map((student) => student.id).sort());

    const state = await client.get(base());
    expect(state.body).toMatchObject({
      cycle: 1,
      selectedCount: 3,
      remainingCount: 0,
      percent: 100,
      completed: true,
    });
    expect(state.body.cycles[0].completedAt).toBeTruthy();
    expect(state.body.cycles[0].selectedCount).toBe(3);
  });

  it('refuses another draw in a completed cycle until a new cycle starts', async () => {
    for (let index = 0; index < 3; index += 1) {
      await client.post(`${base()}/draw`, {});
    }

    const extra = await client.post(`${base()}/draw`, {});
    expect(extra.status).toBe(400);
    expect(extra.body.error.code).toBe('CYCLE_COMPLETE');

    const next = await client.post(`${base()}/cycle`, {});
    expect(next.status).toBe(200);
    expect(next.body.cycle).toBe(2);
    expect(next.body.state).toMatchObject({
      cycle: 2,
      selectedCount: 0,
      remainingCount: 3,
      percent: 0,
      completed: false,
    });
    expect(next.body.state.history).toHaveLength(3);
    expect(next.body.state.cycles).toHaveLength(2);
  });

  it('requires an explicit force to leave an unfinished cycle', async () => {
    await client.post(`${base()}/draw`, {});

    const refused = await client.post(`${base()}/cycle`, {});
    expect(refused.status).toBe(400);
    expect(refused.body.error.code).toBe('CYCLE_INCOMPLETE');

    const forced = await client.post(`${base()}/cycle`, { force: true });
    expect(forced.status).toBe(200);
    expect(forced.body.cycle).toBe(2);
    expect(forced.body.state.selectedCount).toBe(0);
    expect(forced.body.state.history).toHaveLength(1);
  });

  it('undoes the most recent pick and reopens the cycle', async () => {
    for (let index = 0; index < 3; index += 1) {
      await client.post(`${base()}/draw`, {});
    }

    const undone = await client.del(`${base()}/last`);
    expect(undone.status).toBe(200);
    expect(undone.body.removed.name).toBeTruthy();
    expect(undone.body.state).toMatchObject({
      selectedCount: 2,
      remainingCount: 1,
      percent: 67,
      completed: false,
    });
    expect(undone.body.state.cycles[0].completedAt).toBeNull();

    await client.del(`${base()}/last`);
    await client.del(`${base()}/last`);
    const empty = await client.del(`${base()}/last`);
    expect(empty.status).toBe(400);
    expect(empty.body.error.code).toBe('NOTHING_TO_UNDO');
  });

  it('resets history to a fresh first cycle', async () => {
    await client.post(`${base()}/draw`, {});
    await client.post(`${base()}/cycle`, { force: true });
    await client.post(`${base()}/draw`, {});

    const reset = await client.del(`${base()}/history`);
    expect(reset.status).toBe(200);
    expect(reset.body.state).toMatchObject({
      cycle: 1,
      selectedCount: 0,
      remainingCount: 3,
      percent: 0,
      completed: false,
      history: [],
    });
    expect(reset.body.state.cycles).toHaveLength(1);
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM representative_history').get().n).toBe(0);
  });

  it('handles an empty league without pretending it is complete', async () => {
    const empty = ctx.db.prepare("INSERT INTO leagues (teacher_id, name, status, created_at) VALUES (?, 'خالی', 'active', ?)")
      .run(fixture.teacherA.id, new Date().toISOString());

    const draw = await client.post(`/api/v1/leagues/${empty.lastInsertRowid}/tools/representative/draw`, {});
    expect(draw.status).toBe(400);
    expect(draw.body.error.code).toBe('NO_STUDENTS');

    const state = await client.get(`/api/v1/leagues/${empty.lastInsertRowid}/tools/representative`);
    expect(state.body).toMatchObject({ totalStudents: 0, remainingCount: 0, percent: 0, completed: false });
  });

  it('keeps the feature private to the owning teacher', async () => {
    const other = createClient(ctx.db);
    await other.login('teacher-b', 'password-b1');
    const forbidden = await other.get(base());
    expect(forbidden.status).toBe(403);

    const student = createClient(ctx.db);
    await student.login('student-a', 'student-a1');
    const studentDenied = await student.get(base());
    expect(studentDenied.status).toBe(403);
  });
});
