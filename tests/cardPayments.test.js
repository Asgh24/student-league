import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runAdminBootstrap } from '../src/bootstrap.js';
import { createUser } from '../src/repositories/users.js';
import { buildFixture } from './fixtures.js';
import { createClient, createTestDatabase } from './helpers.js';

const ADMIN = { username: 'admin-card', password: 'admin-card-password', displayName: 'مدیر کارت' };
const DAY_MS = 24 * 60 * 60 * 1000;
const CARD = { cardNumber: '6037 1234 5678 9012', cardHolder: 'سارا صاحب کارت', bankName: 'بانک ملی' };
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z0XcAAAAASUVORK5CYII=',
  'base64',
);

let ctx;
let fixture;
let admin;
let teacher;
let teacherB;
let student;
let plan;

function paymentRows() {
  return ctx.db.prepare("SELECT * FROM payments WHERE provider = 'card' ORDER BY id").all();
}

beforeEach(async () => {
  process.env.PAYMENT_PROVIDER = 'card';
  process.env.ADMIN_USERNAME = ADMIN.username;
  process.env.ADMIN_PASSWORD = ADMIN.password;
  process.env.ADMIN_NAME = ADMIN.displayName;
  ctx = createTestDatabase();
  fixture = buildFixture(ctx.db);
  // The raw fixture has no dates, which means the legacy unlimited account.
  // Card checkout tests need regular teachers whose access can expire.
  const expiredTrial = new Date(Date.now() - 3 * DAY_MS).toISOString();
  ctx.db.prepare('UPDATE users SET trial_ends_at = ? WHERE id IN (?, ?)').run(expiredTrial, fixture.teacherA.id, fixture.teacherB.id);
  plan = ctx.db.prepare('SELECT * FROM subscription_plans WHERE active = 1 ORDER BY sort_order, id LIMIT 1').get();
  expect(plan).toBeTruthy();
  const boot = runAdminBootstrap(ctx.db);
  expect(boot.created).toBe(true);

  admin = createClient(ctx.db);
  teacher = createClient(ctx.db);
  teacherB = createClient(ctx.db);
  student = createClient(ctx.db);
  expect((await admin.login(ADMIN.username, ADMIN.password)).status).toBe(200);
  await teacher.login(fixture.teacherA.username, 'password-a1');
  await teacherB.login(fixture.teacherB.username, 'password-b1');
  await student.login(fixture.studentUserA.username, 'student-a1');
});

afterEach(() => {
  delete process.env.PAYMENT_PROVIDER;
  delete process.env.ADMIN_USERNAME;
  delete process.env.ADMIN_PASSWORD;
  delete process.env.ADMIN_NAME;
  ctx.cleanup();
});

async function configureCard(overrides = {}) {
  const res = await admin.put('/api/v1/admin/payment-settings', { ...CARD, ...overrides });
  expect(res.status).toBe(200);
  return res;
}

async function submitText(text = 'شماره پیگیری ۱۲۳۴۵۶') {
  return teacher.post('/api/v1/subscription/card-checkout', {
    planId: plan.id,
    receiptText: text,
  });
}

describe('card settings', () => {
  it('lets only the admin publish normalized card details and shows them to teachers', async () => {
    const initial = await admin.get('/api/v1/admin/payment-settings');
    expect(initial.status).toBe(200);
    expect(initial.body.settings.cardNumber).toBe('');
    expect(initial.body.configured).toBe(false);

    const before = await teacher.get('/api/v1/subscription/status');
    expect(before.body.paymentProvider.provider).toBe('card');
    expect(before.body.paymentProvider.configured).toBe(false);

    const saved = await configureCard({ cardNumber: '۶۰۳۷ ۱۲۳۴-۵۶۷۸ ۹۰۱۲' });
    expect(saved.body.settings.cardNumber).toBe('6037123456789012');
    expect(saved.body.configured).toBe(true);

    const status = await teacher.get('/api/v1/subscription/status');
    expect(status.body.paymentProvider.configured).toBe(true);
    expect(status.body.paymentProvider.card).toMatchObject({
      cardNumber: '6037123456789012',
      cardHolder: CARD.cardHolder,
      bankName: CARD.bankName,
      configured: true,
    });

    expect((await student.get('/api/v1/admin/payment-settings')).status).toBe(403);
    expect((await teacher.put('/api/v1/admin/payment-settings', CARD)).status).toBe(403);
  });

  it('validates the card number and holder before saving', async () => {
    const badNumber = await admin.put('/api/v1/admin/payment-settings', { ...CARD, cardNumber: '123' });
    expect(badNumber.status).toBe(400);
    expect(badNumber.body.error.code).toBe('VALIDATION_ERROR');
    const badHolder = await admin.put('/api/v1/admin/payment-settings', { ...CARD, cardHolder: '' });
    expect(badHolder.status).toBe(400);
    expect(ctx.db.prepare('SELECT card_number FROM payment_settings WHERE id = 1').get().card_number).toBe('');
  });
});

