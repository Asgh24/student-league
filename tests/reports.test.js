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

async function setShadUrl(studentId, shadPvUrl) {
  return client.patch(`/api/v1/leagues/${fixture.leagueA.id}/contacts/${studentId}`, {
    parentPhone: '',
    studentPhone: '',
    shadPvUrl,
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
    expect(row.totalDelta).toBeUndefined();
    expect(row.changes).toBe(2);
    expect(row.lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ columnName: 'انضباطی', status: 'down' }),
      expect.objectContaining({ columnName: 'ریاضی', status: 'up' }),
    ]));
    expect(row.message).toContain('آرش آزمون');
    expect(row.message).not.toContain('-۱۰۰');
    expect(row.message).not.toContain('+۲۵');
    expect(row.message).toContain(`تاریخ: ${formatJalaliDate(today)}`);
    expect(row.message).toContain('لیگ الف');
    expect(row.message).toContain('وضعیت حضور: ثبت‌نشده');
    expect(row.message).toContain('انضباط: ثبت‌نشده');
    expect(row.message).toContain('ارزشیابی: انضباطی (کاهش)، ریاضی (بهبود)');

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
    expect(message).toContain('هنری (بهبود)');
    expect(message).toContain('و ۲ مورد دیگر');
    expect(message).not.toContain('فارسی');
    expect(message).not.toContain('+۶۰');
    expect(message.split('\n').map((line) => line.split(':')[0])).toEqual([
      'تاریخ', 'دانش‌آموز', 'وضعیت حضور', 'انضباط', 'ارزشیابی', 'تکالیف',
    ]);
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

  it('adds homework due on the report date with each student own status', async () => {
    const today = todayIso();
    const [first, second] = fixture.studentsA;
    const created = await client.post(`/api/v1/leagues/${fixture.leagueA.id}/homework`, {
      title: 'تمرین ریاضی', points: 10, dueDate: today,
    });
    const homeworkId = created.body.homework.id;
    const otherDay = await client.post(`/api/v1/leagues/${fixture.leagueA.id}/homework`, {
      title: 'تکلیف دیروز', points: 5, dueDate: '2026-01-01',
    });
    expect(otherDay.status).toBe(201);

    await client.post(`/api/v1/homework/${homeworkId}/status`, { studentId: first.id, status: 'done' });
    await client.post(`/api/v1/homework/${homeworkId}/status`, { studentId: second.id, status: 'absent' });

    const res = await client.get(`/api/v1/leagues/${fixture.leagueA.id}/reports/daily?date=${today}`);
    expect(res.status).toBe(200);

    const row = res.body.items.find((item) => item.studentId === first.id);
    expect(row.homework).toEqual([{ title: 'تمرین ریاضی', status: 'done' }]);
    expect(row.message).toContain('تکالیف: تمرین ریاضی (انجام شد)');
    expect(row.message).not.toContain('+۱۰');
    // The report item exposes only the direction of the change, never its points.
    expect(row.lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ columnName: 'انضباطی', status: 'up' }),
    ]));

    const absentRow = res.body.items.find((item) => item.studentId === second.id);
    expect(absentRow.homework).toEqual([{ title: 'تمرین ریاضی', status: 'absent' }]);
    expect(absentRow.message).toContain('تکالیف: تمرین ریاضی (غایب)');
    expect(absentRow.message).not.toContain('-۱۰');
    expect(absentRow.lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ columnName: 'انضباطی', status: 'down' }),
    ]));

    // A student with no status recorded defaults to انجام نشد, and homework
    // due on another day never appears.
    const untouched = res.body.items.find((item) => item.studentId === fixture.studentsA[2].id);
    expect(untouched.homework).toEqual([{ title: 'تمرین ریاضی', status: 'not_done' }]);
    expect(untouched.message).toContain('تکالیف: تمرین ریاضی (انجام نشد)');
    expect(res.body.items.every((item) => !item.message.includes('تکلیف دیروز'))).toBe(true);
  });

  it('renders the homework line in buildDailyMessage and the sample message', () => {
    const message = buildDailyMessage({
      leagueName: 'لیگ نمونه',
      studentName: 'علی رضایی',
      date: '2026-10-21',
      lines: [{ columnName: 'انضباطی', delta: 10 }],
      totalDelta: 10,
      homework: [
        { title: 'تمرین ریاضی', points: 10, status: 'done' },
        { title: 'خواندن', points: 5, status: 'incomplete' },
        { title: 'آزمایش', points: 5, penaltyPoints: 3, status: 'not_brought' },
      ],
    });
    expect(message).toContain('تکالیف: تمرین ریاضی (انجام شد)، خواندن (ناقص)، آزمایش (نیاورده)');
    expect(message).not.toContain('+۱۰');
    expect(message).not.toContain('-۳');
    const withoutHomework = buildDailyMessage({
      leagueName: 'لیگ نمونه', studentName: 'علی رضایی', date: '2026-10-21',
      lines: [], totalDelta: 0,
    });
    expect(withoutHomework).toContain('تکالیف: تکلیفی برای این روز ثبت نشده است');
    expect(withoutHomework).toContain('انضباط: ثبت‌نشده');
  });

  it('adds the attendance status and the discipline reason on their own lines', async () => {
    const today = todayIso();
    const [first, second] = fixture.studentsA;

    await client.post(`/api/v1/leagues/${fixture.leagueA.id}/attendance`, {
      date: today,
      records: [
        { studentId: first.id, status: 'late' },
        { studentId: second.id, status: 'absent' },
      ],
    });
    await client.post(`/api/v1/leagues/${fixture.leagueA.id}/discipline`, {
      date: today,
      records: [
        { studentId: first.id, status: 'disorderly', note: 'صحبت با همکلاسی' },
        { studentId: second.id, status: 'orderly' },
      ],
    });

    const res = await client.get(`/api/v1/leagues/${fixture.leagueA.id}/reports/daily?date=${today}`);
    expect(res.status).toBe(200);

    const firstRow = res.body.items.find((item) => item.studentId === first.id);
    expect(firstRow.attendanceStatus).toBe('late');
    expect(firstRow.discipline).toEqual({ status: 'disorderly', note: 'صحبت با همکلاسی' });
    expect(firstRow.message.split('\n')).toEqual([
      expect.stringContaining('تاریخ:'),
      'دانش‌آموز: آرش آزمون',
      'وضعیت حضور: تأخیر',
      'انضباط: بی‌نظمی — علت: صحبت با همکلاسی',
      'ارزشیابی: امروز تغییری ثبت نشده است',
      'تکالیف: تکلیفی برای این روز ثبت نشده است',
    ]);

    const secondRow = res.body.items.find((item) => item.studentId === second.id);
    expect(secondRow.message).toContain('وضعیت حضور: غایب');
    expect(secondRow.message).toContain('انضباط: منظم');
    expect(secondRow.message).not.toContain('علت:');
  });
});

