import fs from 'node:fs';
import { Router } from 'express';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { isoNow, paginate } from '../lib/http.js';
import { schemas, validate } from '../lib/validate.js';
import { config } from '../config.js';
import { findAdminByUsername } from '../repositories/admins.js';
import { createUser, findByUsername, findById, publicUser } from '../repositories/users.js';
import { requireAdmin } from '../middleware/auth.js';
import { createAdminSmsRouter } from './adminSms.js';
import {
  approveCardPayment,
  countPendingCardPayments,
  rejectCardPayment,
} from '../services/manualPayments.js';
import {
  getCardSettings,
  isCardConfigured,
  saveCardSettings,
} from '../services/paymentSettings.js';
import { paymentProviderInfo } from '../services/payments.js';
import { resolveReceiptPath } from '../services/receipts.js';
import {
  ensureTrialEnd,
  extendTeacherSubscription,
  listPlans,
  paymentJson,
  planJson,
  teacherAccess,
} from '../services/subscription.js';
import { smsConfig, smsCounts } from '../services/sms.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function teacherJson(row) {
  const user = publicUser(row);
  return {
    ...user,
    subscription: teacherAccess(row),
    leagueCount: row.league_count ?? 0,
    studentCount: row.student_count ?? 0,
    lastPaidAt: row.last_paid_at ?? null,
    createdAt: row.created_at,
  };
}

function teacherRows(db, search = '') {
  const needle = `%${String(search).trim()}%`;
  return db.prepare(`
    SELECT u.*,
      (SELECT COUNT(*) FROM leagues l WHERE l.teacher_id = u.id) AS league_count,
      (SELECT COUNT(*) FROM students s JOIN leagues l ON l.id = s.league_id WHERE l.teacher_id = u.id) AS student_count,
      (SELECT MAX(p.paid_at) FROM payments p WHERE p.teacher_id = u.id AND p.status = 'paid') AS last_paid_at
    FROM users u
    WHERE u.role = 'teacher'
      AND (? = '%%' OR u.username LIKE ? OR u.display_name LIKE ?)
    ORDER BY u.id DESC
  `).all(needle, needle, needle);
}

function matchesStatus(access, filter) {
  if (!filter || filter === 'all') return true;
  if (filter === 'active') return access.status === 'active' || access.status === 'unlimited';
  if (filter === 'trial') return access.status === 'trial';
  if (filter === 'expired') return access.status === 'expired';
  return true;
}

function countsOf(rows) {
  const counts = { total: rows.length, active: 0, trial: 0, expired: 0, unlimited: 0 };
  for (const row of rows) {
    const access = teacherAccess(row);
    if (access.status === 'trial') counts.trial += 1;
    else if (access.status === 'expired') counts.expired += 1;
    else if (access.status === 'unlimited') counts.unlimited += 1;
    else if (access.status === 'active') counts.active += 1;
  }
  counts.paying = counts.active;
  counts.activeTotal = counts.active + counts.unlimited;
  return counts;
}

