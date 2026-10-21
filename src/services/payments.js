/**
 * Zarinpal payment gateway (v4 REST API).
 *
 * Flow:
 *   1. POST /pg/v4/payment/request.json  -> authority
 *   2. redirect to /pg/StartPay/{authority}
 *   3. GET  /pg/v4/payment/verify.json    -> ref_id (codes 100 and 101)
 *
 * Zarinpal expects amounts in Rial. Plans are stored in Toman, so callers pass
 * Toman and this module multiplies by 10.
 */

import { config } from '../config.js';

function timeoutSignal(ms) {
  return globalThis.AbortSignal?.timeout?.(ms);
}

function messageOf(payload, fallback) {
  return payload?.errors?.message || payload?.data?.message || payload?.message || fallback;
}

async function postJson(url, body, { fetchImpl, timeoutMs }) {
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
    signal: timeoutSignal(timeoutMs),
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  return { response, payload };
}

export function paymentProviderInfo() {
  const payments = config.payments;
  const configured = payments.provider === 'mock' || Boolean(payments.zarinpal.merchantId);
  return {
    provider: payments.provider,
    configured,
    label: payments.provider === 'zarinpal' ? 'زرین‌پال' : 'پرداخت آزمایشی (Mock)',
    sandbox: payments.provider === 'zarinpal' ? payments.zarinpal.sandbox : true,
  };
}

export async function requestZarinpalPayment({
  amountToman,
  description,
  callbackUrl,
  mobile = '',
  fetchImpl = globalThis.fetch,
}) {
  const zarinpal = config.payments.zarinpal;
  if (!zarinpal.merchantId) {
    return { ok: false, error: 'درگاه پرداخت پیکربندی نشده است (ZARINPAL_MERCHANT_ID)' };
  }
  const amount = Math.round(Number(amountToman) || 0) * 10;
  if (amount < 1000) return { ok: false, error: 'مبلغ پرداخت نامعتبر است' };

  const body = {
    merchant_id: zarinpal.merchantId,
    amount,
    callback_url: callbackUrl,
    description: String(description || 'خرید اشتراک').slice(0, 200),
  };
  if (mobile) body.metadata = { mobile: String(mobile).slice(0, 20) };

  let result;
  try {
    result = await postJson(`${zarinpal.baseUrl}/pg/v4/payment/request.json`, body, {
      fetchImpl,
      timeoutMs: zarinpal.timeoutMs,
    });
  } catch (error) {
    return { ok: false, error: `ارتباط با زرین‌پال برقرار نشد: ${error?.message ?? error}` };
  }

  const { response, payload } = result;
  const code = payload?.data?.code;
  if (!response.ok || code !== 100 || !payload?.data?.authority) {
    return { ok: false, code: code ?? null, error: messageOf(payload, `زرین‌پال پاسخ ${response.status} داد`) };
  }
  return {
    ok: true,
    authority: payload.data.authority,
    gatewayUrl: `${zarinpal.baseUrl}/pg/StartPay/${payload.data.authority}`,
    amountRial: amount,
  };
}

export async function verifyZarinpalPayment({
  amountToman,
  authority,
  fetchImpl = globalThis.fetch,
}) {
  const zarinpal = config.payments.zarinpal;
  if (!zarinpal.merchantId) {
    return { ok: false, error: 'درگاه پرداخت پیکربندی نشده است (ZARINPAL_MERCHANT_ID)' };
  }
  if (!authority) return { ok: false, error: 'شناسهٔ پرداخت ارسال نشده است' };
  const amount = Math.round(Number(amountToman) || 0) * 10;

  let result;
  try {
    result = await postJson(`${zarinpal.baseUrl}/pg/v4/payment/verify.json`, {
      merchant_id: zarinpal.merchantId,
      amount,
      authority,
    }, { fetchImpl, timeoutMs: zarinpal.timeoutMs });
  } catch (error) {
    return { ok: false, error: `ارتباط با زرین‌پال برقرار نشد: ${error?.message ?? error}` };
  }

  const { response, payload } = result;
  const code = payload?.data?.code;
  // 101 means the transaction was already verified (for example the browser
  // retried the callback); it must be treated as success, not as a failure.
  if (!response.ok || (code !== 100 && code !== 101)) {
    return { ok: false, code: code ?? null, error: messageOf(payload, `زرین‌پال پاسخ ${response.status} داد`) };
  }
  return {
    ok: true,
    alreadyVerified: code === 101,
    refId: payload?.data?.ref_id ? String(payload.data.ref_id) : null,
    cardPan: payload?.data?.card_pan ? String(payload.data.card_pan) : null,
    amountRial: amount,
  };
}
