import { findById } from '../repositories/users.js';
import {
  accessForTeacher,
  extendTeacherSubscription,
  paymentJson,
} from './subscription.js';

/**
 * Financial state transitions for card-to-card receipts.
 *
 * Every function that changes money-related state runs in a single SQLite
 * transaction. Approval updates the payment first and only then extends access;
 * any failure rolls both back. A second approval returns `alreadyPaid` and does
 * not add the plan duration a second time.
 */

export const CARD_PROVIDER = 'card';

export function countPendingCardPayments(db) {
  return db.prepare(`
    SELECT COUNT(*) AS n FROM payments WHERE provider = ? AND status = 'pending'
  `).get(CARD_PROVIDER).n;
}

export function approveCardPayment(db, paymentId, { adminId, note = '', now = Date.now() } = {}) {
  const run = db.transaction(() => {
    const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);
    if (!payment) return { ok: false, reason: 'not-found' };
    if (payment.provider !== CARD_PROVIDER) return { ok: false, reason: 'not-card-payment' };

    if (payment.status === 'paid') {
      return {
        ok: true,
        alreadyPaid: true,
        payment: paymentJson(payment),
        access: accessForTeacher(db, payment.teacher_id),
      };
    }
    if (payment.status !== 'pending') return { ok: false, reason: `payment-${payment.status}` };
    if (!String(payment.receipt_text ?? '').trim() && !payment.receipt_file) {
      return { ok: false, reason: 'receipt-missing' };
    }

    const teacher = findById(db, payment.teacher_id);
    if (!teacher || teacher.role !== 'teacher') return { ok: false, reason: 'teacher-not-found' };

    const paidAt = new Date(now).toISOString();
    const claimed = db.prepare(`
      UPDATE payments
      SET status = 'paid', paid_at = ?, reviewed_by = ?, reviewed_at = ?, review_note = ?, error = ''
      WHERE id = ? AND status = 'pending'
    `).run(paidAt, adminId, paidAt, String(note ?? '').trim(), paymentId);
    if (claimed.changes !== 1) return { ok: false, reason: 'not-pending' };

    const granted = extendTeacherSubscription(db, {
      teacherId: payment.teacher_id,
      days: payment.days,
      planId: payment.plan_id,
      planName: payment.plan_name,
      note: `پرداخت کارت به کارت #${payment.id}`,
      now,
    });
    if (!granted) throw new Error('could not extend the teacher subscription');

    db.prepare('UPDATE payments SET starts_at = ?, ends_at = ? WHERE id = ?')
      .run(granted.startsAt, granted.endsAt, paymentId);

    return {
      ok: true,
      alreadyPaid: false,
      payment: paymentJson(db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId)),
      access: granted.access,
    };
  });
  return run();
}

export function rejectCardPayment(db, paymentId, { adminId, reason = '', now = Date.now() } = {}) {
  const run = db.transaction(() => {
    const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);
    if (!payment) return { ok: false, reason: 'not-found' };
    if (payment.provider !== CARD_PROVIDER) return { ok: false, reason: 'not-card-payment' };
    if (payment.status === 'paid') return { ok: false, reason: 'already-paid' };
    if (payment.status === 'canceled' || payment.status === 'failed') {
      return { ok: true, alreadyReviewed: true, payment: paymentJson(payment) };
    }
    if (payment.status !== 'pending') return { ok: false, reason: `payment-${payment.status}` };

    const reviewedAt = new Date(now).toISOString();
    const message = String(reason ?? '').trim();
    db.prepare(`
      UPDATE payments
      SET status = 'canceled', error = ?, reviewed_by = ?, reviewed_at = ?, review_note = ?
      WHERE id = ? AND status = 'pending'
    `).run(
      message ? `رسید رد شد: ${message}`.slice(0, 500) : 'رسید توسط مدیر رد شد',
      adminId,
      reviewedAt,
      message.slice(0, 500),
      paymentId,
    );
    return {
      ok: true,
      alreadyReviewed: false,
      payment: paymentJson(db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId)),
    };
  });
  return run();
}

export function cancelCardPayment(db, paymentId, { teacherId, now = Date.now() } = {}) {
  const run = db.transaction(() => {
    const payment = db.prepare('SELECT * FROM payments WHERE id = ? AND teacher_id = ?')
      .get(paymentId, teacherId);
    if (!payment) return { ok: false, reason: 'not-found' };
    if (payment.provider !== CARD_PROVIDER) return { ok: false, reason: 'not-card-payment' };
    if (payment.status === 'paid') return { ok: false, reason: 'already-paid' };
    if (payment.status === 'canceled' || payment.status === 'failed') {
      return { ok: true, alreadyCanceled: true, payment: paymentJson(payment) };
    }
    if (payment.status !== 'pending') return { ok: false, reason: `payment-${payment.status}` };

    db.prepare(`
      UPDATE payments SET status = 'canceled', error = ?, reviewed_at = ?
      WHERE id = ? AND status = 'pending'
    `).run('لغو توسط معلم', new Date(now).toISOString(), paymentId);
    return {
      ok: true,
      alreadyCanceled: false,
      payment: paymentJson(db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId)),
    };
  });
  return run();
}
