import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { attachUser } from '../src/middleware/auth.js';
import { csrfProtection } from '../src/middleware/csrf.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { createSessionStore, sessionMiddleware } from '../src/middleware/session.js';
import { createAdmin } from '../src/repositories/admins.js';
import { createApiRouter } from '../src/routes/index.js';
import { createMessagesRouter } from '../src/routes/messages.js';
import { buildFixture } from './fixtures.js';
import { createTestDatabase } from './helpers.js';

/**
 * The messages router is mounted by the application wiring. Until that wiring
 * lands, this test builds the same middleware chain (session, user, CSRF, API)
 * and adds the router at `/api/v1/messages`, so the tests exercise the real
 * HTTP surface without depending on app.js.
 */
function buildApp(db) {
  const app = express();
  app.use(express.json());
  app.use(sessionMiddleware(createSessionStore(db)));
  app.use(attachUser(db));
  app.use('/api/v1', csrfProtection, createApiRouter({ db }));
  app.use('/api/v1/messages', createMessagesRouter({ db }));
  app.use(errorHandler);
  return app;
}

/** Mirrors tests/helpers.js createClient for the app built above. */
function createMessagesClient(db) {
  const app = buildApp(db);
  const agent = request.agent(app);
  let token = null;

  const client = {
    app,
    agent,
    get: (url) => agent.get(url),
    post: (url, body = {}) => agent.post(url).set('x-csrf-token', token).send(body),
    async csrf() {
      const res = await agent.get('/api/v1/auth/csrf');
      token = res.body?.csrfToken ?? token;
      return token;
    },
  };

  client.login = async (username, password) => {
    await client.csrf();
    const res = await agent.post('/api/v1/auth/login').set('x-csrf-token', token).send({ username, password });
    if (res.body?.csrfToken) token = res.body.csrfToken;
    return res;
  };

  return client;
}

let ctx;
let fixture;
let teacherA;
let teacherB;
let studentA;
let studentB;
let admin;

beforeEach(async () => {
  ctx = createTestDatabase();
  fixture = buildFixture(ctx.db);

  teacherA = createMessagesClient(ctx.db);
  await teacherA.login('teacher-a', 'password-a1');
  teacherB = createMessagesClient(ctx.db);
  await teacherB.login('teacher-b', 'password-b1');
  studentA = createMessagesClient(ctx.db);
  await studentA.login('student-a', 'student-a1');
  studentB = createMessagesClient(ctx.db);
  await studentB.login('student-b', 'student-b1');

  createAdmin(ctx.db, { username: 'site-admin', password: 'admin-pass1', displayName: 'مدیر سامانه' });
  admin = createMessagesClient(ctx.db);
  await admin.login('site-admin', 'admin-pass1');
});

afterEach(() => {
  ctx.cleanup();
});

async function startStudentThread(subject = '') {
  const res = await studentA.post('/api/v1/messages/threads', { subject });
  expect(res.status).toBe(201);
  expect(res.body.created).toBe(true);
  return res.body.thread.id;
}

