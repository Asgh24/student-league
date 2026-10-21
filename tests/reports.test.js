import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDailyMessage } from '../src/services/dailyReports.js';
import { formatJalaliDate } from '../src/lib/jalali.js';
import { todayIso } from '../src/lib/http.js';
import { buildFixture } from './fixtures.js';
import { createClient, createTestDatabase } from './helpers.js';

let ctx;
let fixture;
let client;

function disciplineColumn() {
  return fixture.columnsA.find((column) => column.name === 'انضباطی');
}

async function record(studentId, delta, columnId = disciplineColumn().id) {
  return client.post(`/api/v1/leagues/${fixture.leagueA.id}/scores/record`, {
    studentId,
    columnId,
    delta,
    reason: 'گزارش روزانه',
  });
}

async function setParentPhone(studentId, phone) {
  return client.patch(`/api/v1/leagues/${fixture.leagueA.id}/contacts/${studentId}`, {
    parentPhone: phone,
    studentPhone: '',
  });
}

beforeEach(async () => {
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

describe('daily parent report data', () => {
  it('groups the day changes per student and builds the SMS text', async () => {
    const [first, second] = fixture.studentsA;
    expect((await record(first.id, -100)).status).toBe(200);
    expect((await record(first.id, 25, fixture.columnsA.find((column) => column.name === 'ریاضی').id)).status).toBe(200);
    expect((await record(second.id, 50)).status).toBe(200);

    const today = todayIso();
    const res = await client.get(`/api/v1/leagues/${fixture.leagueA.id}/reports/daily?date=${today}`);
    expect(res.status).toBe(200);
    expect(res.body.date).toBe(today);
    expect(res.body.items).toHaveLength(3);
    expect(res.body.summary.changed).toBe(2);
    expect(res.body.summary.withoutParentPhone).toBe(3);

    const row = res.body.items.find((item) => item.studentId === first.id);
    expect(row.totalDelta).toBe(-75);
    expect(row.changes).toBe(2);
    expect(row.lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ columnName: 'انضباطی', delta: -100 }),
      expect.objectContaining({ columnName: 'ریاضی', delta: 25 }),
    ]));
    expect(row.message).toContain('آرش آزمون');
    expect(row.message).toContain('-۱۰۰');
    expect(row.message).toContain(`گزارش روزانه ${formatJalaliDate(today)}`);
    expect(row.message).toContain('جمع تغییرات: -۷۵');

    const untouched = res.body.items.find((item) => item.studentId === fixture.studentsA[2].id);
    expect(untouched.changes).toBe(0);
    expect(untouched.message).toContain('امروز تغییری ثبت نشده است');
  });

  it('trims the message to the strongest lines', () => {
    const message = buildDailyMessage({
      leagueName: 'لیگ نمونه',
      studentName: 'علی رضایی',
      date: '2026-10-21',
      lines: [
        { columnName: 'ریاضی', delta: 10 },
        { columnName: 'فارسی', delta: 20 },
        { columnName: 'علوم', delta: -30 },
        { columnName: 'مطالعات', delta: 40 },
        { columnName: 'هدیه', delta: -50 },
        { columnName: 'هنری', delta: 60 },
      ],
      totalDelta: 50,
    });
    expect(message).toContain('هنری +۶۰');
    expect(message).toContain('و ۲ مورد دیگر');
    expect(message).not.toContain('فارسی');
    expect(message).toContain('جمع تغییرات: +۵۰');
  });

  it('defaults to today and hides the report from other teachers', async () => {
    const res = await client.get(`/api/v1/leagues/${fixture.leagueA.id}/reports/daily`);
    expect(res.status).toBe(200);
    expect(res.body.date).toBe(todayIso());

    const other = createClient(ctx.db);
    await other.login('teacher-b', 'password-b1');
    const foreign = await other.get(`/api/v1/leagues/${fixture.leagueA.id}/reports/daily`);
    expect(foreign.status).toBe(403);
  });
});

