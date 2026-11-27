import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { attachUser } from '../src/middleware/auth.js';
import { csrfProtection } from '../src/middleware/csrf.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { createSessionStore, sessionMiddleware } from '../src/middleware/session.js';
import { createAdmin } from '../src/repositories/admins.js';
import { createApiRouter } from '../src/routes/index.js';
import { createAssistantAccount } from '../src/services/assistants.js';
import { buildFixture } from './fixtures.js';
import { createTestDatabase } from './helpers.js';

/**
 * The notification router is mounted by the application wiring. This file
 * builds the same middleware chain as tests/support.test.js so the real HTTP
 * surface is exercised without booting the whole app.
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

function createClient(db) {
  const app = buildApp(db);
  const agent = request.agent(app);
  let token = null;

  const client = {
    agent,
    get: (url) => agent.get(url),
    post: (url, body = {}) => agent.post(url).set('x-csrf-token', token).send(body),
    del: (url) => agent.delete(url).set('x-csrf-token', token),
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

  teacherA = createClient(ctx.db);
  await teacherA.login('teacher-a', 'password-a1');
  teacherB = createClient(ctx.db);
  await teacherB.login('teacher-b', 'password-b1');
  studentA = createClient(ctx.db);
  await studentA.login('student-a', 'student-a1');
  studentB = createClient(ctx.db);
  await studentB.login('student-b', 'student-b1');

  createAdmin(ctx.db, { username: 'site-admin', password: 'admin-pass1', displayName: 'مدیر سامانه' });
  admin = createClient(ctx.db);
  await admin.login('site-admin', 'admin-pass1');
});

afterEach(() => {
  ctx.cleanup();
});

function compose(overrides = {}) {
  return {
    title: 'آزمون ریاضی فردا',
    body: 'فردا آزمون فصل سوم را فراموش نکنید.',
    category: 'warning',
    audience: 'all',
    ...overrides,
  };
}

async function sendLeagueNotice(client, leagueId, overrides = {}) {
  return client.post(`/api/v1/leagues/${leagueId}/notifications`, compose(overrides));
}

describe('teacher notifications', () => {
  it('fans out to the students of the league and tracks the unread badge', async () => {
    const sent = await sendLeagueNotice(teacherA, fixture.leagueA.id);
    expect(sent.status).toBe(201);
    expect(sent.body.notification).toMatchObject({
      source: 'teacher',
      senderName: 'خانم الف',
      title: 'آزمون ریاضی فردا',
      category: 'warning',
      link: '',
      pinned: false,
      readAt: null,
    });
    expect(sent.body.recipients).toEqual({ students: 3, accounts: 1, parents: 0 });
    expect(sent.body.sms).toBeNull();

    const inbox = await studentA.get('/api/v1/notifications');
    expect(inbox.status).toBe(200);
    expect(inbox.body.items).toHaveLength(1);
    expect(inbox.body.unreadTotal).toBe(1);
    expect(inbox.body.items[0]).toMatchObject({
      senderName: 'خانم الف',
      source: 'teacher',
      title: 'آزمون ریاضی فردا',
      readAt: null,
    });

    const unread = await studentA.get('/api/v1/notifications/unread');
    expect(unread.body.count).toBe(1);
    expect(unread.body.latest).toMatchObject({ title: 'آزمون ریاضی فردا' });

    const notificationId = inbox.body.items[0].id;
    const read = await studentA.post(`/api/v1/notifications/${notificationId}/read`);
    expect(read.body).toEqual({ ok: true, unreadTotal: 0 });
    expect((await studentA.get('/api/v1/notifications/unread')).body).toEqual({ count: 0, latest: null });

    const stillUnread = await studentA.get('/api/v1/notifications?unread=1');
    expect(stillUnread.body.items).toEqual([]);
    expect(stillUnread.body.total).toBe(0);

    const history = await teacherA.get(`/api/v1/leagues/${fixture.leagueA.id}/notifications`);
    expect(history.status).toBe(200);
    expect(history.body.items).toHaveLength(1);
    expect(history.body.items[0]).toMatchObject({
      audienceLabel: 'همه دانش‌آموزان لیگ',
      recipientCount: 1,
      readCount: 1,
    });
  });

  it('delivers a selected audience only to the picked students', async () => {
    const picked = fixture.studentsA[0].id;
    const sent = await sendLeagueNotice(teacherA, fixture.leagueA.id, {
      audience: 'selected',
      studentIds: [picked],
    });
    expect(sent.status).toBe(201);
    expect(sent.body.recipients.accounts).toBe(1);

    const history = await teacherA.get(`/api/v1/leagues/${fixture.leagueA.id}/notifications`);
    expect(history.body.items[0].audienceLabel).toBe('یک دانش‌آموز');

    // A student from another league can never be targeted through this league.
    const foreign = await sendLeagueNotice(teacherA, fixture.leagueA.id, {
      audience: 'selected',
      studentIds: [fixture.studentsB[0].id],
    });
    expect(foreign.status).toBe(400);
    expect(foreign.body.error.code).toBe('STUDENTS_NOT_FOUND');

    // Another teacher cannot reach teacher A's league at all.
    const blocked = await sendLeagueNotice(teacherB, fixture.leagueA.id);
    expect(blocked.status).toBe(403);
    expect((await teacherB.get(`/api/v1/leagues/${fixture.leagueA.id}/notifications`)).status).toBe(403);
  });

  it('rejects a notice with no in-app recipients unless parent SMS is requested', async () => {
    const noLoginStudent = fixture.studentsA[1].id;

    const rejected = await sendLeagueNotice(teacherA, fixture.leagueA.id, {
      audience: 'selected',
      studentIds: [noLoginStudent],
    });
    expect(rejected.status).toBe(400);
    expect(rejected.body.error.code).toBe('NO_RECIPIENTS');

    const withSms = await sendLeagueNotice(teacherA, fixture.leagueA.id, {
      audience: 'selected',
      studentIds: [noLoginStudent],
      sendSms: true,
    });
    expect(withSms.status).toBe(201);
    expect(withSms.body.recipients).toMatchObject({ students: 1, accounts: 0, parents: 0 });
    // No parent number: the SMS side reports the student as skipped.
    expect(withSms.body.sms).toMatchObject({ sent: 0, queued: 0, failed: 0, skipped: 1 });
  });

  it('queues one parent SMS per unique number when requested', async () => {
    ctx.db.prepare('UPDATE students SET parent_phone = ? WHERE id = ?')
      .run('09120000001', fixture.studentsA[0].id);
    ctx.db.prepare('UPDATE students SET parent_phone = ? WHERE id = ?')
      .run('09120000001', fixture.studentsA[1].id);

    const sent = await sendLeagueNotice(teacherA, fixture.leagueA.id, {
      audience: 'selected',
      studentIds: [fixture.studentsA[0].id, fixture.studentsA[1].id],
      sendSms: true,
    });
    expect(sent.status).toBe(201);
    expect(sent.body.recipients).toMatchObject({ students: 2, accounts: 1, parents: 2 });
    // sms.ir is not configured in tests, so the row waits in the local outbox.
    expect(sent.body.sms).toMatchObject({ queued: 1, skipped: 1, configured: false });

    const outbox = ctx.db.prepare("SELECT * FROM sms_messages WHERE kind = 'notice'").all();
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ mobile: '09120000001', status: 'queued' });
    expect(outbox[0].body).toContain('آزمون ریاضی فردا');

    const history = await teacherA.get(`/api/v1/leagues/${fixture.leagueA.id}/notifications`);
    expect(history.body.items[0].sms).toMatchObject({ queued: 1, skipped: 1 });
  });

  it('validates the text and refuses unsafe links', async () => {
    const empty = await sendLeagueNotice(teacherA, fixture.leagueA.id, { title: ' ', body: ' ' });
    expect(empty.status).toBe(400);
    expect(empty.body.error.code).toBe('VALIDATION_ERROR');
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM notifications').get().n).toBe(0);

    const unsafe = await sendLeagueNotice(teacherA, fixture.leagueA.id, { link: 'https://evil.example' });
    expect(unsafe.status).toBe(400);
    expect(unsafe.body.error.code).toBe('INVALID_LINK');

    const selected = await sendLeagueNotice(teacherA, fixture.leagueA.id, { audience: 'selected', studentIds: [] });
    expect(selected.status).toBe(400);
    expect(selected.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('admin notifications', () => {
  it('broadcasts to every user or one role', async () => {
    const everyone = await admin.post('/api/v1/admin/notifications', {
      title: 'اطلاعیه مهم سایت',
      body: 'نسخه جدید فردا منتشر می‌شود.',
      category: 'info',
      audience: 'all',
    });
    expect(everyone.status).toBe(201);
    expect(everyone.body.recipients.users).toBe(4);
    expect(everyone.body.notification).toMatchObject({ source: 'admin', senderName: 'مدیر سامانه' });

    for (const client of [teacherA, studentA, studentB]) {
      const inbox = await client.get('/api/v1/notifications');
      expect(inbox.body.items).toHaveLength(1);
      expect(inbox.body.unreadTotal).toBe(1);
    }

    const studentsOnly = await admin.post('/api/v1/admin/notifications', {
      title: 'فقط برای دانش‌آموزان',
      body: 'اردوی هفته آینده برگزار می‌شود.',
      audience: 'students',
    });
    expect(studentsOnly.status).toBe(201);
    expect(studentsOnly.body.recipients.users).toBe(2);
    expect((await teacherA.get('/api/v1/notifications')).body.items).toHaveLength(1);
    expect((await studentA.get('/api/v1/notifications')).body.items).toHaveLength(2);

    const history = await admin.get('/api/v1/admin/notifications');
    expect(history.body.items).toHaveLength(2);
    expect(history.body.items[0]).toMatchObject({ audienceLabel: 'همه دانش‌آموزان', recipientCount: 2 });
    expect(history.body.items[1]).toMatchObject({ audienceLabel: 'همه کاربران سایت', recipientCount: 4 });
  });

  it('keeps the admin broadcast admin-only', async () => {
    expect((await teacherA.post('/api/v1/admin/notifications', { title: 'x', body: 'y' })).status).toBe(403);
    expect((await studentA.post('/api/v1/admin/notifications', { title: 'x', body: 'y' })).status).toBe(403);
    const anon = createClient(ctx.db);
    await anon.csrf();
    expect((await anon.post('/api/v1/admin/notifications', { title: 'x', body: 'y' })).status).toBe(401);
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM notifications').get().n).toBe(0);
  });
});

describe('inbox privacy and lifecycle', () => {
  it('never shows or reads another user\'s copy', async () => {
    await sendLeagueNotice(teacherA, fixture.leagueA.id);
    expect((await studentB.get('/api/v1/notifications')).body.items).toEqual([]);

    const id = (await studentA.get('/api/v1/notifications')).body.items[0].id;
    expect((await studentB.post(`/api/v1/notifications/${id}/read`)).status).toBe(404);
    expect((await studentA.get('/api/v1/notifications/unread')).body.count).toBe(1);
    expect((await studentB.post('/api/v1/notifications/read-all')).body).toEqual({ ok: true, unreadTotal: 0 });
    expect((await studentA.get('/api/v1/notifications/unread')).body.count).toBe(1);
  });

  it('marks everything read and lets a user remove only their copy', async () => {
    await sendLeagueNotice(teacherA, fixture.leagueA.id);
    await admin.post('/api/v1/admin/notifications', { title: 'همگانی', body: 'متن' });
    expect((await studentA.get('/api/v1/notifications/unread')).body.count).toBe(2);

    const allRead = await studentA.post('/api/v1/notifications/read-all');
    expect(allRead.body).toEqual({ ok: true, unreadTotal: 0 });

    const items = (await studentA.get('/api/v1/notifications')).body.items;
    const teacherNotice = items.find((item) => item.source === 'teacher');
    const removed = await studentA.del(`/api/v1/notifications/${teacherNotice.id}`);
    expect(removed.status).toBe(200);
    expect(removed.body).toEqual({ ok: true, unreadTotal: 0 });
    expect((await studentA.get('/api/v1/notifications')).body.items).toHaveLength(1);

    // The sender's history still counts the other user and the deleted notice.
    const history = await teacherA.get(`/api/v1/leagues/${fixture.leagueA.id}/notifications`);
    expect(history.body.items[0].recipientCount).toBe(0);
    expect(history.body.items[0].readCount).toBe(0);
  });

  it('requires a signed-in user for the inbox', async () => {
    const anon = createClient(ctx.db);
    await anon.csrf();
    expect((await anon.get('/api/v1/notifications')).status).toBe(401);
    expect((await anon.get('/api/v1/notifications/unread')).status).toBe(401);
    expect((await anon.post('/api/v1/notifications/read-all')).status).toBe(401);
  });
});

describe('assistant permission', () => {
  it('lets an assistant compose only when the notifications permission is granted', async () => {
    createAssistantAccount(ctx.db, {
      ownerId: fixture.teacherA.id,
      leagueId: fixture.leagueA.id,
      username: 'helper-a',
      password: 'helper-pass1',
      displayName: 'همیار الف',
      permissions: [],
    });

    const helper = createClient(ctx.db);
    await helper.login('helper-a', 'helper-pass1');
    const blocked = await sendLeagueNotice(helper, fixture.leagueA.id);
    expect(blocked.status).toBe(403);

    ctx.db.prepare("UPDATE assistant_accounts SET permissions = '[\"notifications\"]' WHERE user_id = (SELECT id FROM users WHERE username = 'helper-a')").run();
    const allowed = await sendLeagueNotice(helper, fixture.leagueA.id);
    expect(allowed.status).toBe(201);
    expect(allowed.body.notification.senderName).toBe('همیار الف');
  });
});
