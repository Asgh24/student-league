import crypto from 'node:crypto';
import { Router } from 'express';
import { config } from '../config.js';
import { AppError, notFound } from '../lib/errors.js';
import { asyncHandler, isoNow } from '../lib/http.js';
import { schemas, validate } from '../lib/validate.js';
import { findById } from '../repositories/users.js';
import { requireTeacherAccount } from '../middleware/auth.js';
import { paymentProviderInfo, requestZarinpalPayment } from '../services/payments.js';
import {
  failPayment,
  listPlans,
  paymentJson,
  recentPayments,
  teacherAccess,
} from '../services/subscription.js';

/** `/api/v1/subscription` — current window, plans, checkout and history. */
export function createSubscriptionRouter({ db }) {
  const router = Router();
  router.use(requireTeacherAccount);

  router.get('/status', (req, res) => {
    const teacher = findById(db, req.user.id);
    res.json({
      subscription: teacherAccess(teacher),
      plans: listPlans(db, { activeOnly: true }),
      payments: recentPayments(db, req.user.id, 20),
      paymentProvider: paymentProviderInfo(),
      trialDays: config.trialDays,
    });
  });

  router.post(
    '/checkout',
    validate({ body: schemas.subscriptionCheckout }),
    asyncHandler(async (req, res) => {
      const teacher = findById(db, req.user.id);
      if (!teacher || teacher.role !== 'teacher') throw notFound('حساب معلم یافت نشد');
      const plan = db.prepare('SELECT * FROM subscription_plans WHERE id = ? AND active = 1').get(req.body.planId);
      if (!plan) throw notFound('طرح اشتراک انتخاب‌شده در دسترس نیست');

      const provider = paymentProviderInfo();
      if (!provider.configured) {
        throw new AppError(
          503,
          'PAYMENT_NOT_CONFIGURED',
          'درگاه پرداخت هنوز پیکربندی نشده است. لطفاً با مدیر سامانه تماس بگیرید',
        );
      }

      const info = db.prepare(`
        INSERT INTO payments (teacher_id, plan_id, plan_name, amount, days, status, provider, authority, created_at)
        VALUES (?, ?, ?, ?, ?, 'pending', ?, NULL, ?)
      `).run(
        teacher.id,
        plan.id,
        plan.name,
        plan.price,
        plan.days,
        config.payments.provider,
        isoNow(),
      );
      const paymentId = Number(info.lastInsertRowid);
      let payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);

      if (config.payments.provider === 'mock') {
        const authority = `mock-${crypto.randomUUID()}`;
        db.prepare('UPDATE payments SET authority = ? WHERE id = ?').run(authority, paymentId);
        payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);
        return res.status(201).json({
          payment: paymentJson(payment),
          provider: 'mock',
          redirectUrl: `${config.appBaseUrl}/payments/mock/${paymentId}`,
        });
      }

      const result = await requestZarinpalPayment({
        amountToman: plan.price,
        description: `خرید ${plan.name} — ${config.appName}`,
        callbackUrl: `${config.appBaseUrl}/payments/zarinpal/callback`,
      });
      if (!result.ok) {
        failPayment(db, paymentId, { error: result.error });
        throw new AppError(502, 'PAYMENT_GATEWAY_ERROR', result.error || 'درگاه پرداخت پاسخ نداد');
      }

      db.prepare('UPDATE payments SET authority = ? WHERE id = ?').run(result.authority, paymentId);
      payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);
      return res.status(201).json({
        payment: paymentJson(payment),
        provider: 'zarinpal',
        redirectUrl: result.gatewayUrl,
      });
    }),
  );

  /** Polling endpoint used by the return page to refresh a single payment. */
  router.get('/payments/:id', (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    const payment = db.prepare('SELECT * FROM payments WHERE id = ? AND teacher_id = ?').get(id, req.user.id);
    if (!payment) throw notFound('پرداخت یافت نشد');
    res.json({ payment: paymentJson(payment) });
  });

  return router;
}
