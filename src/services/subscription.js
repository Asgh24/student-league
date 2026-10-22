import { findById } from '../repositories/users.js';

export const DAY_MS = 24 * 60 * 60 * 1000;

function timeOf(value) {
  const time = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(time) ? time : null;
}

/**
 * Resolves a teacher's access window.
 *
 * - `NULL + NULL` means unlimited. The pre-existing/bootstrap teacher keeps
 *   working after this migration without being forced onto a trial.
 * - A paid subscription wins over a trial. If both are set, the later date is
 *   the effective end.
 */
export function teacherAccess(row, now = Date.now()) {
  if (!row) return { active: false, status: 'none', endsAt: null, daysLeft: 0, source: null };
  const trialEnd = timeOf(row.trial_ends_at ?? row.trialEndsAt);
  const subEnd = timeOf(row.subscription_ends_at ?? row.subscriptionEndsAt);
  const trialActive = trialEnd !== null && trialEnd > now;
  const subActive = subEnd !== null && subEnd > now;

  if (trialEnd === null && subEnd === null) {
    return {
      active: true,
      status: 'unlimited',
      source: 'unlimited',
      endsAt: null,
      daysLeft: null,
      trialEndsAt: null,
      subscriptionEndsAt: null,
    };
  }

  const endsAt = subActive ? subEnd : trialActive ? trialEnd : Math.max(trialEnd ?? 0, subEnd ?? 0);
  const status = subActive ? 'active' : trialActive ? 'trial' : 'expired';
  return {
    active: subActive || trialActive,
    status,
    source: subActive ? 'subscription' : trialActive ? 'trial' : null,
    endsAt: endsAt ? new Date(endsAt).toISOString() : null,
    daysLeft: endsAt ? Math.max(0, Math.ceil((endsAt - now) / DAY_MS)) : 0,
    trialEndsAt: trialEnd ? new Date(trialEnd).toISOString() : null,
    subscriptionEndsAt: subEnd ? new Date(subEnd).toISOString() : null,
  };
}

export function accessForTeacher(db, teacherId) {
  return teacherAccess(findById(db, teacherId));
}

export function planJson(row) {
  return {
    id: row.id,
    name: row.name,
    days: row.days,
    price: row.price,
    description: row.description,
    active: row.active === 1,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listPlans(db, { activeOnly = false } = {}) {
  const rows = activeOnly
    ? db.prepare('SELECT * FROM subscription_plans WHERE active = 1 ORDER BY sort_order ASC, id ASC').all()
    : db.prepare('SELECT * FROM subscription_plans ORDER BY active DESC, sort_order ASC, id ASC').all();
  return rows.map(planJson);
}

export function paymentJson(row) {
  return {
    id: row.id,
    teacherId: row.teacher_id,
    teacherName: row.teacher_name ?? row.teacherName ?? '',
    planId: row.plan_id,
    planName: row.plan_name,
    amount: row.amount,
    days: row.days,
    status: row.status,
    provider: row.provider,
    authority: row.authority,
    refId: row.ref_id,
    cardPan: row.card_pan,
    error: row.error,
    note: row.note,
    receiptText: row.receipt_text ?? '',
    hasReceiptImage: Boolean(row.receipt_file),
    receiptName: row.receipt_name ?? '',
    reviewedAt: row.reviewed_at ?? null,
    reviewNote: row.review_note ?? '',
    createdAt: row.created_at,
    paidAt: row.paid_at,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
  };
}

export function recentPayments(db, teacherId, limit = 30) {
  return db.prepare(`
    SELECT * FROM payments WHERE teacher_id = ? ORDER BY id DESC LIMIT ?
  `).all(teacherId, limit).map(paymentJson);
}

/**
 * Adds `days` to the later of "now", the current subscription end, and the
 * current trial end. Renewals bought before expiry therefore extend the
 * existing window instead of resetting or discarding it. Runs inside the
 * caller's transaction (or starts one).
 */
export function extendTeacherSubscription(db, {
  teacherId,
  days,
  planId = null,
  planName = '',
  note = '',
  now = Date.now(),
}) {
  const teacher = findById(db, teacherId);
  if (!teacher || teacher.role !== 'teacher') return null;
  const subEnd = timeOf(teacher.subscription_ends_at);
  const trialEnd = timeOf(teacher.trial_ends_at);
  // NULL + NULL is the legacy/permanent unlimited account. A payment must never
  // silently replace that with a shorter fixed-term subscription.
  if (subEnd === null && trialEnd === null) {
    return {
      teacherId,
      planName,
      days,
      startsAt: null,
      endsAt: null,
      access: teacherAccess(teacher),
      unlimited: true,
    };
  }
  // Buying during a trial must add the plan to the access the teacher already
  // has, not silently replace the remaining trial days. The effective end is
  // whichever of the paid subscription and the trial ends later.
  const currentEnd = Math.max(now, subEnd ?? 0, trialEnd ?? 0);
  const newEnd = new Date(currentEnd + days * DAY_MS).toISOString();
  const startedAt = new Date(now).toISOString();
  db.prepare(`
    UPDATE users
    SET subscription_ends_at = ?, subscription_started_at = ?, subscription_plan_id = ?,
        subscription_note = ?
    WHERE id = ?
  `).run(newEnd, startedAt, planId ?? teacher.subscription_plan_id ?? null, String(note ?? ''), teacherId);
  return {
    teacherId,
    planName,
    days,
    startsAt: startedAt,
    endsAt: newEnd,
    access: teacherAccess(findById(db, teacherId)),
  };
}

/** Marks a pending payment paid and extends the teacher's access exactly once. */
export function activatePayment(db, paymentId, { refId = null, cardPan = null } = {}) {
  const run = db.transaction(() => {
    const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);
    if (!payment) return { ok: false, reason: 'not-found' };
    if (payment.status === 'paid') {
      return { ok: true, alreadyPaid: true, payment: paymentJson(payment), access: accessForTeacher(db, payment.teacher_id) };
    }
    if (payment.status !== 'pending') return { ok: false, reason: `payment-${payment.status}` };

    const now = Date.now();
    const granted = extendTeacherSubscription(db, {
      teacherId: payment.teacher_id,
      days: payment.days,
      planId: payment.plan_id,
      planName: payment.plan_name,
      note: payment.note,
      now,
    });
    if (!granted) return { ok: false, reason: 'teacher-not-found' };

    db.prepare(`
      UPDATE payments
      SET status = 'paid', paid_at = ?, starts_at = ?, ends_at = ?, ref_id = ?, card_pan = ?,
          error = ''
      WHERE id = ? AND status = 'pending'
    `).run(new Date(now).toISOString(), granted.startsAt, granted.endsAt, refId, cardPan, paymentId);

    return {
      ok: true,
      alreadyPaid: false,
      payment: paymentJson(db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId)),
      access: accessForTeacher(db, payment.teacher_id),
    };
  });
  return run();
}

export function failPayment(db, paymentId, { error = '', status = 'failed' } = {}) {
  db.prepare("UPDATE payments SET status = ?, error = ? WHERE id = ? AND status = 'pending'")
    .run(status === 'canceled' ? 'canceled' : 'failed', String(error ?? '').slice(0, 500), paymentId);
  return paymentJson(db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId));
}

export function ensureTrialEnd(now = Date.now(), days = 14) {
  return new Date(now + days * DAY_MS).toISOString();
}
