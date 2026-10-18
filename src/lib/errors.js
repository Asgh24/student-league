/** Application level error carrying an HTTP status, a stable code and a user facing Persian message. */
export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    if (details !== undefined) this.details = details;
    this.expose = status < 500;
  }
}

export const badRequest = (code, message, details) => new AppError(400, code, message, details);
export const unauthorized = (message = 'ابتدا وارد حساب خود شوید') => new AppError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'دسترسی شما به این بخش مجاز نیست') => new AppError(403, 'FORBIDDEN', message);
export const csrfError = (message = 'توکن امنیتی نامعتبر است. صفحه را دوباره بارگذاری کنید') => new AppError(403, 'INVALID_CSRF', message);
export const notFound = (message = 'موردی یافت نشد') => new AppError(404, 'NOT_FOUND', message);
export const conflict = (code, message) => new AppError(409, code, message);
export const tooMany = (message = 'تعداد درخواست‌ها زیاد است. کمی بعد تلاش کنید') => new AppError(429, 'TOO_MANY_REQUESTS', message);
export const payloadTooLarge = (message = 'حجم فایل بیش از حد مجاز است') => new AppError(413, 'PAYLOAD_TOO_LARGE', message);
export const validationError = (details) => new AppError(400, 'VALIDATION_ERROR', 'داده‌های ورودی نامعتبر است', details);

/** Maps any thrown value to the public JSON error envelope. Never leaks stack traces in production. */
export function toErrorResponse(err, isProd) {
  if (err instanceof AppError) {
    const body = { error: { code: err.code, message: err.message } };
    if (err.details !== undefined && err.code === 'VALIDATION_ERROR') body.error.details = err.details;
    return { status: err.status, body };
  }
  if (err && err.name === 'ZodError') {
    const details = (err.issues || []).map((issue) => ({
      path: Array.isArray(issue.path) ? issue.path.join('.') : String(issue.path ?? ''),
      message: issue.message,
    }));
    return { status: 400, body: { error: { code: 'VALIDATION_ERROR', message: 'داده‌های ورودی نامعتبر است', details } } };
  }
  if (err && err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
    return { status: 409, body: { error: { code: 'DUPLICATE', message: 'این مقدار تکراری است' } } };
  }
  if (err && typeof err.status === 'number' && err.expose) {
    return { status: err.status, body: { error: { code: err.code || 'ERROR', message: err.message } } };
  }
  const message = isProd ? 'خطای داخلی سرور رخ داد' : String((err && err.message) || err);
  return { status: 500, body: { error: { code: 'INTERNAL_ERROR', message } } };
}
