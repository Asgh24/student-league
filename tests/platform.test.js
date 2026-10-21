import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runAdminBootstrap } from '../src/bootstrap.js';
import { config } from '../src/config.js';
import { createUser, findByUsername } from '../src/repositories/users.js';
import { requestZarinpalPayment, verifyZarinpalPayment } from '../src/services/payments.js';
import { buildFixture } from './fixtures.js';
import { createClient, createTestDatabase } from './helpers.js';

let ctx;
let fixture;
let admin;
let teacher;
let student;

const ADMIN = { username: 'admin-test', password: 'admin-test-password', displayName: 'مدیر آزمون' };

beforeEach(async () => {
  process.env.ADMIN_USERNAME = ADMIN.username;
  process.env.ADMIN_PASSWORD = ADMIN.password;
  process.env.ADMIN_NAME = ADMIN.displayName;
  delete process.env.PAYMENT_PROVIDER;
  delete process.env.ZARINPAL_MERCHANT_ID;
  delete process.env.ZARINPAL_BASE_URL;
  ctx = createTestDatabase();
  fixture = buildFixture(ctx.db);
  const boot = runAdminBootstrap(ctx.db);
  expect(boot.created).toBe(true);

  admin = createClient(ctx.db);
  teacher = createClient(ctx.db);
  student = createClient(ctx.db);
  expect((await admin.login(ADMIN.username, ADMIN.password)).status).toBe(200);
  await teacher.login(fixture.teacherA.username, 'password-a1');
  await student.login(fixture.studentUserA.username, 'student-a1');
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.ADMIN_USERNAME;
  delete process.env.ADMIN_PASSWORD;
  delete process.env.ADMIN_NAME;
  delete process.env.PAYMENT_PROVIDER;
  delete process.env.ZARINPAL_MERCHANT_ID;
  delete process.env.ZARINPAL_BASE_URL;
  ctx.cleanup();
});