/** `/api/v1/admin` — owner dashboard, teacher subscriptions, plans and payments. */
export function createAdminRouter({ db }) {
  const router = Router();
  router.use(requireAdmin);

  router.get('/dashboard', (_req, res) => {
    const teachers = teacherRows(db);
    const teacherCounts = countsOf(teachers);
    const since = new Date(Date.now() - 30 * DAY_MS).toISOString();
    const revenue = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count
      FROM payments WHERE status = 'paid'
    `).get();
    const recentRevenue = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count
      FROM payments WHERE status = 'paid' AND paid_at >= ?
    `).get(since);
    const pending = db.prepare("SELECT COUNT(*) AS n FROM payments WHERE status = 'pending'").get().n;
    const pendingReceipts = countPendingCardPayments(db);
    const cards = getCardSettings(db);
    const leagues = db.prepare('SELECT COUNT(*) AS n FROM leagues').get().n;
    const students = db.prepare('SELECT COUNT(*) AS n FROM students').get().n;
    const threads = db.prepare('SELECT COUNT(*) AS n FROM conversations').get().n;
    const messages = db.prepare('SELECT COUNT(*) AS n FROM messages').get().n;
    const recentPayments = db.prepare(`
      SELECT p.*, u.display_name AS teacher_name
      FROM payments p JOIN users u ON u.id = p.teacher_id
      ORDER BY p.id DESC LIMIT 8
    `).all().map(paymentJson);

    res.json({
      teachers: teacherCounts,
      revenue: {
        total: revenue.total,
        count: revenue.count,
        last30Days: recentRevenue.total,
        last30Count: recentRevenue.count,
      },
      payments: { pending, pendingReceipts },
      leagues,
      students,
      messages: { threads, messages },
      sms: { ...smsCounts(db), config: smsConfig() },
      plans: { total: listPlans(db).length, active: listPlans(db, { activeOnly: true }).length },
      recentPayments,
      trialDays: config.trialDays,
      paymentProvider: config.payments.provider,
      cardConfigured: isCardConfigured(cards),
    });
  });

  /** Destination card for manual card-to-card transfers. */
  router.get('/payment-settings', (_req, res) => {
    const settings = getCardSettings(db);
    res.json({
      settings,
      configured: isCardConfigured(settings),
      provider: paymentProviderInfo(db),
    });
  });

  router.put('/payment-settings', validate({ body: schemas.paymentSettings }), (req, res) => {
    const settings = saveCardSettings(db, {
      ...req.body,
      adminId: req.user.id,
      now: isoNow(),
    });
    res.json({
      settings,
      configured: isCardConfigured(settings),
      provider: paymentProviderInfo(db),
    });
  });

  router.get('/teachers', (req, res) => {
    const { page, limit, offset } = paginate(req.query, { defaultLimit: 50, maxLimit: 200 });
    const rows = teacherRows(db, req.query.search ?? '');
    const allCounts = countsOf(rows);
    const filtered = rows.filter((row) => matchesStatus(teacherAccess(row), String(req.query.status ?? '')));
    const items = filtered.slice(offset, offset + limit).map(teacherJson);
    res.json({
      items,
      total: filtered.length,
      page,
      limit,
      pages: Math.max(1, Math.ceil(filtered.length / limit)),
      counts: allCounts,
    });
  });

  router.get('/teachers/:id', (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    const row = teacherRows(db).find((teacher) => teacher.id === id);
    if (!row) throw notFound('معلم یافت نشد');
    res.json({ teacher: teacherJson(row) });
  });

  router.post(
    '/teachers',
    validate({ body: schemas.adminTeacherCreate }),
    (req, res) => {
      const { username, password, displayName, trialDays } = req.body;
      if (findByUsername(db, username) || findAdminByUsername(db, username)) {
        throw conflict('USERNAME_TAKEN', 'این نام کاربری قبلاً انتخاب شده است');
      }
      const now = Date.now();
      const user = createUser(db, {
        username,
        password,
        role: 'teacher',
        displayName,
        // An explicit 0 means "create without a trial", not unlimited access.
        trialEndsAt: trialDays > 0 ? ensureTrialEnd(now, trialDays) : new Date(now).toISOString(),
        subscriptionNote: trialDays > 0 ? `دورهٔ آزمایشی ${trialDays} روزه (ایجاد توسط مدیر)` : 'ایجاد توسط مدیر',
      });
      res.status(201).json({ teacher: teacherJson({ ...user, league_count: 0, student_count: 0, last_paid_at: null }) });
    },
  );

  router.post(
    '/teachers/:id/subscription',
    validate({ body: schemas.adminGrant }),
    (req, res) => {
      const id = Number.parseInt(req.params.id, 10);
      const teacher = findById(db, id);
      if (!teacher || teacher.role !== 'teacher') throw notFound('معلم یافت نشد');
      const now = Date.now();
      const grant = db.transaction(() => {
        const extended = extendTeacherSubscription(db, {
          teacherId: id,
          days: req.body.days,
          note: req.body.note,
          now,
        });
        if (!extended) throw notFound('معلم یافت نشد');
        const info = db.prepare(`
          INSERT INTO payments (
            teacher_id, plan_id, plan_name, amount, days, status, provider, note,
            created_at, paid_at, starts_at, ends_at
          ) VALUES (?, NULL, ?, 0, ?, 'paid', 'manual', ?, ?, ?, ?, ?)
        `).run(
          id,
          'تمدید دستی توسط مدیر',
          req.body.days,
          req.body.note || 'تمدید دستی',
          new Date(now).toISOString(),
          new Date(now).toISOString(),
          extended.startsAt,
          extended.endsAt,
        );
        return {
          extended,
          payment: paymentJson(db.prepare('SELECT * FROM payments WHERE id = ?').get(info.lastInsertRowid)),
        };
      })();
      res.json({ subscription: grant.extended.access, payment: grant.payment, teacher: teacherJson({
        ...findById(db, id), league_count: 0, student_count: 0, last_paid_at: null,
      }) });
    },
  );

  router.get('/plans', (_req, res) => {
    res.json({ items: listPlans(db) });
  });

  router.post('/plans', validate({ body: schemas.planCreate }), (req, res) => {
    const now = isoNow();
    const info = db.prepare(`
      INSERT INTO subscription_plans (name, days, price, description, active, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.body.name,
      req.body.days,
      req.body.price,
      req.body.description,
      req.body.active ? 1 : 0,
      req.body.sortOrder,
      now,
      now,
    );
    res.status(201).json({ item: planJson(db.prepare('SELECT * FROM subscription_plans WHERE id = ?').get(info.lastInsertRowid)) });
  });

  router.patch('/plans/:id', validate({ body: schemas.planUpdate }), (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    const existing = db.prepare('SELECT * FROM subscription_plans WHERE id = ?').get(id);
    if (!existing) throw notFound('طرح اشتراک یافت نشد');
    const fields = {
      name: 'name',
      days: 'days',
      price: 'price',
      description: 'description',
      active: 'active',
      sortOrder: 'sort_order',
    };
    const sets = [];
    const values = [];
    for (const [key, column] of Object.entries(fields)) {
      if (req.body[key] === undefined) continue;
      sets.push(`${column} = ?`);
      values.push(key === 'active' ? (req.body[key] ? 1 : 0) : req.body[key]);
    }
    sets.push('updated_at = ?');
    values.push(isoNow(), id);
    db.prepare(`UPDATE subscription_plans SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    res.json({ item: planJson(db.prepare('SELECT * FROM subscription_plans WHERE id = ?').get(id)) });
  });

  router.delete('/plans/:id', (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    const existing = db.prepare('SELECT * FROM subscription_plans WHERE id = ?').get(id);
    if (!existing) throw notFound('طرح اشتراک یافت نشد');
    db.prepare('UPDATE subscription_plans SET active = 0, updated_at = ? WHERE id = ?').run(isoNow(), id);
    res.json({ ok: true });
  });

  router.get('/payments/pending-count', (_req, res) => {
    res.json({ count: countPendingCardPayments(db) });
  });

  router.get('/payments', (req, res) => {
    const { page, limit, offset } = paginate(req.query, { defaultLimit: 50, maxLimit: 200 });
    const status = ['pending', 'paid', 'failed', 'canceled'].includes(String(req.query.status ?? ''))
      ? String(req.query.status)
      : '';
    const search = String(req.query.search ?? '').trim();
    const needle = `%${search}%`;
    const where = `
      WHERE (? = '' OR p.status = ?)
        AND (? = '' OR u.display_name LIKE ? OR u.username LIKE ?)
    `;
    const params = [status, status, search, needle, needle];
    const total = db.prepare(`
      SELECT COUNT(*) AS n FROM payments p JOIN users u ON u.id = p.teacher_id ${where}
    `).get(...params).n;
    const items = db.prepare(`
      SELECT p.*, u.display_name AS teacher_name
      FROM payments p JOIN users u ON u.id = p.teacher_id
      ${where}
      ORDER BY CASE WHEN p.provider = 'card' AND p.status = 'pending' THEN 0 ELSE 1 END,
               p.id DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset).map(paymentJson);
    res.json({
      items,
      total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(total / limit)),
      pendingReceipts: countPendingCardPayments(db),
    });
  });

  /** Receipt images are private; only an authenticated admin can stream them. */
  router.get('/payments/:id/receipt', (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    const payment = Number.isFinite(id)
      ? db.prepare('SELECT * FROM payments WHERE id = ?').get(id)
      : null;
    if (!payment || payment.provider !== 'card' || !payment.receipt_file) {
      throw notFound('تصویر رسید یافت نشد');
    }
    const resolved = resolveReceiptPath(payment.receipt_file);
    if (!resolved || !fs.existsSync(resolved)) throw notFound('تصویر رسید یافت نشد');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Disposition', 'inline');
    res.type(payment.receipt_mime || 'application/octet-stream');
    return res.sendFile(resolved);
  });

  router.post('/payments/:id/approve', validate({ body: schemas.adminPaymentReview }), (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) throw notFound('پرداخت یافت نشد');
    const result = approveCardPayment(db, id, { adminId: req.user.id, note: req.body.note });
    if (!result.ok) {
      if (result.reason === 'not-found') throw notFound('پرداخت یافت نشد');
      if (result.reason === 'not-card-payment') throw badRequest('NOT_CARD_PAYMENT', 'این پرداخت کارت به کارت نیست');
      if (result.reason === 'receipt-missing') throw conflict('RECEIPT_MISSING', 'این پرداخت رسید قابل بررسی ندارد');
      throw conflict('PAYMENT_NOT_PENDING', 'این پرداخت دیگر در انتظار بررسی نیست');
    }
    res.json({
      payment: result.payment,
      subscription: result.access,
      alreadyPaid: result.alreadyPaid,
    });
  });

  router.post('/payments/:id/reject', validate({ body: schemas.adminPaymentReject }), (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) throw notFound('پرداخت یافت نشد');
    const result = rejectCardPayment(db, id, { adminId: req.user.id, reason: req.body.reason });
    if (!result.ok) {
      if (result.reason === 'not-found') throw notFound('پرداخت یافت نشد');
      if (result.reason === 'not-card-payment') throw badRequest('NOT_CARD_PAYMENT', 'این پرداخت کارت به کارت نیست');
      if (result.reason === 'already-paid') throw conflict('PAYMENT_ALREADY_PAID', 'این پرداخت قبلاً تأیید شده است');
      throw conflict('PAYMENT_NOT_PENDING', 'این پرداخت دیگر در انتظار بررسی نیست');
    }
    res.json({ payment: result.payment, alreadyReviewed: result.alreadyReviewed });
  });

  router.use('/sms', createAdminSmsRouter({ db }));

  return router;
}
