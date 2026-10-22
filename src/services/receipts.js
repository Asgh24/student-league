import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { badRequest, payloadTooLarge } from '../lib/errors.js';

/**
 * Receipt images are intentionally narrower than the generic upload allowlist:
 * only raster formats that browsers display safely inline. SVG is excluded
 * because it can contain scripts.
 */
const RECEIPT_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

export const RECEIPT_ACCEPT = '.jpg,.jpeg,.png,.webp';
export const RECEIPT_EXTENSIONS = Object.keys(RECEIPT_TYPES);

function detectImageMime(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47
    && buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a) {
    return 'image/png';
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

/**
 * Validates extension, size and the actual file signature. The declared MIME is
 * not trusted on its own, but a mismatch with the detected bytes is rejected.
 */
export function validateReceiptImage({ buffer, filename, mimetype, size }) {
  const actualSize = Number(size ?? buffer?.length ?? 0);
  if (actualSize > config.limits.maxReceiptBytes) throw payloadTooLarge('حجم تصویر رسید بیش از حد مجاز است');
  if (!buffer || !buffer.length) throw badRequest('EMPTY_RECEIPT', 'تصویر رسید خالی است');

  const extension = path.extname(String(filename ?? '')).toLowerCase();
  const expected = RECEIPT_TYPES[extension];
  if (!expected) {
    throw badRequest('RECEIPT_TYPE_NOT_ALLOWED', 'فقط تصویر JPG، PNG یا WEBP برای رسید مجاز است');
  }

  const detected = detectImageMime(buffer);
  if (!detected || detected !== expected) {
    throw badRequest('INVALID_RECEIPT_IMAGE', 'محتوای فایل با تصویر رسید هم‌خوانی ندارد');
  }
  if (mimetype && !String(mimetype).startsWith('image/') && mimetype !== 'application/octet-stream') {
    throw badRequest('INVALID_RECEIPT_IMAGE', 'نوع فایل ارسالی تصویر نیست');
  }

  return { extension, mime: detected };
}

export function receiptsDir() {
  return path.join(config.uploadsDir, 'payment-receipts');
}

export function writeReceipt(buffer, extension) {
  const dir = receiptsDir();
  fs.mkdirSync(dir, { recursive: true });
  const storedName = `${crypto.randomUUID()}${extension}`;
  fs.writeFileSync(path.join(dir, storedName), buffer);
  return storedName;
}

export function removeReceipt(storedName) {
  if (!storedName) return;
  try {
    fs.rmSync(path.resolve(receiptsDir(), path.basename(String(storedName))), { force: true });
  } catch {
    /* an orphaned receipt is harmless; the database row is the source of truth */
  }
}

/** Resolves a stored receipt name, refusing anything outside the private folder. */
export function resolveReceiptPath(storedName) {
  const base = path.resolve(receiptsDir());
  const resolved = path.resolve(base, path.basename(String(storedName ?? '')));
  if (!resolved.startsWith(`${base}${path.sep}`)) return null;
  return resolved;
}
