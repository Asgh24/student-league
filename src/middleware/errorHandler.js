import multer from 'multer';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { toErrorResponse } from '../lib/errors.js';

export function notFoundHandler(_req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'مسیر درخواستی یافت نشد' } });
}

export function errorHandler(err, req, res, _next) {
  let normalized = err;

  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'حجم فایل بیش از حد مجاز است' : 'فایل ارسالی نامعتبر است';
    normalized = Object.assign(new Error(message), { status: 413, code: err.code, expose: true });
  }

  const { status, body } = toErrorResponse(normalized, config.isProd);
  const log = status >= 500 ? logger.error.bind(logger) : logger.warn.bind(logger);
  log('request failed', {
    method: req.method,
    url: req.originalUrl,
    status,
    code: body.error.code,
    userId: req.user?.id ?? null,
    message: String(err?.message || err),
  });

  if (res.headersSent) return;
  res.status(status).json(body);
}