describe('teacher self-registration and trial', () => {
  it('creates a teacher with a 14-day trial and starts a session', async () => {
    const client = createClient(ctx.db);
    await client.csrf();
    const res = await client.post('/api/v1/auth/register', {
      displayName: 'خانم جدید',
      username: 'new-teacher',
      password: 'new-password-1',
    });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('teacher');
    expect(res.body.user.subscription.status).toBe('trial');
    expect(res.body.user.subscription.daysLeft).toBe(14);
    expect(res.body.trialDays).toBe(14);

    const me = await client.get('/api/v1/auth/me');
    expect(me.body.user.username).toBe('new-teacher');
    expect(me.body.user.subscription.active).toBe(true);

    const row = findByUsername(ctx.db, 'new-teacher');
    expect(row.trial_ends_at).toBeTruthy();
  });

  it('rejects duplicate and weak registrations', async () => {
    const client = createClient(ctx.db);
    await client.csrf();
    const duplicate = await client.post('/api/v1/auth/register', {
      displayName: 'تکراری',
      username: fixture.teacherA.username,
      password: 'password-1234',
    });
    expect(duplicate.status).toBe(409);

    const weak = await client.post('/api/v1/auth/register', {
      displayName: 'ضعیف',
      username: 'weak-teacher',
      password: 'short',
    });
    expect(weak.status).toBe(400);
    expect(weak.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('blocks an expired teacher and reopens access after an admin grant', async () => {
    const past = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const expiredUser = createUser(ctx.db, {
      username: 'expired-teacher',
      password: 'expired-pass-1',
      role: 'teacher',
      displayName: 'معلم منقضی',
      trialEndsAt: past,
    });
    const expired = createClient(ctx.db);
    await expired.login('expired-teacher', 'expired-pass-1');

    const blocked = await expired.get('/api/v1/leagues');
    expect(blocked.status).toBe(402);
    expect(blocked.body.error.code).toBe('SUBSCRIPTION_REQUIRED');

    const grant = await admin.post(`/api/v1/admin/teachers/${expiredUser.id}/subscription`, {
      days: 30,
      note: 'تمدید آزمون',
    });
    expect(grant.status).toBe(200);
    expect(grant.body.subscription.status).toBe('active');
    expect(grant.body.payment.provider).toBe('manual');
    expect(grant.body.payment.status).toBe('paid');

    const reopened = await expired.get('/api/v1/leagues');
    expect(reopened.status).toBe(200);
  });
});

describe('admin authorization and panel data', () => {
  it('logs the admin in and separates admin from teacher/student areas', async () => {
    const me = await admin.get('/api/v1/auth/me');
    expect(me.body.user.role).toBe('admin');

    const dashboard = await admin.get('/api/v1/admin/dashboard');
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.teachers.total).toBe(2);
    expect(dashboard.body.plans.active).toBe(3);

    expect((await teacher.get('/api/v1/admin/dashboard')).status).toBe(403);
    expect((await student.get('/api/v1/admin/dashboard')).status).toBe(403);
    expect((await admin.get('/api/v1/leagues')).status).toBe(403);
    expect((await admin.get('/api/v1/student/me')).status).toBe(403);
  });

  it('lists teachers with subscription state and supports search/filter', async () => {
    const res = await admin.get('/api/v1/admin/teachers');
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.counts.unlimited).toBe(2);

    const search = await admin.get('/api/v1/admin/teachers?search=teacher-a');
    expect(search.body.items).toHaveLength(1);
    expect(search.body.items[0].username).toBe('teacher-a');
    expect(search.body.items[0].leagueCount).toBe(1);
    expect(search.body.items[0].studentCount).toBe(3);

    const trial = await admin.get('/api/v1/admin/teachers?status=trial');
    expect(trial.body.items).toHaveLength(0);
  });

  it('creates a teacher with an explicit trial and edits plans', async () => {
    const created = await admin.post('/api/v1/admin/teachers', {
      displayName: 'معلم ساخته‌شده',
      username: 'admin-made-teacher',
      password: 'made-password-1',
      trialDays: 7,
    });
    expect(created.status).toBe(201);
    expect(created.body.teacher.subscription.status).toBe('trial');
    expect(created.body.teacher.subscription.daysLeft).toBe(7);

    const client = createClient(ctx.db);
    expect((await client.login('admin-made-teacher', 'made-password-1')).status).toBe(200);

    const plan = await admin.post('/api/v1/admin/plans', {
      name: 'طرح آزمون',
      days: 45,
      price: 250000,
      description: 'توضیح',
    });
    expect(plan.status).toBe(201);
    const planId = plan.body.item.id;

    const patched = await admin.patch(`/api/v1/admin/plans/${planId}`, { price: 300000, active: false });
    expect(patched.body.item.price).toBe(300000);
    expect(patched.body.item.active).toBe(false);

    await admin.del(`/api/v1/admin/plans/${planId}`);
    const plans = await admin.get('/api/v1/admin/plans');
    expect(plans.body.items.find((row) => row.id === planId).active).toBe(false);
    expect((await teacher.post('/api/v1/admin/plans', { name: 'x', days: 1, price: 1 })).status).toBe(403);
  });
});

describe('subscription checkout', () => {
  it('runs the mock gateway end-to-end and extends renewals', async () => {
    const status = await teacher.get('/api/v1/subscription/status');
    expect(status.status).toBe(200);
    expect(status.body.plans).toHaveLength(3);
    expect(status.body.paymentProvider.provider).toBe('mock');
    const monthly = status.body.plans.find((plan) => plan.days === 30);

    const checkout = await teacher.post('/api/v1/subscription/checkout', { planId: monthly.id });
    expect(checkout.status).toBe(201);
    expect(checkout.body.payment.status).toBe('pending');
    expect(checkout.body.redirectUrl).toBe(`${config.appBaseUrl}/payments/mock/${checkout.body.payment.id}`);

    const page = await teacher.get(`/payments/mock/${checkout.body.payment.id}`);
    expect(page.status).toBe(200);
    expect(page.text).toContain('پرداخت آزمایشی');

    const paid = await teacher.get(`/payments/mock/${checkout.body.payment.id}/success`);
    expect(paid.status).toBe(302);
    expect(paid.headers.location).toContain('payment=success');

    const active = await teacher.get('/api/v1/subscription/status');
    expect(active.body.subscription.status).toBe('active');
    const firstEnd = active.body.subscription.endsAt;
    expect(new Date(firstEnd).getTime()).toBeGreaterThan(Date.now() + 29 * 86400000);

    const repeat = await teacher.get(`/payments/mock/${checkout.body.payment.id}/success`);
    expect(repeat.status).toBe(302);
    const still = await teacher.get('/api/v1/subscription/status');
    expect(still.body.subscription.endsAt).toBe(firstEnd);

    const renewal = await teacher.post('/api/v1/subscription/checkout', { planId: monthly.id });
    await teacher.get(`/payments/mock/${renewal.body.payment.id}/success`);
    const renewed = await teacher.get('/api/v1/subscription/status');
    expect(new Date(renewed.body.subscription.endsAt).getTime()).toBeGreaterThan(new Date(firstEnd).getTime() + 29 * 86400000);

    const payments = await admin.get('/api/v1/admin/payments');
    expect(payments.status).toBe(200);
    expect(payments.body.items.filter((row) => row.status === 'paid')).toHaveLength(2);
  });

  it('rejects an unknown/inactive plan and requires a teacher session', async () => {
    const missing = await teacher.post('/api/v1/subscription/checkout', { planId: 9999 });
    expect(missing.status).toBe(404);
    expect((await student.get('/api/v1/subscription/status')).status).toBe(403);
    expect((await admin.post('/api/v1/subscription/checkout', { planId: 1 })).status).toBe(403);
  });
});

describe('zarinpal gateway client', () => {
  it('sends Rial amounts and accepts verify codes 100/101', async () => {
    process.env.ZARINPAL_MERCHANT_ID = 'merchant-test';
    process.env.ZARINPAL_BASE_URL = 'https://gateway.test';
    const fetchMock = vi.fn(async (url) => ({
      ok: true,
      status: 200,
      json: async () => (String(url).endsWith('/request.json')
        ? { data: { code: 100, authority: 'A000000000000000000000000000000001' } }
        : { data: { code: 101, ref_id: 12345, card_pan: '6037****1234' } }),
    }));

    const request = await requestZarinpalPayment({
      amountToman: 149000,
      description: 'اشتراک',
      callbackUrl: 'https://app.test/payments/zarinpal/callback',
      fetchImpl: fetchMock,
    });
    expect(request.ok).toBe(true);
    expect(request.gatewayUrl).toContain('/pg/StartPay/');
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body).amount).toBe(1490000);

    const verified = await verifyZarinpalPayment({
      amountToman: 149000,
      authority: request.authority,
      fetchImpl: fetchMock,
    });
    expect(verified.ok).toBe(true);
    expect(verified.alreadyVerified).toBe(true);
    expect(verified.refId).toBe('12345');
  });

  it('reports a clear error when the merchant id is missing', async () => {
    const result = await requestZarinpalPayment({
      amountToman: 1000,
      description: 'x',
      callbackUrl: 'https://app.test/cb',
      fetchImpl: vi.fn(),
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('ZARINPAL_MERCHANT_ID');
  });
});
