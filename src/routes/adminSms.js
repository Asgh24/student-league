import { Router } from 'express';
import { badRequest } from '../lib/errors.js';
import { asyncHandler } from '../lib/http.js';
import { normalizeMobile } from '../lib/phone.js';
import { schemas, validate } from '../lib/validate.js';
import { requireAdmin } from '../middleware/auth.js';
import {
  deliverSmsBulk,
  fetchSmsCredit,
  fetchSmsLines,
  listCampaigns,
  listOutbox,
  markCampaign,
  queueCampaign,
  retryCampaign,
  retryOutboxMessage,
  smsConfig,
  smsCounts,
} from '../services/sms.js';

const STATUSES = new Set(['queued', 'sent', 'failed']);

function statusOf(value) {
  const status = String(value ?? '');
  return STATUSES.has(status) ? status : '';
}

function limitOf(value, fallback = 50) {
  const limit = Number.parseInt(value ?? fallback, 10);
  return Math.min(200, Math.max(1, Number.isFinite(limit) ? limit : fallback));
}

/** `/api/v1/admin/sms` — the complete sms.ir console. */
export function createAdminSmsRouter({ db }) {
  const router = Router();
  router.use(requireAdmin);

  router.get('/', (req, res) => {
    const status = statusOf(req.query.status);
    res.json({
      config: smsConfig(),
      counts: smsCounts(db),
      outbox: listOutbox(db, { limit: limitOf(req.query.limit, 30), status }),
      campaigns: listCampaigns(db, { limit: limitOf(req.query.limit, 30), status }),
    });
  });

  router.get('/messages', (req, res) => {
    res.json({ items: listOutbox(db, { limit: limitOf(req.query.limit), status: statusOf(req.query.status) }) });
  });

  router.get('/campaigns', (req, res) => {
    res.json({ items: listCampaigns(db, { limit: limitOf(req.query.limit), status: statusOf(req.query.status) }) });
  });

  router.get('/credit', asyncHandler(async (_req, res) => {
    const result = await fetchSmsCredit();
    if (!result.ok) {
      return res.json({
        ok: false,
        configured: Boolean(result.configured),
        message: result.reason === 'SMS_NOT_CONFIGURED'
          ? 'اطلاعات sms.ir هنوز در تنظیمات سرور وارد نشده است'
          : result.error || 'دریافت اعتبار ناموفق بود',
      });
    }
    return res.json({ ok: true, configured: true, credit: result.credit });
  }));

  router.get('/lines', asyncHandler(async (_req, res) => {
    const result = await fetchSmsLines();
    if (!result.ok) {
      return res.json({
        ok: false,
        configured: Boolean(result.configured),
        message: result.reason === 'SMS_NOT_CONFIGURED'
          ? 'اطلاعات sms.ir هنوز در تنظیمات سرور وارد نشده است'
          : result.error || 'دریافت خطوط ناموفق بود',
      });
    }
    return res.json({ ok: true, configured: true, lines: result.lines });
  }));

  router.post(
    '/test',
    validate({ body: schemas.smsTest }),
    asyncHandler(async (req, res) => {
      const mobile = normalizeMobile(req.body.mobile);
      if (!mobile) throw badRequest('INVALID_MOBILE', 'شمارهٔ موبایل معتبر نیست');
      const id = queueCampaign(db, {
        adminId: req.user.id,
        kind: 'test',
        mobile,
        body: req.body.message,
      });
      const delivery = await deliverSmsBulk({ mobiles: [mobile], text: req.body.message });
      if (delivery.ok) {
        markCampaign(db, id, { status: 'sent', providerMessageId: delivery.providerMessageIds?.[0] ?? null });
      } else if (!delivery.queued) {
        markCampaign(db, id, { status: 'failed', error: delivery.error ?? 'ارسال ناموفق' });
      }
      const item = listCampaigns(db, { limit: 1 })[0];
      res.status(201).json({ item, delivery });
    }),
  );

  router.post(
    '/bulk',
    validate({ body: schemas.smsBulk }),
    asyncHandler(async (req, res) => {
      const seen = new Set();
      const invalid = [];
      const mobiles = [];
      for (const raw of req.body.mobiles) {
        const mobile = normalizeMobile(raw);
        if (!mobile) {
          invalid.push(raw);
          continue;
        }
        if (!seen.has(mobile)) {
          seen.add(mobile);
          mobiles.push(mobile);
        }
      }
      if (invalid.length > 0) {
        throw badRequest('INVALID_MOBILE', 'برخی شماره‌ها معتبر نیستند', invalid);
      }
      if (mobiles.length === 0) throw badRequest('INVALID_MOBILE', 'شمارهٔ معتبری ارسال نشده است');

      const ids = mobiles.map((mobile) => queueCampaign(db, {
        adminId: req.user.id,
        kind: 'bulk',
        mobile,
        body: req.body.message,
      }));

      const delivery = await deliverSmsBulk({ mobiles, text: req.body.message });
      if (delivery.ok) {
        ids.forEach((id, index) => {
          markCampaign(db, id, {
            status: 'sent',
            providerMessageId: delivery.providerMessageIds?.[index] ?? null,
          });
        });
      } else if (!delivery.queued) {
        ids.forEach((id) => markCampaign(db, id, { status: 'failed', error: delivery.error ?? 'ارسال ناموفق' }));
      }

      res.status(201).json({
        count: ids.length,
        status: delivery.ok ? 'sent' : delivery.queued ? 'queued' : 'failed',
        delivery,
      });
    }),
  );

  router.post('/messages/:id/retry', asyncHandler(async (req, res) => {
    const result = await retryOutboxMessage(db, Number.parseInt(req.params.id, 10));
    if (!result) throw badRequest('NOT_FOUND', 'پیام یافت نشد');
    res.json(result);
  }));

  router.post('/campaigns/:id/retry', asyncHandler(async (req, res) => {
    const result = await retryCampaign(db, Number.parseInt(req.params.id, 10));
    if (!result) throw badRequest('NOT_FOUND', 'پیام یافت نشد');
    res.json(result);
  }));

  return router;
}