describe('card-to-card checkout', () => {
  it('creates one pending receipt, notifies the admin and activates the exact plan once', async () => {
    await configureCard();
    const checkout = await submitText('واریز کردم، پیگیری ۱۲۳۴۵۶');
    expect(checkout.status).toBe(201);
    expect(checkout.body.payment).toMatchObject({
      provider: 'card',
      status: 'pending',
      planId: plan.id,
      planName: plan.name,
      amount: plan.price,
      days: plan.days,
      receiptText: 'واریز کردم، پیگیری ۱۲۳۴۵۶',
      hasReceiptImage: false,
    });

    const count = await admin.get('/api/v1/admin/payments/pending-count');
    expect(count.body.count).toBe(1);

    const dashboard = await admin.get('/api/v1/admin/dashboard');
    expect(dashboard.body.payments.pendingReceipts).toBe(1);

    const duplicate = await submitText('رسید دوم');
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('PENDING_CARD_PAYMENT');
    expect(paymentRows()).toHaveLength(1);

    const paymentId = checkout.body.payment.id;
    const before = Date.now();
    const approved = await admin.post(`/api/v1/admin/payments/${paymentId}/approve`, {});
    expect(approved.status).toBe(200);
    expect(approved.body.alreadyPaid).toBe(false);
    expect(approved.body.payment.status).toBe('paid');
    const end = new Date(approved.body.subscription.subscriptionEndsAt).getTime();
    expect(end - before).toBeGreaterThan(plan.days * DAY_MS - 5 * 60 * 1000);
    expect(end - before).toBeLessThan(plan.days * DAY_MS + 5 * 60 * 1000);

    const afterApproval = ctx.db.prepare('SELECT subscription_ends_at FROM users WHERE id = ?').get(fixture.teacherA.id);
    const again = await admin.post(`/api/v1/admin/payments/${paymentId}/approve`, {});
    expect(again.status).toBe(200);
    expect(again.body.alreadyPaid).toBe(true);
    const afterAgain = ctx.db.prepare('SELECT subscription_ends_at FROM users WHERE id = ?').get(fixture.teacherA.id);
    expect(afterAgain.subscription_ends_at).toBe(afterApproval.subscription_ends_at);
    expect((await admin.get('/api/v1/admin/payments/pending-count')).body.count).toBe(0);

    const teacherAfter = await teacher.get('/api/v1/subscription/status');
    expect(teacherAfter.body.subscription.status).toBe('active');
    expect(teacherAfter.body.payments.find((row) => row.id === paymentId)?.receiptText).toBe('واریز کردم، پیگیری ۱۲۳۴۵۶');
  });

  it('adds the plan duration to the remaining trial instead of replacing it', async () => {
    await configureCard();
    const fresh = createClient(ctx.db);
    await fresh.csrf();
    const registered = await fresh.post('/api/v1/auth/register', {
      displayName: 'معلم تازه‌وارد',
      username: 'trial-card-teacher',
      password: 'trial-card-password-1',
    });
    expect(registered.status).toBe(201);
    await fresh.csrf();
    const before = ctx.db.prepare("SELECT trial_ends_at, subscription_ends_at FROM users WHERE username = 'trial-card-teacher'").get();
    expect(before.subscription_ends_at).toBeNull();
    expect(before.trial_ends_at).toBeTruthy();

    const checkout = await fresh.post('/api/v1/subscription/card-checkout', {
      planId: plan.id,
      receiptText: 'رسید دورهٔ آزمایشی',
    });
    expect(checkout.status).toBe(201);
    const approved = await admin.post(`/api/v1/admin/payments/${checkout.body.payment.id}/approve`, {});
    expect(approved.status).toBe(200);
    const after = ctx.db.prepare("SELECT trial_ends_at, subscription_ends_at FROM users WHERE username = 'trial-card-teacher'").get();
    expect(after.trial_ends_at).toBe(before.trial_ends_at);
    const added = new Date(after.subscription_ends_at).getTime() - new Date(before.trial_ends_at).getTime();
    expect(added).toBe(plan.days * DAY_MS);
  });

  it('blocks students, the admin, and teachers without a card configured', async () => {
    const notConfigured = await submitText('رسید');
    expect(notConfigured.status).toBe(503);
    expect(notConfigured.body.error.code).toBe('CARD_NOT_CONFIGURED');

    await configureCard();
    expect((await student.post('/api/v1/subscription/card-checkout', { planId: plan.id, receiptText: 'x' })).status).toBe(403);
    expect((await admin.post('/api/v1/subscription/card-checkout', { planId: plan.id, receiptText: 'x' })).status).toBe(403);

    const noReceipt = await teacher.post('/api/v1/subscription/card-checkout', { planId: plan.id, receiptText: '   ' });
    expect(noReceipt.status).toBe(400);
    expect(noReceipt.body.error.code).toBe('RECEIPT_REQUIRED');

    const missingPlan = await teacher.post('/api/v1/subscription/card-checkout', { planId: 999999, receiptText: 'رسید' });
    expect(missingPlan.status).toBe(404);
  });

  it('does not let an unlimited account submit a payment that would shorten its access', async () => {
    await configureCard();
    createUser(ctx.db, {
      username: 'unlimited-card-teacher',
      password: 'unlimited-card-password-1',
      role: 'teacher',
      displayName: 'معلم دائمی',
    });
    const unlimited = createClient(ctx.db);
    await unlimited.login('unlimited-card-teacher', 'unlimited-card-password-1');
    const res = await unlimited.post('/api/v1/subscription/card-checkout', {
      planId: plan.id,
      receiptText: 'رسید',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('UNLIMITED_ACCESS');
    expect(paymentRows()).toHaveLength(0);
  });

  it('keeps card checkout disabled while another provider is active', async () => {
    await configureCard();
    process.env.PAYMENT_PROVIDER = 'mock';
    const res = await submitText('رسید');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('CARD_PAYMENT_DISABLED');
  });
});

describe('receipt privacy', () => {
  it('stores images privately and serves them only to the owner and an admin', async () => {
    await configureCard();
    const upload = await teacher.upload('/api/v1/subscription/card-checkout', {
      filename: 'receipt.png',
      buffer: TINY_PNG,
      contentType: 'image/png',
      fields: { planId: String(plan.id), receiptText: '' },
      fieldName: 'receipt',
    });
    expect(upload.status).toBe(201);
    expect(upload.body.payment.hasReceiptImage).toBe(true);
    const paymentId = upload.body.payment.id;
    const row = ctx.db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);
    expect(row.receipt_mime).toBe('image/png');
    expect(row.receipt_size).toBe(TINY_PNG.length);
    expect(row.receipt_file).toMatch(/^[0-9a-f-]+\.png$/);
    expect(fs.existsSync(path.join(ctx.uploadsDir, 'payment-receipts', row.receipt_file))).toBe(true);

    const own = await teacher.get(`/api/v1/subscription/payments/${paymentId}/receipt`);
    expect(own.status).toBe(200);
    expect(own.headers['content-type']).toContain('image/png');
    expect(own.headers['x-content-type-options']).toBe('nosniff');
    expect(own.body?.length ?? own.text?.length ?? 0).toBeGreaterThan(0);

    const otherTeacher = await teacherB.get(`/api/v1/subscription/payments/${paymentId}/receipt`);
    expect(otherTeacher.status).toBe(404);

    const adminView = await admin.get(`/api/v1/admin/payments/${paymentId}/receipt`);
    expect(adminView.status).toBe(200);
    expect(adminView.headers['cache-control']).toContain('no-store');
    expect((await student.get(`/api/v1/admin/payments/${paymentId}/receipt`)).status).toBe(403);
    expect((await teacher.get(`/api/v1/admin/payments/${paymentId}/receipt`)).status).toBe(403);
  });

  it('rejects a file whose bytes do not match its image extension', async () => {
    await configureCard();
    const res = await teacher.upload('/api/v1/subscription/card-checkout', {
      filename: 'fake.png',
      buffer: Buffer.from('this is not an image'),
      contentType: 'image/png',
      fields: { planId: String(plan.id) },
      fieldName: 'receipt',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_RECEIPT_IMAGE');
    expect(paymentRows()).toHaveLength(0);
    expect(fs.existsSync(path.join(ctx.uploadsDir, 'payment-receipts'))).toBe(false);
  });
});

describe('review actions', () => {
  it('rejects a receipt without extending access and allows a corrected receipt', async () => {
    await configureCard();
    const checkout = await submitText('رسید اشتباه');
    const paymentId = checkout.body.payment.id;
    const rejected = await admin.post(`/api/v1/admin/payments/${paymentId}/reject`, { reason: 'مبلغ هم‌خوان نیست' });
    expect(rejected.status).toBe(200);
    expect(rejected.body.payment.status).toBe('canceled');
    expect(rejected.body.payment.reviewNote).toBe('مبلغ هم‌خوان نیست');
    expect(ctx.db.prepare('SELECT subscription_ends_at FROM users WHERE id = ?').get(fixture.teacherA.id).subscription_ends_at).toBeNull();
    expect((await admin.get('/api/v1/admin/payments/pending-count')).body.count).toBe(0);

    const corrected = await submitText('رسید صحیح');
    expect(corrected.status).toBe(201);
    expect((await admin.post(`/api/v1/admin/payments/${paymentId}/approve`, {})).status).toBe(409);
    expect((await admin.post(`/api/v1/admin/payments/${paymentId}/reject`, { reason: 'دوباره' })).body.alreadyReviewed).toBe(true);
  });

  it('lets a teacher cancel only their own pending receipt', async () => {
    await configureCard();
    const checkout = await submitText('رسید اول');
    const paymentId = checkout.body.payment.id;

    expect((await teacherB.del(`/api/v1/subscription/payments/${paymentId}`)).status).toBe(404);
    expect((await teacherB.get('/api/v1/subscription/status')).body.payments).toHaveLength(0);

    const canceled = await teacher.del(`/api/v1/subscription/payments/${paymentId}`);
    expect(canceled.status).toBe(200);
    expect(canceled.body.payment.status).toBe('canceled');
    expect((await admin.get('/api/v1/admin/payments/pending-count')).body.count).toBe(0);
    expect((await submitText('رسید دوم')).status).toBe(201);
  });

  it('approval never downgrades a legacy unlimited teacher to a fixed term', async () => {
    const unlimited = createUser(ctx.db, {
      username: 'legacy-unlimited',
      password: 'legacy-unlimited-pass-1',
      role: 'teacher',
      displayName: 'حساب دائمی قدیمی',
    });
    const inserted = ctx.db.prepare(`
      INSERT INTO payments (teacher_id, plan_id, plan_name, amount, days, status, provider, receipt_text, created_at)
      VALUES (?, ?, ?, ?, ?, 'pending', 'card', 'رسید قدیمی', ?)
    `).run(unlimited.id, plan.id, plan.name, plan.price, plan.days, new Date().toISOString());

    const approved = await admin.post(`/api/v1/admin/payments/${inserted.lastInsertRowid}/approve`, {});
    expect(approved.status).toBe(200);
    expect(approved.body.subscription.status).toBe('unlimited');
    const after = ctx.db.prepare('SELECT trial_ends_at, subscription_ends_at FROM users WHERE id = ?').get(unlimited.id);
    expect(after.trial_ends_at).toBeNull();
    expect(after.subscription_ends_at).toBeNull();
  });

  it('refuses approval without a receipt and does not expose another teacher access', async () => {
    await configureCard();
    const inserted = ctx.db.prepare(`
      INSERT INTO payments (teacher_id, plan_id, plan_name, amount, days, status, provider, created_at)
      VALUES (?, ?, ?, ?, ?, 'pending', 'card', ?)
    `).run(fixture.teacherA.id, plan.id, plan.name, plan.price, plan.days, new Date().toISOString());

    const blocked = await admin.post(`/api/v1/admin/payments/${inserted.lastInsertRowid}/approve`, {});
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('RECEIPT_MISSING');
    expect(ctx.db.prepare('SELECT subscription_ends_at FROM users WHERE id = ?').get(fixture.teacherA.id).subscription_ends_at).toBeNull();
    ctx.db.prepare("UPDATE payments SET status = 'canceled' WHERE id = ?").run(inserted.lastInsertRowid);

    const beforeB = ctx.db.prepare('SELECT subscription_ends_at FROM users WHERE id = ?').get(fixture.teacherB.id).subscription_ends_at;
    const checkout = await submitText('رسید درست');
    expect(checkout.status).toBe(201);
    await admin.post(`/api/v1/admin/payments/${checkout.body.payment.id}/approve`, {});
    expect(ctx.db.prepare('SELECT subscription_ends_at FROM users WHERE id = ?').get(fixture.teacherB.id).subscription_ends_at).toBe(beforeB);
  });

  it('returns 404 for unknown payments and rejects non-card payments', async () => {
    const missing = await admin.post('/api/v1/admin/payments/99999/approve', {});
    expect(missing.status).toBe(404);

    const manual = ctx.db.prepare(`
      INSERT INTO payments (teacher_id, plan_name, amount, days, status, provider, created_at, paid_at)
      VALUES (?, 'تمدید دستی', 0, 10, 'paid', 'manual', ?, ?)
    `).run(fixture.teacherA.id, new Date().toISOString(), new Date().toISOString());
    const res = await admin.post(`/api/v1/admin/payments/${manual.lastInsertRowid}/approve`, {});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('NOT_CARD_PAYMENT');
  });
});