describe('sending the daily report', () => {
  it('queues the messages when sms.ir is not configured', async () => {
    const first = fixture.studentsA[0];
    await setParentPhone(first.id, '09123456789');
    await record(first.id, -100);

    const today = todayIso();
    const res = await client.post(`/api/v1/leagues/${fixture.leagueA.id}/reports/daily/send`, {
      date: today,
      studentIds: [first.id, fixture.studentsA[1].id],
    });
    expect(res.status).toBe(200);
    expect(res.body.smsConfigured).toBe(false);
    expect(res.body.counts).toEqual({ sent: 0, queued: 1, failed: 0, skipped: 1 });

    const queued = res.body.results.find((result) => result.studentId === first.id);
    expect(queued.status).toBe('queued');
    const skipped = res.body.results.find((result) => result.studentId === fixture.studentsA[1].id);
    expect(skipped).toMatchObject({ status: 'skipped', reason: 'NO_PARENT_PHONE' });

    const stored = ctx.db.prepare('SELECT mobile, status, body, report_date FROM sms_messages').all();
    expect(stored).toHaveLength(1);
    expect(stored[0].mobile).toBe('09123456789');
    expect(stored[0].status).toBe('queued');
    expect(stored[0].report_date).toBe(today);
    expect(stored[0].body).toContain('آرش آزمون');
    expect(res.body.recent).toHaveLength(1);
    expect(res.body.summary.queued).toBe(1);
  });

  it('rejects an empty student selection', async () => {
    const res = await client.post(`/api/v1/leagues/${fixture.leagueA.id}/reports/daily/send`, {
      date: todayIso(),
      studentIds: [],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('delivers through sms.ir when credentials are configured', async () => {
    const first = fixture.studentsA[0];
    await setParentPhone(first.id, '09123456789');
    await record(first.id, -100);

    process.env.SMSIR_API_KEY = 'test-api-key';
    process.env.SMSIR_LINE_NUMBER = '30001234';
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ status: 1, message: 'موفق', data: { packId: 5, messageIds: [99], cost: 1200 } }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await client.post(`/api/v1/leagues/${fixture.leagueA.id}/reports/daily/send`, {
      date: todayIso(),
      studentIds: [first.id],
    });
    expect(res.status).toBe(200);
    expect(res.body.smsConfigured).toBe(true);
    expect(res.body.counts.sent).toBe(1);
    expect(res.body.results[0].status).toBe('sent');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.sms.ir/v1/send/bulk');
    expect(init.method).toBe('POST');
    expect(init.headers['X-API-KEY']).toBe('test-api-key');
    const body = JSON.parse(init.body);
    expect(body.lineNumber).toBe(30001234);
    expect(body.mobiles).toEqual(['09123456789']);
    expect(body.messageText).toContain('آرش آزمون');

    const stored = ctx.db.prepare('SELECT status, provider, provider_message_id FROM sms_messages').get();
    expect(stored).toEqual({ status: 'sent', provider: 'sms.ir', provider_message_id: '99' });
  });

  it('marks the outbox row as failed when sms.ir rejects the message', async () => {
    const first = fixture.studentsA[0];
    await setParentPhone(first.id, '09123456789');

    process.env.SMSIR_API_KEY = 'bad-key';
    process.env.SMSIR_LINE_NUMBER = '30001234';
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ status: 0, message: 'کلید API نامعتبر است' }),
    })));

    const res = await client.post(`/api/v1/leagues/${fixture.leagueA.id}/reports/daily/send`, {
      date: todayIso(),
      studentIds: [first.id],
    });
    expect(res.status).toBe(200);
    expect(res.body.counts.failed).toBe(1);
    expect(res.body.results[0].error).toContain('کلید API نامعتبر');

    const stored = ctx.db.prepare('SELECT status, error FROM sms_messages').get();
    expect(stored.status).toBe('failed');
    expect(stored.error).toContain('کلید API نامعتبر');
  });
});
