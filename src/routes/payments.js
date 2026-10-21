import { Router } from 'express';
import { config } from '../config.js';
import { isoNow } from '../lib/http.js';
import { activatePayment, failPayment } from '../services/subscription.js';
import { verifyZarinpalPayment } from '../services/payments.js';

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function appRedirect(res, status, paymentId = null) {
  const query = new URLSearchParams({ payment: status });
  if (paymentId !== null) query.set('id', String(paymentId));
  return res.redirect(302, `${config.appBaseUrl}/#/teacher/subscription?${query.toString()}`);
}

/**
 * Public payment callbacks. Mounted outside `/api/v1` on purpose: the provider
 * redirects the browser here and there is no CSRF token or JSON body.
 */
export function createPaymentRouter({ db }) {
  const router = Router();

  router.get('/zarinpal/callback', async (req, res, next) => {
    try {
      const authority = String(req.query.Authority ?? req.query.authority ?? '').trim();
      const status = String(req.query.Status ?? req.query.status ?? '').trim();
      if (!authority) return appRedirect(res, 'notfound');
      const payment = db.prepare("SELECT * FROM payments WHERE authority = ? AND provider = 'zarinpal'").get(authority);
      if (!payment) return appRedirect(res, 'notfound');
      if (payment.status === 'paid') return appRedirect(res, 'success', payment.id);
      if (payment.status !== 'pending') return appRedirect(res, payment.status === 'canceled' ? 'canceled' : 'failed', payment.id);

      if (status !== 'OK') {
        failPayment(db, payment.id, { error: `بازگشت از درگاه با وضعیت ${status || 'نامشخص'}`, status: 'canceled' });
        return appRedirect(res, 'canceled', payment.id);
      }

      const verified = await verifyZarinpalPayment({
        amountToman: payment.amount,
        authority,
      });
      if (!verified.ok) {
        failPayment(db, payment.id, { error: verified.error || 'تأیید پرداخت ناموفق بود' });
        return appRedirect(res, 'failed', payment.id);
      }

      const activated = activatePayment(db, payment.id, {
        refId: verified.refId,
        cardPan: verified.cardPan,
      });
      if (!activated.ok) return appRedirect(res, 'failed', payment.id);
      return appRedirect(res, 'success', payment.id);
    } catch (error) {
      return next(error);
    }
  });

  /* ----------------------------- local mock ----------------------------- */

  function mockPayment(req, res) {
    if (config.payments.provider !== 'mock') return res.status(404).end();
    const id = Number.parseInt(req.params.id, 10);
    const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(id);
    if (!payment) return res.status(404).type('html').send('<h1>پرداخت یافت نشد</h1>');
    return { payment, id };
  }

  router.get('/mock/:id', (req, res) => {
    const found = mockPayment(req, res);
    if (!found) return undefined;
    const { payment } = found;
    if (payment.status === 'paid') return appRedirect(res, 'success', payment.id);
    if (payment.status !== 'pending') return appRedirect(res, payment.status === 'canceled' ? 'canceled' : 'failed', payment.id);

    const amount = Number(payment.amount || 0).toLocaleString('fa-IR');
    return res.type('html').send(`<!doctype html>
<html lang="fa" dir="rtl">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>پرداخت آزمایشی</title>
    <style>
      body { font-family: Tahoma, sans-serif; background: #faf7ff; color: #1e1b4b; margin: 0; padding: 32px 16px; }
      .card { max-width: 520px; margin: 0 auto; background: #fff; border: 1px solid #ece7fb; border-radius: 24px; padding: 28px; box-shadow: 0 10px 30px rgba(124,58,237,.14); }
      h1 { font-size: 1.35rem; margin: 0 0 12px; }
      p { line-height: 1.9; margin: 8px 0; }
      .amount { font-size: 1.15rem; font-weight: 700; color: #7c3aed; }
      .row { display: flex; gap: 10px; margin-top: 24px; flex-wrap: wrap; }
      a { display: inline-block; padding: 12px 20px; border-radius: 14px; text-decoration: none; font-weight: 700; }
      .ok { background: #16a34a; color: #fff; }
      .cancel { background: #f3f0ff; color: #4c4675; }
      .note { font-size: .85rem; color: #7c7aa3; }
    </style>
  </head>
  <body>
    <main class="card">
      <h1>درگاه پرداخت آزمایشی</h1>
      <p>این صفحه فقط برای توسعه است و هیچ پولی جابه‌جا نمی‌شود.</p>
      <p>طرح: <strong>${escapeHtml(payment.plan_name)}</strong></p>
      <p class="amount">${amount} تومان</p>
      <p class="note">در محیط واقعی، کاربر به درگاه زرین‌پال هدایت می‌شود.</p>
      <div class="row">
        <a class="ok" href="/payments/mock/${payment.id}/success">پرداخت موفق (آزمایشی)</a>
        <a class="cancel" href="/payments/mock/${payment.id}/cancel">انصراف</a>
      </div>
    </main>
  </body>
</html>`);
  });

  router.get('/mock/:id/success', (req, res) => {
    if (config.payments.provider !== 'mock') return res.status(404).end();
    const id = Number.parseInt(req.params.id, 10);
    const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(id);
    if (!payment) return res.status(404).type('html').send('<h1>پرداخت یافت نشد</h1>');
    if (payment.status === 'paid') return appRedirect(res, 'success', payment.id);
    if (payment.status !== 'pending') return appRedirect(res, 'failed', payment.id);
    const activated = activatePayment(db, payment.id, { refId: `MOCK-${id}`, cardPan: null });
    return appRedirect(res, activated.ok ? 'success' : 'failed', payment.id);
  });

  router.get('/mock/:id/cancel', (req, res) => {
    if (config.payments.provider !== 'mock') return res.status(404).end();
    const id = Number.parseInt(req.params.id, 10);
    const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(id);
    if (!payment) return res.status(404).type('html').send('<h1>پرداخت یافت نشد</h1>');
    if (payment.status === 'paid') return appRedirect(res, 'success', payment.id);
    failPayment(db, payment.id, { error: 'انصراف کاربر در درگاه آزمایشی', status: 'canceled' });
    db.prepare('UPDATE payments SET note = ? WHERE id = ?').run('canceled at mock gateway', payment.id);
    return appRedirect(res, 'canceled', payment.id);
  });

  // A small health endpoint is useful when configuring the callback URL.
  router.get('/status', (_req, res) => {
    res.json({
      provider: config.payments.provider,
      configured: config.payments.provider === 'mock' || Boolean(config.payments.zarinpal.merchantId),
      callback: `${config.appBaseUrl}/payments/zarinpal/callback`,
      checkedAt: isoNow(),
    });
  });

  return router;
}
