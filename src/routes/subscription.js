import crypto from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import { config } from '../config.js';
import { AppError, badRequest, conflict, notFound } from '../lib/errors.js';
import { asyncHandler, isoNow } from '../lib/http.js';
import { schemas, validate } from '../lib/validate.js';
import { findById } from '../repositories/users.js';
import { requireTeacherAccount, requireOwnerTeacher } from '../middleware/auth.js';
import { cancelCardPayment } from '../services/manualPayments.js';
import { getCardSettings, isCardConfigured } from '../services/paymentSettings.js';
import { paymentProviderInfo, requestZarinpalPayment } from '../services/payments.js';
import {
  removeReceipt,
  resolveReceiptPath,
  validateReceiptImage,
  writeReceipt,
} from '../services/receipts.js';
import {
  failPayment,
  listPlans,
  paymentJson,
  recentPayments,
  teacherAccess,
} from '../services/subscription.js';
import { decodeUploadFilename, sanitizeFilename } from './files.js';

/** `/api/v1/subscription` — current window, plans, checkout and history. */
export function createSubscriptionRouter({ db }) {
  const router = Router();
  router.use(requireTeacherAccount, requireOwnerTeacher);

  const receiptUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.limits.maxReceiptBytes, files: 1, fields: 4 },
  });

  router.get('/status', (req, res) => {
    const teacher = findById(db, req.user.id);
    res.json({
      subscription: teacherAccess(teacher),
      plans: listPlans(db, { activeOnly: true }),
      payments: recentPayments(db, req.user.id, 20),
      paymentProvider: paymentProviderInfo(db),
      receiptMaxBytes: config.limits.maxReceiptBytes,
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
      if (teacherAccess(teacher).status === 'unlimited') {
        throw badRequest(
          'UNLIMITED_ACCESS',
          'این حساب دسترسی نامحدود دارد و نیازی به خرید یا تمدید اشتراک نیست',
        );
      }

      const provider = paymentProviderInfo(db);
      if (provider.provider === 'card') {
        throw new AppError(
          400,
          'CARD_PAYMENT_REQUIRED',
          'پرداخت کارت به کارت از مسیر ثبت رسید انجام می‌شود',
        );
      }
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
        provider.provider,
        isoNow(),
      );
      const paymentId = Number(info.lastInsertRowid);
      let payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);

      if (provider.provider === 'mock') {
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

  /**
   * Manual card-to-card checkout. The plan/price/days are snapshotted into the
   * payment row so later plan edits cannot change an already-submitted receipt.
   */
  router.post(
    '/card-checkout',
    receiptUpload.single('receipt'),
    validate({ body: schemas.cardCheckout }),
    (req, res) => {
      const provider = paymentProviderInfo(db);
      if (provider.provider !== 'card') {
        throw badRequest('CARD_PAYMENT_DISABLED', 'پرداخت کارت به کارت در حال حاضر فعال نیست');
      }
      const settings = getCardSettings(db);
      if (!isCardConfigured(settings)) {
        throw new AppError(
          503,
          'CARD_NOT_CONFIGURED',
          'شماره کارت و نام صاحب کارت هنوز توسط مدیر تنظیم نشده است',
        );
      }

      const teacher = findById(db, req.user.id);
      if (!teacher || teacher.role !== 'teacher') throw notFound('حساب معلم یافت نشد');
      if (teacherAccess(teacher).status === 'unlimited') {
        throw badRequest(
          'UNLIMITED_ACCESS',
          'این حساب دسترسی نامحدود دارد و نیازی به خرید یا ارسال رسید اشتراک نیست',
        );
      }
      const plan = db.prepare('SELECT * FROM subscription_plans WHERE id = ? AND active = 1').get(req.body.planId);
      if (!plan) throw notFound('طرح اشتراک انتخاب‌شده در دسترس نیست');

      const pending = db.prepare(`
        SELECT id FROM payments
        WHERE teacher_id = ? AND provider = 'card' AND status = 'pending'
        ORDER BY id DESC LIMIT 1
      `).get(teacher.id);
      if (pending) {
        throw conflict(
          'PENDING_CARD_PAYMENT',
          'یک رسید کارت به کارت از شما در انتظار بررسی است. تا تعیین وضعیت آن، رسید جدید ثبت نمی‌شود',
        );
      }

      const receiptText = String(req.body.receiptText ?? '').trim();
      if (!receiptText && !req.file) {
        throw badRequest('RECEIPT_REQUIRED', 'متن رسید یا تصویر رسید کارت به کارت را وارد کنید');
      }

      let storedName = null;
      let receiptName = '';
      let receiptMime = '';
      let receiptSize = 0;
      if (req.file) {
        receiptName = sanitizeFilename(decodeUploadFilename(req.file.originalname));
        const validated = validateReceiptImage({
          buffer: req.file.buffer,
          filename: receiptName,
          mimetype: req.file.mimetype,
          size: req.file.size,
        });
        storedName = writeReceipt(req.file.buffer, validated.extension);
        receiptMime = validated.mime;
        receiptSize = req.file.size;
      }

      let info;
      try {
        info = db.prepare(`
          INSERT INTO payments (
            teacher_id, plan_id, plan_name, amount, days, status, provider, note,
            receipt_text, receipt_file, receipt_name, receipt_mime, receipt_size, created_at
          ) VALUES (?, ?, ?, ?, ?, 'pending', 'card', ?, ?, ?, ?, ?, ?, ?)
        `).run(
          teacher.id,
          plan.id,
          plan.name,
          plan.price,
          plan.days,
          receiptText,
          receiptText,
          storedName,
          receiptName,
          receiptMime,
          receiptSize,
          isoNow(),
        );
      } catch (error) {
        if (storedName) removeReceipt(storedName);
        throw error;
      }

      res.status(201).json({
        payment: paymentJson(db.prepare('SELECT * FROM payments WHERE id = ?').get(info.lastInsertRowid)),
        provider: 'card',
        message: 'رسید شما ثبت شد و پس از بررسی مدیر، اشتراک فعال می‌شود',
      });
    },
  );

  /** The owner can preview the exact receipt the teacher uploaded. */
  router.get('/payments/:id/receipt', (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    const payment = Number.isFinite(id)
      ? db.prepare('SELECT * FROM payments WHERE id = ? AND teacher_id = ?').get(id, req.user.id)
      : null;
    if (!payment || !payment.receipt_file) throw notFound('تصویر رسید یافت نشد');
    const resolved = resolveReceiptPath(payment.receipt_file);
    if (!resolved) throw notFound('تصویر رسید یافت نشد');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Disposition', 'inline');
    res.type(payment.receipt_mime || 'application/octet-stream');
    return res.sendFile(resolved);
  });

  /** Withdraw a pending card receipt so a corrected one can be submitted. */
  router.delete('/payments/:id', (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) throw notFound('پرداخت یافت نشد');
    const result = cancelCardPayment(db, id, { teacherId: req.user.id });
    if (!result.ok) {
      if (result.reason === 'not-found') throw notFound('پرداخت یافت نشد');
      if (result.reason === 'already-paid') throw conflict('PAYMENT_ALREADY_PAID', 'این پرداخت قبلاً تأیید شده است');
      throw badRequest('PAYMENT_NOT_CANCELABLE', 'این پرداخت در وضعیت قابل لغو نیست');
    }
    res.json({ payment: result.payment, alreadyCanceled: result.alreadyCanceled });
  });

  /** Polling endpoint used by the return page to refresh a single payment. */
  router.get('/payments/:id', (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    const payment = db.prepare('SELECT * FROM payments WHERE id = ? AND teacher_id = ?').get(id, req.user.id);
    if (!payment) throw notFound('پرداخت یافت نشد');
    res.json({ payment: paymentJson(payment) });
  });

  return router;
}