describe('report delivery channels and Shad links', () => {
  it('exposes the Shad link of each parent in the daily report', async () => {
    const first = fixture.studentsA[0];
    await setShadUrl(first.id, 'https://web.shad.ir/#/pv/abc');

    const res = await client.get(`/api/v1/leagues/${fixture.leagueA.id}/reports/daily?date=${todayIso()}`);
    expect(res.status).toBe(200);
    expect(res.body.channels).toEqual({ sms: true, shad: true });
    expect(res.body.summary.shadReady).toBe(1);
    expect(res.body.summary.withoutShadUrl).toBe(2);

    const row = res.body.items.find((item) => item.studentId === first.id);
    expect(row).toMatchObject({
      shadPvUrl: 'https://web.shad.ir/#/pv/abc',
      hasShadPvUrl: true,
    });
  });

  it('saves teacher-wide channel switches and applies them to the report', async () => {
    const res = await client.put(`/api/v1/leagues/${fixture.leagueA.id}/reports/channels`, {
      sms: false,
      shad: true,
    });
    expect(res.status).toBe(200);
    expect(res.body.channels).toEqual({ sms: false, shad: true });

    const stored = ctx.db.prepare('SELECT report_sms_enabled, report_shad_enabled FROM users WHERE id = ?')
      .get(fixture.teacherA.id);
    expect(stored).toEqual({ report_sms_enabled: 0, report_shad_enabled: 1 });

    const report = await client.get(`/api/v1/leagues/${fixture.leagueA.id}/reports/daily?date=${todayIso()}`);
    expect(report.body.channels).toEqual({ sms: false, shad: true });
  });

  it('refuses SMS sends while the SMS channel is off', async () => {
    const first = fixture.studentsA[0];
    await setParentPhone(first.id, '09123456789');

    await client.put(`/api/v1/leagues/${fixture.leagueA.id}/reports/channels`, {
      sms: false,
      shad: true,
    });

    const daily = await client.post(`/api/v1/leagues/${fixture.leagueA.id}/reports/daily/send`, {
      date: todayIso(),
      studentIds: [first.id],
    });
    expect(daily.status).toBe(400);
    expect(daily.body.error.code).toBe('SMS_DISABLED');

    const custom = await client.post(`/api/v1/leagues/${fixture.leagueA.id}/reports/custom/send`, {
      studentIds: [first.id],
      message: 'پیام آزمایشی',
    });
    expect(custom.status).toBe(400);
    expect(custom.body.error.code).toBe('SMS_DISABLED');

    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM sms_messages').get().n).toBe(0);
  });

  it('validates channel switches and keeps the league private', async () => {
    const invalid = await client.put(`/api/v1/leagues/${fixture.leagueA.id}/reports/channels`, {});
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR');

    const other = createClient(ctx.db);
    await other.login('teacher-b', 'password-b1');
    const foreign = await other.put(`/api/v1/leagues/${fixture.leagueA.id}/reports/channels`, {
      sms: false,
      shad: false,
    });
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

describe('custom parent message', () => {
  it('queues the exact teacher text and skips students without a parent number', async () => {
    const [first, second] = fixture.studentsA;
    await setParentPhone(first.id, '09123456789');
    const text = 'سلام، احتراماً به اطلاع می‌رسانم آرش امروز در کلاس بی‌نظمی کرد. لطفاً در خانه پیگیری کنید.';

    const res = await client.post(`/api/v1/leagues/${fixture.leagueA.id}/reports/custom/send`, {
      studentIds: [first.id, second.id],
      message: text,
    });
    expect(res.status).toBe(200);
    expect(res.body.counts).toEqual({ sent: 0, queued: 1, failed: 0, skipped: 1 });
    expect(res.body.results.find((item) => item.studentId === second.id))
      .toMatchObject({ status: 'skipped', reason: 'NO_PARENT_PHONE' });

    const stored = ctx.db.prepare('SELECT mobile, body, kind, status, report_date FROM sms_messages').all();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      mobile: '09123456789',
      body: text,
      kind: 'custom',
      status: 'queued',
      report_date: todayIso(),
    });
  });

  it('sends the custom text through the configured provider', async () => {
    const first = fixture.studentsA[0];
    await setParentPhone(first.id, '09123456789');

    process.env.SMSIR_API_KEY = 'test-api-key';
    process.env.SMSIR_LINE_NUMBER = '30001234';
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ status: 1, message: 'موفق', data: { packId: 6, messageIds: [123], cost: 1200 } }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const text = 'تذکر انضباطی: لطفاً فردا برای هماهنگی به مدرسه مراجعه کنید.';
    const res = await client.post(`/api/v1/leagues/${fixture.leagueA.id}/reports/custom/send`, {
      studentIds: [first.id],
      message: text,
    });
    expect(res.status).toBe(200);
    expect(res.body.counts.sent).toBe(1);
    expect(res.body.smsConfigured).toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.sms.ir/v1/send/bulk');
    expect(init.headers['X-API-KEY']).toBe('test-api-key');
    expect(JSON.parse(init.body).messageText).toBe(text);
  });

  it('rejects an empty message and protects the league from other teachers', async () => {
    const first = fixture.studentsA[0];
    await setParentPhone(first.id, '09123456789');

    const empty = await client.post(`/api/v1/leagues/${fixture.leagueA.id}/reports/custom/send`, {
      studentIds: [first.id],
      message: '   ',
    });
    expect(empty.status).toBe(400);
    expect(empty.body.error.code).toBe('VALIDATION_ERROR');

    const other = createClient(ctx.db);
    await other.login('teacher-b', 'password-b1');
    const foreign = await other.post(`/api/v1/leagues/${fixture.leagueA.id}/reports/custom/send`, {
      studentIds: [first.id],
      message: 'پیام غیرمجاز',
    });
    expect(foreign.status).toBe(403);
  });
});
