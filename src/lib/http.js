import { config } from '../config.js';

/** Wraps an async route handler so rejections reach the error middleware on Express 4 and 5. */
export function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/** Normalizes `page`/`limit` query values into a safe window. */
export function paginate(query = {}, { defaultLimit = 50, maxLimit = 200 } = {}) {
  const page = Math.max(1, Number.parseInt(query.page ?? 1, 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, Number.parseInt(query.limit ?? defaultLimit, 10) || defaultLimit));
  return { page, limit, offset: (page - 1) * limit };
}

export function isoNow() {
  return new Date().toISOString();
}

/** Calendar date (`YYYY-MM-DD`) for the configured app timezone. */
export function todayIso(date = new Date()) {
  const shifted = new Date(date.getTime() + config.tzOffsetMinutes * 60 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

export function parsePositiveInt(value, fallback = null) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
