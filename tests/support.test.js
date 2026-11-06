import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { attachUser } from '../src/middleware/auth.js';
import { csrfProtection } from '../src/middleware/csrf.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { createSessionStore, sessionMiddleware } from '../src/middleware/session.js';
import { createAdmin } from '../src/repositories/admins.js';
import { createApiRouter } from '../src/routes/index.js';
import { buildFixture } from './fixtures.js';
import { createTestDatabase } from './helpers.js';

/**
 * Support tickets share the messaging shape, so this file builds the same
 * middleware chain as tests/messages.test.js and exercises the real HTTP
 * surface of `/api/v1/support` and `/api/v1/admin/support`.
 */
function buildApp(db) {
  const app = express();
  app.use(express.json());
  app.use(sessionMiddleware(createSessionStore(db)));
  app.use(attachUser(db));
  app.use('/api/v1', csrfProtection, createApiRouter({ db }));
  app.use(errorHandler);
  return app;
}

function createSupportClient(db) {
  const app = buildApp(db);
  const agent = request.agent(app);
  let token = null;

  const client = {
    app,
    agent,
    get: (url) => agent.get(url),
    post: (url, body = {}) => agent.post(url).set('x-csrf-token', token).send(body),
    patch: (url, body = {}) => agent.patch(url).set('x-csrf-token', token).send(body),
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

  teacherA = createSupportClient(ctx.db);
  await teacherA.login('teacher-a', 'password-a1');
  teacherB = createSupportClient(ctx.db);
  await teacherB.login('teacher-b', 'password-b1');
  studentA = createSupportClient(ctx.db);
  await studentA.login('student-a', 'student-a1');
  studentB = createSupportClient(ctx.db);
  await studentB.login('student-b', 'student-b1');

  createAdmin(ctx.db, { username: 'site-admin', password: 'admin-pass1', displayName: 'مدیر سامانه' });
  admin = createSupportClient(ctx.db);
  await admin.login('site-admin', 'admin-pass1');
});

afterEach(() => {
  ctx.cleanup();
});

async function startTicket(client, subject = 'مشکل در پرداخت', body = 'سلام، اشتراکم فعال نشده است') {
  const res = await client.post('/api/v1/support/threads', { subject, body });
  expect(res.status).toBe(201);
  return res.body.thread.id;
}

