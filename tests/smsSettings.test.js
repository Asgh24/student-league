import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { todayIso } from '../src/lib/http.js';
import { buildSampleDailyMessage } from '../src/services/dailyReports.js';
import { createAdmin } from '../src/repositories/admins.js';
import { buildFixture } from './fixtures.js';
import { createClient, createTestDatabase } from './helpers.js';

let ctx;
let fixture;
let client;

beforeEach(async () => {
  delete process.env.SMSIR_API_KEY;
  delete process.env.SMSIR_LINE_NUMBER;
  delete process.env.SMS_ENABLED;
  ctx = createTestDatabase();
  fixture = buildFixture(ctx.db);
  client = createClient(ctx.db);
  await client.login('teacher-a', 'password-a1');
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.SMSIR_API_KEY;
  delete process.env.SMSIR_LINE_NUMBER;
  delete process.env.SMS_ENABLED;
  ctx.cleanup();
});

function disciplineColumn() {
  return fixture.columnsA.find((column) => column.name === 'انضباطی');
}

describe('teacher sms.ir settings', () => {
  it('returns a write-only configuration that starts unset', async () => {
    const res = await client.get('/api/v1/sms/settings');
    expect(res.status).toBe(200);
    expect(res.body.config).toMatchObject({
      provider: 'sms.ir',
      configured: false,
      source: 'none',
      hasApiKey: false,
      lineNumber: '',
      own: { hasApiKey: false, lineNumber: '' },
    });
    expect(res.body.config.apiKey).toBeUndefined();
  });

  it('saves encrypted credentials and uses them for the daily report', async () => {
    const saved = await client.put('/api/v1/sms/settings', {
      apiKey: 'teacher-sms-secret',
      lineNumber: '30009999',
    });
    expect(saved.status).toBe(200);
    expect(saved.body.config).toMatchObject({
      configured: true,
      source: 'teacher',
      lineNumber: '30009999',
      hasApiKey: true,
      own: { hasApiKey: true, lineNumber: '30009999' },
    });
    expect(saved.body.config.apiKey).toBeUndefined();

    const stored = ctx.db.prepare('SELECT sms_api_key, sms_line_number FROM users WHERE id = ?')
      .get(fixture.teacherA.id);
    expect(stored.sms_api_key).not.toBe('teacher-sms-secret');
    expect(stored.sms_api_key).toMatch(/^v1\./);
    expect(stored.sms_line_number).toBe('30009999');

    const first = fixture.studentsA[0];
    await client.patch(`/api/v1/leagues/${fixture.leagueA.id}/contacts/${first.id}`, {
      parentPhone: '09123456789',
      studentPhone: '',
    });
    await client.post(`/api/v1/leagues/${fixture.leagueA.id}/scores/record`, {
      studentId: first.id,
      columnId: disciplineColumn().id,
      delta: 10,
      reason: 'گزارش',
    });

    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ status: 1, data: { packId: 1, messageIds: [7], cost: 1200 } }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const sent = await client.post(`/api/v1/leagues/${fixture.leagueA.id}/reports/daily/send`, {
      date: todayIso(),
      studentIds: [first.id],
    });
    expect(sent.status).toBe(200);
    expect(sent.body.smsConfigured).toBe(true);
    expect(sent.body.sms.source).toBe('teacher');
    expect(sent.body.counts.sent).toBe(1);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.sms.ir/v1/send/bulk');
    expect(init.headers['X-API-KEY']).toBe('teacher-sms-secret');
    expect(JSON.parse(init.body).lineNumber).toBe(30009999);
  });

  it('keeps the saved key when only the line number is updated and clears it explicitly', async () => {
    await client.put('/api/v1/sms/settings', { apiKey: 'secret-1', lineNumber: '30001111' });
    const lineOnly = await client.put('/api/v1/sms/settings', { lineNumber: '30002222' });
    expect(lineOnly.body.config).toMatchObject({
      configured: true,
      source: 'teacher',
      lineNumber: '30002222',
      hasApiKey: true,
    });

    const cleared = await client.put('/api/v1/sms/settings', {
      apiKey: '',
      lineNumber: '',
      clearApiKey: true,
    });
    expect(cleared.body.config).toMatchObject({
      configured: false,
      source: 'none',
      hasApiKey: false,
      lineNumber: '',
    });
  });

  it('does not fall back to the server account while the teacher settings are incomplete', async () => {
    process.env.SMSIR_API_KEY = 'server-key';
    process.env.SMSIR_LINE_NUMBER = '30000001';

    const partial = await client.put('/api/v1/sms/settings', { lineNumber: '30003333' });
    expect(partial.body.config).toMatchObject({
      configured: false,
      source: 'none',
      partialOwnSettings: true,
      serverConfigured: true,
    });
    expect((await client.get('/api/v1/sms/settings')).body.config.source).toBe('none');
  });

  it('shows the same concrete sample text that the report formatter produces', async () => {
    const res = await client.get(`/api/v1/leagues/${fixture.leagueA.id}/reports/daily?date=2026-10-21`);
    expect(res.status).toBe(200);
    expect(res.body.sampleMessage).toBe(buildSampleDailyMessage({
      leagueName: fixture.leagueA.name,
      date: '2026-10-21',
    }));
    expect(res.body.sampleMessage).toContain('گزارش روزانه');
    expect(res.body.sampleMessage).toContain('علی رضایی');
    expect(res.body.sampleMessage).toContain('جمع تغییرات');
  });

  it('validates the line number and refuses other roles', async () => {
    const invalid = await client.put('/api/v1/sms/settings', { lineNumber: 'not-a-line' });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR');

    const student = createClient(ctx.db);
    await student.login('student-a', 'student-a1');
    expect((await student.get('/api/v1/sms/settings')).status).toBe(403);

    createAdmin(ctx.db, { username: 'settings-admin', password: 'settings-admin-pass', displayName: 'مدیر' });
    const admin = createClient(ctx.db);
    await admin.login('settings-admin', 'settings-admin-pass');
    expect((await admin.get('/api/v1/sms/settings')).status).toBe(403);
  });
});
