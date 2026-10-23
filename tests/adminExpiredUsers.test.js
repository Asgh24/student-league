import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runAdminBootstrap } from '../src/bootstrap.js';
import { buildFixture } from './fixtures.js';
import { createClient, createTestDatabase } from './helpers.js';

const ADMIN = { username: 'admin-expired', password: 'admin-expired-password', displayName: 'مدیر حذف' };
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');

let ctx;
let fixture;
let admin;
let teacher;

function expire(teacherId) {
  const past = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  ctx.db.prepare('UPDATE users SET trial_ends_at = ?, subscription_ends_at = NULL WHERE id = ?').run(past, teacherId);
}

beforeEach(async () => {
  process.env.ADMIN_USERNAME = ADMIN.username;
  process.env.ADMIN_PASSWORD = ADMIN.password;
  process.env.ADMIN_NAME = ADMIN.displayName;
  ctx = createTestDatabase();
  fixture = buildFixture(ctx.db);
  expect(runAdminBootstrap(ctx.db).created).toBe(true);

  admin = createClient(ctx.db);
  teacher = createClient(ctx.db);
  expect((await admin.login(ADMIN.username, ADMIN.password)).status).toBe(200);
  expect((await teacher.login(fixture.teacherA.username, 'password-a1')).status).toBe(200);
});

afterEach(() => {
  ctx.cleanup();
  delete process.env.ADMIN_USERNAME;
  delete process.env.ADMIN_PASSWORD;
  delete process.env.ADMIN_NAME;
});

describe('admin expired-user cleanup', () => {
  it('lists only teachers whose access has completely ended', async () => {
    expire(fixture.teacherA.id);

    const res = await admin.get('/api/v1/admin/expired-users');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].id).toBe(fixture.teacherA.id);
    expect(res.body.items[0].subscription.status).toBe('expired');
    expect(res.body.items[0].storage.limitBytes).toBe(70 * 1024 * 1024);

    const empty = await admin.get(`/api/v1/admin/expired-users?search=${encodeURIComponent('teacher-b')}`);
    expect(empty.body.total).toBe(0);
  });

  it('deletes the expired teacher, cascades data and removes uploaded blobs', async () => {
    const upload = await teacher.upload(`/api/v1/leagues/${fixture.leagueA.id}/files`, {
      filename: 'lesson.pdf',
      buffer: PDF,
      contentType: 'application/pdf',
    });
    expect(upload.status).toBe(201);
    const stored = ctx.db.prepare('SELECT stored_name AS name FROM files WHERE id = ?').get(upload.body.file.id);
    const blob = path.join(ctx.uploadsDir, stored.name);
    expect(fs.existsSync(blob)).toBe(true);

    expire(fixture.teacherA.id);
    const res = await admin.del(`/api/v1/admin/teachers/${fixture.teacherA.id}`, {
      confirmUsername: fixture.teacherA.username,
    });
    expect(res.status).toBe(200);
    expect(res.body.deleted.files).toBe(1);
    expect(res.body.deleted.fileBytes).toBe(PDF.length);
    expect(res.body.deleted.leagues).toBe(1);
    expect(res.body.deleted.students).toBe(3);
    expect(res.body.deleted.studentUsers).toBe(1);

    expect(fs.existsSync(blob)).toBe(false);
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM users WHERE id = ?').get(fixture.teacherA.id).n).toBe(0);
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM users WHERE id = ?').get(fixture.studentUserA.id).n).toBe(0);
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM users WHERE id = ?').get(fixture.studentUserB.id).n).toBe(1);
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM leagues WHERE teacher_id = ?').get(fixture.teacherA.id).n).toBe(0);
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM files').get().n).toBe(0);
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM students WHERE league_id = ?').get(fixture.leagueA.id).n).toBe(0);

    const me = await teacher.get('/api/v1/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user).toBeNull();

    expect((await admin.del(`/api/v1/admin/teachers/${fixture.teacherA.id}`, {
      confirmUsername: fixture.teacherA.username,
    })).status).toBe(404);
  });

  it('refuses active accounts, wrong confirmation and non-admin callers', async () => {
    const active = await admin.del(`/api/v1/admin/teachers/${fixture.teacherB.id}`, {
      confirmUsername: fixture.teacherB.username,
    });
    expect(active.status).toBe(409);
    expect(active.body.error.code).toBe('TEACHER_NOT_EXPIRED');

    expire(fixture.teacherA.id);
    const wrong = await admin.del(`/api/v1/admin/teachers/${fixture.teacherA.id}`, {
      confirmUsername: 'someone-else',
    });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.code).toBe('CONFIRMATION_MISMATCH');
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM users WHERE id = ?').get(fixture.teacherA.id).n).toBe(1);

    const denied = await teacher.del(`/api/v1/admin/teachers/${fixture.teacherA.id}`, {
      confirmUsername: fixture.teacherA.username,
    });
    expect(denied.status).toBe(403);
  });
});
