import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAdmin } from '../src/repositories/admins.js';
import { queueMessage } from '../src/services/sms.js';
import { buildFixture } from './fixtures.js';
import { createClient, createTestDatabase } from './helpers.js';

let ctx;
let fixture;
let admin;
let teacher;

beforeEach(async () => {
  delete process.env.SMSIR_API_KEY;
  delete process.env.SMSIR_LINE_NUMBER;
  delete process.env.SMS_ENABLED;
  ctx = createTestDatabase();
  fixture = buildFixture(ctx.db);
  createAdmin(ctx.db, { username: 'sms-admin', password: 'sms-admin-pass', displayName: 'مدیر پیامک' });
  admin = createClient(ctx.db);
  teacher = createClient(ctx.db);
  expect((await admin.login('sms-admin', 'sms-admin-pass')).status).toBe(200);
  await teacher.login(fixture.teacherA.username, 'password-a1');
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.SMSIR_API_KEY;
  delete process.env.SMSIR_LINE_NUMBER;
  delete process.env.SMS_ENABLED;
  ctx.cleanup();
});

function configureSms() {
  process.env.SMSIR_API_KEY = 'sms-test-key';
  process.env.SMSIR_LINE_NUMBER = '30001234';
}

describe('admin SMS console', () => {
  it('shows configuration state and queues test messages when sms.ir is not configured', async () => {
    const overview = await admin.get('/api/v1/admin/sms');
    expect(overview.status).toBe(200);
    expect(overview.body.config.configured).toBe(false);
    expect(overview.body.counts.campaigns.queued).toBe(0);

    const sent = await admin.post('/api/v1/admin/sms/test', {
      mobile: '09121234567',
      message: 'پیام آزمایشی',
    });
    expect(sent.status).toBe(201);
    expect(sent.body.item.status).toBe('queued');
    expect(sent.body.delivery.queued).toBe(true);

    const credit = await admin.get('/api/v1/admin/sms/credit');
    expect(credit.status).toBe(200);
    expect(credit.body.ok).toBe(false);
    expect(credit.body.configured).toBe(false);
  });

  it('sends a normalized bulk list through sms.ir and reads credit', async () => {
    configureSms();
    const fetchMock = vi.fn(async (url, init) => {
      if (String(url).endsWith('/v1/credit')) {
        return { ok: true, status: 200, json: async () => ({ status: 1, data: 250000 }) };
      }
      expect(String(url)).toBe('https://api.sms.ir/v1/send/bulk');
      expect(init.headers['X-API-KEY']).toBe('sms-test-key');
      const body = JSON.parse(init.body);
      expect(body.lineNumber).toBe(30001234);
      expect(body.mobiles).toEqual(['09121234567', '09121234568']);
      return {
        ok: true,
        status: 200,
        json: async () => ({ status: 1, data: { packId: 7, messageIds: [101, 102], cost: 2400 } }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await admin.post('/api/v1/admin/sms/bulk', {
      mobiles: ['0912 123 4567', '+989121234568', '۰۹۱۲۱۲۳۴۵۶۷'],
      message: 'اطلاعیهٔ مهم',
    });
    expect(res.status).toBe(201);
    expect(res.body.count).toBe(2);
    expect(res.body.status).toBe('sent');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const campaigns = await admin.get('/api/v1/admin/sms/campaigns');
    expect(campaigns.body.items).toHaveLength(2);
    expect(campaigns.body.items.every((row) => row.status === 'sent')).toBe(true);

    const overview = await admin.get('/api/v1/admin/sms');
    expect(overview.body.counts.campaigns.sent).toBe(2);

    const credit = await admin.get('/api/v1/admin/sms/credit');
    expect(credit.body.ok).toBe(true);
    expect(credit.body.credit).toBe(250000);
  });

  it('rejects invalid numbers and non-admin access', async () => {
    configureSms();
    const invalid = await admin.post('/api/v1/admin/sms/bulk', {
      mobiles: ['09121234567', 'not-a-number'],
      message: 'متن',
    });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('INVALID_MOBILE');

    expect((await teacher.get('/api/v1/admin/sms')).status).toBe(403);
    expect((await teacher.post('/api/v1/admin/sms/test', { mobile: '09121234567', message: 'x' })).status).toBe(403);
  });

  it('retries a queued league report from the admin outbox', async () => {
    configureSms();
    const id = queueMessage(ctx.db, {
      leagueId: fixture.leagueA.id,
      studentId: fixture.studentsA[0].id,
      mobile: '09121234567',
      body: 'گزارش روزانه',
      kind: 'daily_report',
      reportDate: '2026-01-01',
    });
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ status: 1, data: { packId: 9, messageIds: [55], cost: 1200 } }),
    })));

    const retry = await admin.post(`/api/v1/admin/sms/messages/${id}/retry`, {});
    expect(retry.status).toBe(200);
    expect(retry.body.delivery.ok).toBe(true);

    const outbox = await admin.get('/api/v1/admin/sms/messages');
    expect(outbox.status).toBe(200);
    const row = outbox.body.items.find((item) => item.id === id);
    expect(row.status).toBe('sent');
    expect(row.studentName).toBe('آرش آزمون');
    expect(row.teacherName).toBe('خانم الف');
  });
});