describe('teacher <-> student messages', () => {
  it('lets a student start a thread and shows it to the teacher as unread', async () => {
    const started = await studentA.post('/api/v1/messages/threads', { subject: 'سوال ریاضی' });
    expect(started.status).toBe(201);
    expect(started.body.created).toBe(true);
    expect(started.body.thread).toMatchObject({
      subject: 'سوال ریاضی',
      teacherId: fixture.teacherA.id,
      teacherName: 'خانم الف',
      studentId: fixture.studentsA[0].id,
      studentName: 'آرش آزمون',
      leagueId: fixture.leagueA.id,
      participantName: 'خانم الف',
      unread: 0,
      lastMessage: null,
    });
    const threadId = started.body.thread.id;

    const sent = await studentA.post(`/api/v1/messages/threads/${threadId}/messages`, { body: 'سلام استاد' });
    expect(sent.status).toBe(201);
    expect(sent.body.message).toMatchObject({
      body: 'سلام استاد',
      senderRole: 'student',
      senderName: 'آرش آزمون',
      mine: true,
      readAt: null,
    });
    expect(sent.body.thread.lastMessage).toMatchObject({ body: 'سلام استاد', senderRole: 'student' });
    expect(sent.body.thread.lastMessage.at).toBeTruthy();

    const mine = await studentA.get('/api/v1/messages/threads');
    expect(mine.status).toBe(200);
    expect(mine.body.items).toHaveLength(1);
    expect(mine.body.items[0]).toMatchObject({ id: threadId, participantName: 'خانم الف', unread: 0 });
    expect(mine.body.unreadTotal).toBe(0);

    const list = await teacherA.get('/api/v1/messages/threads');
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({
      id: threadId,
      participantName: 'آرش آزمون',
      subject: 'سوال ریاضی',
      unread: 1,
    });
    expect(list.body.items[0].lastMessage).toMatchObject({ body: 'سلام استاد', senderRole: 'student' });
    expect(list.body.unreadTotal).toBe(1);

    const unread = await teacherA.get('/api/v1/messages/unread');
    expect(unread.status).toBe(200);
    expect(unread.body).toEqual({ count: 1 });
  });

  it('lets the teacher reply and the student reads both messages with mine flags', async () => {
    const threadId = await startStudentThread();
    await studentA.post(`/api/v1/messages/threads/${threadId}/messages`, { body: 'سلام استاد' });

    const reply = await teacherA.post(`/api/v1/messages/threads/${threadId}/messages`, { body: 'سلام آرش جان' });
    expect(reply.status).toBe(201);
    expect(reply.body.message).toMatchObject({
      body: 'سلام آرش جان',
      senderRole: 'teacher',
      senderName: 'خانم الف',
      mine: true,
    });

    const detail = await studentA.get(`/api/v1/messages/threads/${threadId}?limit=100`);
    expect(detail.status).toBe(200);
    expect(detail.body.messages).toHaveLength(2);
    expect(detail.body.messages[0]).toMatchObject({
      body: 'سلام استاد',
      senderRole: 'student',
      senderName: 'آرش آزمون',
      mine: true,
    });
    expect(detail.body.messages[1]).toMatchObject({
      body: 'سلام آرش جان',
      senderRole: 'teacher',
      senderName: 'خانم الف',
      mine: false,
    });
    expect(detail.body.messages[1].readAt).toBeTruthy();
    expect(detail.body.thread).toMatchObject({ id: threadId, unread: 0, participantName: 'خانم الف' });
    expect(detail.body.unreadTotal).toBe(0);

    const unread = await studentA.get('/api/v1/messages/unread');
    expect(unread.body).toEqual({ count: 0 });
  });

  it('increments the teacher unread count on a student reply and clears it on read', async () => {
    const threadId = await startStudentThread();
    await studentA.post(`/api/v1/messages/threads/${threadId}/messages`, { body: 'پیام اول' });

    const opened = await teacherA.get(`/api/v1/messages/threads/${threadId}`);
    expect(opened.status).toBe(200);
    expect((await teacherA.get('/api/v1/messages/unread')).body).toEqual({ count: 0 });

    await studentA.post(`/api/v1/messages/threads/${threadId}/messages`, { body: 'پیام دوم' });

    const unread = await teacherA.get('/api/v1/messages/unread');
    expect(unread.body).toEqual({ count: 1 });
    const list = await teacherA.get('/api/v1/messages/threads');
    expect(list.body.items[0].unread).toBe(1);
    expect(list.body.unreadTotal).toBe(1);

    const read = await teacherA.post(`/api/v1/messages/threads/${threadId}/read`);
    expect(read.status).toBe(200);
    expect(read.body).toEqual({ ok: true, unreadTotal: 0 });
    expect((await teacherA.get('/api/v1/messages/unread')).body).toEqual({ count: 0 });
  });

  it('hides the thread from another teacher', async () => {
    const threadId = await startStudentThread();
    await studentA.post(`/api/v1/messages/threads/${threadId}/messages`, { body: 'محرمانه' });
    const before = ctx.db.prepare('SELECT id, read_at FROM messages WHERE conversation_id = ? ORDER BY id').all(threadId);

    const list = await teacherB.get('/api/v1/messages/threads');
    expect(list.status).toBe(200);
    expect(list.body.items).toEqual([]);

    const detail = await teacherB.get(`/api/v1/messages/threads/${threadId}`);
    expect([403, 404]).toContain(detail.status);

    const write = await teacherB.post(`/api/v1/messages/threads/${threadId}/messages`, { body: 'نفوذ' });
    expect([403, 404]).toContain(write.status);

    const read = await teacherB.post(`/api/v1/messages/threads/${threadId}/read`);
    expect([403, 404]).toContain(read.status);

    const after = ctx.db.prepare('SELECT id, read_at FROM messages WHERE conversation_id = ? ORDER BY id').all(threadId);
    expect(after).toEqual(before);
  });

  it('hides the thread from another student', async () => {
    const threadId = await startStudentThread();
    await studentA.post(`/api/v1/messages/threads/${threadId}/messages`, { body: 'خصوصی' });

    const list = await studentB.get('/api/v1/messages/threads');
    expect(list.status).toBe(200);
    expect(list.body.items).toEqual([]);

    const detail = await studentB.get(`/api/v1/messages/threads/${threadId}`);
    expect([403, 404]).toContain(detail.status);

    const write = await studentB.post(`/api/v1/messages/threads/${threadId}/messages`, { body: 'سلام' });
    expect([403, 404]).toContain(write.status);
  });

  it('refuses to start a thread with a student owned by another teacher', async () => {
    const res = await teacherA.post('/api/v1/messages/threads', { studentId: fixture.studentsB[0].id });
    expect([400, 403, 404]).toContain(res.status);
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM conversations').get().n).toBe(0);
  });

  it('refuses to start a thread with a student that has no login', async () => {
    const res = await teacherA.post('/api/v1/messages/threads', { studentId: fixture.studentsA[1].id });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('STUDENT_WITHOUT_ACCOUNT');
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM conversations').get().n).toBe(0);
  });

  it('rejects an empty message body', async () => {
    const threadId = await startStudentThread();
    const res = await studentA.post(`/api/v1/messages/threads/${threadId}/messages`, { body: '   ' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const count = ctx.db.prepare('SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ?').get(threadId).n;
    expect(count).toBe(0);
  });

  it('requires authentication and blocks the admin', async () => {
    const anon = createMessagesClient(ctx.db);
    expect((await anon.get('/api/v1/messages/threads')).status).toBe(401);
    expect((await anon.get('/api/v1/messages/unread')).status).toBe(401);
    expect((await anon.get('/api/v1/messages/contacts')).status).toBe(401);

    expect((await admin.get('/api/v1/messages/threads')).status).toBe(403);
    expect((await admin.get('/api/v1/messages/unread')).status).toBe(403);
    expect((await admin.get('/api/v1/messages/contacts')).status).toBe(403);
    const started = await admin.post('/api/v1/messages/threads', { studentId: fixture.studentsA[0].id });
    expect(started.status).toBe(403);
  });

  it('creates each conversation only once', async () => {
    const first = await teacherA.post('/api/v1/messages/threads', {
      studentId: fixture.studentsA[0].id,
      subject: 'الف',
    });
    expect(first.status).toBe(201);
    expect(first.body.created).toBe(true);

    const second = await teacherA.post('/api/v1/messages/threads', {
      studentId: fixture.studentsA[0].id,
      subject: 'ب',
    });
    expect(second.status).toBe(200);
    expect(second.body.created).toBe(false);
    expect(second.body.thread.id).toBe(first.body.thread.id);
    expect(second.body.thread.subject).toBe('الف');

    const fromStudent = await studentA.post('/api/v1/messages/threads', {});
    expect(fromStudent.status).toBe(200);
    expect(fromStudent.body.created).toBe(false);
    expect(fromStudent.body.thread.id).toBe(first.body.thread.id);

    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM conversations').get().n).toBe(1);
  });

  it('lists the teacher contacts with the linked student account', async () => {
    const res = await teacherA.get('/api/v1/messages/contacts');
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('teacher');
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toEqual({
      studentId: fixture.studentsA[0].id,
      studentName: 'آرش آزمون',
      userId: fixture.studentUserA.id,
      username: 'student-a',
      leagueId: fixture.leagueA.id,
      leagueName: 'لیگ الف',
      conversationId: null,
    });

    const other = await teacherB.get('/api/v1/messages/contacts');
    expect(other.body.role).toBe('teacher');
    expect(other.body.items).toHaveLength(1);
    expect(other.body.items[0]).toMatchObject({ studentName: 'سارا تنها', username: 'student-b' });

    const threadId = await startStudentThread();
    const afterThread = await teacherA.get('/api/v1/messages/contacts');
    expect(afterThread.body.items[0].conversationId).toBe(threadId);
  });

  it('lists the student own teacher', async () => {
    const before = await studentA.get('/api/v1/messages/contacts');
    expect(before.status).toBe(200);
    expect(before.body.role).toBe('student');
    expect(before.body.items).toHaveLength(1);
    expect(before.body.items[0]).toEqual({
      teacherId: fixture.teacherA.id,
      teacherName: 'خانم الف',
      leagueId: fixture.leagueA.id,
      leagueName: 'لیگ الف',
      conversationId: null,
    });

    const threadId = await startStudentThread();
    const afterThread = await studentA.get('/api/v1/messages/contacts');
    expect(afterThread.body.items[0].conversationId).toBe(threadId);
  });
});