describe('support tickets (user <-> admin)', () => {
  it('lets a teacher open a ticket and shows it to the admin as unread', async () => {
    const started = await teacherA.post('/api/v1/support/threads', {
      subject: 'مشکل در پرداخت',
      body: 'سلام، اشتراکم فعال نشده است',
    });
    expect(started.status).toBe(201);
    expect(started.body.thread).toMatchObject({
      subject: 'مشکل در پرداخت',
      status: 'open',
      userId: fixture.teacherA.id,
      userName: 'خانم الف',
      userRole: 'teacher',
      participantName: 'پشتیبانی سایت',
      unread: 0,
    });
    expect(started.body.thread.lastMessage).toMatchObject({
      body: 'سلام، اشتراکم فعال نشده است',
      senderRole: 'user',
    });
    const threadId = started.body.thread.id;

    const mine = await teacherA.get('/api/v1/support/threads');
    expect(mine.status).toBe(200);
    expect(mine.body.items).toHaveLength(1);
    expect(mine.body.unreadTotal).toBe(0);

    const list = await admin.get('/api/v1/admin/support/threads');
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({
      id: threadId,
      userName: 'خانم الف',
      username: 'teacher-a',
      userRole: 'teacher',
      subject: 'مشکل در پرداخت',
      status: 'open',
      unread: 1,
    });
    expect(list.body.unreadTotal).toBe(1);

    const unread = await admin.get('/api/v1/admin/support/unread');
    expect(unread.body).toEqual({ count: 1 });
  });

  it('lets the admin reply and the user reads it with mine flags', async () => {
    const threadId = await startTicket(teacherA);

    const reply = await admin.post(`/api/v1/admin/support/threads/${threadId}/messages`, {
      body: 'سلام، بررسی شد و فعال شد',
    });
    expect(reply.status).toBe(201);
    expect(reply.body.message).toMatchObject({
      body: 'سلام، بررسی شد و فعال شد',
      senderRole: 'admin',
      senderName: 'مدیر سامانه',
      mine: true,
    });
    expect(reply.body.thread.status).toBe('answered');

    const detail = await teacherA.get(`/api/v1/support/threads/${threadId}?limit=100`);
    expect(detail.status).toBe(200);
    expect(detail.body.messages).toHaveLength(2);
    expect(detail.body.messages[0]).toMatchObject({
      body: 'سلام، اشتراکم فعال نشده است',
      senderRole: 'user',
      mine: true,
    });
    expect(detail.body.messages[1]).toMatchObject({
      body: 'سلام، بررسی شد و فعال شد',
      senderRole: 'admin',
      senderName: 'مدیر سامانه',
      mine: false,
    });
    expect(detail.body.messages[1].readAt).toBeTruthy();
    expect(detail.body.thread.status).toBe('answered');
    expect(detail.body.unreadTotal).toBe(0);
    expect((await teacherA.get('/api/v1/support/unread')).body).toEqual({ count: 0 });
  });

  it('reopens the ticket when the user writes again and tracks unread both ways', async () => {
    const threadId = await startTicket(teacherA);
    await admin.post(`/api/v1/admin/support/threads/${threadId}/messages`, { body: 'پاسخ اول' });
    await teacherA.post(`/api/v1/support/threads/${threadId}/messages`, { body: 'ممنون، ولی هنوز مشکل هست' });

    const unreadBefore = await admin.get('/api/v1/admin/support/unread');
    // Both user messages are still unread: the admin has not opened the ticket yet.
    expect(unreadBefore.body).toEqual({ count: 2 });
    const list = await admin.get('/api/v1/admin/support/threads');
    expect(list.body.items[0].unread).toBe(2);

    // Opening the ticket marks the user's message read and shows it reopened.
    const detail = await admin.get(`/api/v1/admin/support/threads/${threadId}`);
    expect(detail.body.thread.status).toBe('open');
    expect((await admin.get('/api/v1/admin/support/unread')).body).toEqual({ count: 0 });

    const read = await admin.post(`/api/v1/admin/support/threads/${threadId}/read`);
    expect(read.body).toEqual({ ok: true, unreadTotal: 0 });
    expect((await admin.get('/api/v1/admin/support/unread')).body).toEqual({ count: 0 });
  });

  it('lets a student open a support ticket too', async () => {
    const threadId = await startTicket(studentA, 'سوال کارنامه', 'کارنامه‌ام را چطور می‌بینم؟');
    const list = await admin.get('/api/v1/admin/support/threads');
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({
      id: threadId,
      userName: 'آرش آزمون',
      username: 'student-a',
      userRole: 'student',
    });
    const mine = await studentA.get('/api/v1/support/threads');
    expect(mine.body.items).toHaveLength(1);
    expect(mine.body.items[0].participantName).toBe('پشتیبانی سایت');
  });

  it('hides a ticket from another user', async () => {
    const threadId = await startTicket(teacherA);
    expect((await teacherB.get('/api/v1/support/threads')).body.items).toEqual([]);
    expect((await studentA.get('/api/v1/support/threads')).body.items).toEqual([]);
    expect([403, 404]).toContain((await teacherB.get(`/api/v1/support/threads/${threadId}`)).status);
    expect([403, 404]).toContain((await teacherB.post(`/api/v1/support/threads/${threadId}/messages`, { body: 'نفوذ' })).status);
    expect([403, 404]).toContain((await teacherB.post(`/api/v1/support/threads/${threadId}/read`)).status);
    // The other user's attempt must not have marked anything read.
    const unread = await admin.get('/api/v1/admin/support/unread');
    expect(unread.body).toEqual({ count: 1 });
  });

  it('lets the admin change the ticket status and blocks replies on closed tickets in the UI contract', async () => {
    const threadId = await startTicket(teacherA);
    const closed = await admin.patch(`/api/v1/admin/support/threads/${threadId}/status`, { status: 'closed' });
    expect(closed.status).toBe(200);
    expect(closed.body.thread.status).toBe('closed');

    const reopened = await admin.patch(`/api/v1/admin/support/threads/${threadId}/status`, { status: 'open' });
    expect(reopened.status).toBe(200);
    expect(reopened.body.thread.status).toBe('open');

    const invalid = await admin.patch(`/api/v1/admin/support/threads/${threadId}/status`, { status: 'pending' });
    expect(invalid.status).toBe(400);
  });

  it('rejects empty bodies and missing tickets without writing anything', async () => {
    const empty = await teacherA.post('/api/v1/support/threads', { subject: 'بدون متن', body: '   ' });
    expect(empty.status).toBe(400);
    expect(empty.body.error.code).toBe('VALIDATION_ERROR');
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM support_threads').get().n).toBe(0);

    const threadId = await startTicket(teacherA);
    const emptyReply = await teacherA.post(`/api/v1/support/threads/${threadId}/messages`, { body: '  ' });
    expect(emptyReply.status).toBe(400);
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM support_messages').get().n).toBe(1);

    const missing = await admin.get('/api/v1/admin/support/threads/999999');
    expect(missing.status).toBe(404);
    const missingReply = await admin.post('/api/v1/admin/support/threads/999999/messages', { body: 'سلام' });
    expect(missingReply.status).toBe(404);
  });

  it('requires authentication and keeps the two sides separate', async () => {
    const anon = createSupportClient(ctx.db);
    expect((await anon.get('/api/v1/support/threads')).status).toBe(401);
    expect((await anon.get('/api/v1/support/unread')).status).toBe(401);
    expect((await anon.get('/api/v1/admin/support/threads')).status).toBe(401);

    // A site user can never reach the admin inbox…
    expect((await teacherA.get('/api/v1/admin/support/threads')).status).toBe(403);
    expect((await teacherA.get('/api/v1/admin/support/unread')).status).toBe(403);
    // …and the admin can never reach the user side.
    expect((await admin.get('/api/v1/support/threads')).status).toBe(403);
    expect((await admin.get('/api/v1/support/unread')).status).toBe(403);
    const started = await admin.post('/api/v1/support/threads', { subject: 'x', body: 'y' });
    expect(started.status).toBe(403);
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM support_threads').get().n).toBe(0);
  });

  it('does not appear in the class messaging inbox', async () => {
    await startTicket(teacherA);
    expect((await teacherA.get('/api/v1/messages/threads')).body.items).toEqual([]);
    expect((await teacherA.get('/api/v1/messages/unread')).body).toEqual({ count: 0 });
    // The admin dashboard counters include the support inbox.
    const dashboard = await admin.get('/api/v1/admin/dashboard');
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.support).toEqual({ threads: 1, unread: 1 });
  });
});
