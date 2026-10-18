import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { ALLOWED_UPLOAD_EXTENSIONS, config } from '../config.js';
import { badRequest, forbidden, notFound, payloadTooLarge } from '../lib/errors.js';
import { isoNow } from '../lib/http.js';
import { schemas, validate } from '../lib/validate.js';
import { requireAuth, requireTeacher, loadOwnedLeague } from '../middleware/auth.js';

const BLOCKED_EXTENSIONS = new Set(['.exe', '.dll', '.bat', '.cmd', '.com', '.scr', '.js', '.mjs', '.cjs', '.php', '.sh', '.ps1', '.jar', '.msi', '.vbs', '.hta']);

const MIME_BY_EXTENSION = {
  '.pdf': ['application/pdf'],
  '.doc': ['application/msword'],
  '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  '.xls': ['application/vnd.ms-excel'],
  '.xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  '.ppt': ['application/vnd.ms-powerpoint'],
  '.pptx': ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  '.txt': ['text/plain'],
  '.csv': ['text/csv', 'text/plain', 'application/vnd.ms-excel'],
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
  '.png': ['image/png'],
  '.gif': ['image/gif'],
  '.webp': ['image/webp'],
  '.mp3': ['audio/mpeg', 'audio/mp3'],
  '.mp4': ['video/mp4'],
  '.zip': ['application/zip', 'application/x-zip-compressed'],
  '.rar': ['application/vnd.rar', 'application/x-rar-compressed'],
  '.7z': ['application/x-7z-compressed'],
};

/**
 * Browsers send the multipart filename as raw UTF-8 bytes but busboy decodes it
 * as latin1, so Persian names arrive as mojibake. Re-decode when the bytes form
 * valid UTF-8, otherwise keep the original string.
 */
export function decodeUploadFilename(name) {
  const raw = String(name ?? '');
  if (!/[\u0080-\u00ff]/.test(raw)) return raw;
  const decoded = Buffer.from(raw, 'latin1').toString('utf8');
  return decoded.includes('\uFFFD') ? raw : decoded;
}

/** Strips directories, control characters and bidi marks from a client filename. */
export function sanitizeFilename(name) {
  const base = path.basename(String(name ?? 'file'));
  return base
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/[\u200E\u200F\u202A-\u202E]/g, '')
    .replace(/[/\\:*?"<>|]/g, '_')
    .trim()
    .slice(0, 120) || 'file';
}

/** Validates the extension allowlist and that the declared MIME matches it. */
export function validateUpload(filename, mimetype, size) {
  const extension = path.extname(filename).toLowerCase();
  if (BLOCKED_EXTENSIONS.has(extension)) throw badRequest('EXTENSION_BLOCKED', 'این نوع فایل مجاز نیست');
  if (!ALLOWED_UPLOAD_EXTENSIONS.includes(extension)) throw badRequest('EXTENSION_NOT_ALLOWED', 'پسوند فایل مجاز نیست');
  if (size > config.limits.maxUploadBytes) throw payloadTooLarge();
  const allowed = MIME_BY_EXTENSION[extension];
  if (allowed && mimetype && !allowed.includes(mimetype) && mimetype !== 'application/octet-stream') {
    throw badRequest('MIME_MISMATCH', 'نوع محتوای فایل با پسوند آن همخوانی ندارد');
  }
  return extension;
}

function leagueFiles(db, leagueId) {
  return db.prepare(`
    SELECT f.id, f.original_name AS originalName, f.mime, f.size, f.description, f.created_at AS createdAt,
           u.display_name AS teacherName
    FROM files f LEFT JOIN users u ON u.id = f.teacher_id
    WHERE f.league_id = ? ORDER BY f.id DESC
  `).all(leagueId);
}

export function createLeagueFilesRouter({ db }) {
  const router = Router({ mergeParams: true });
  router.use(requireTeacher, loadOwnedLeague(db));

  // Built per router so the size limit reflects the current configuration.
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.limits.maxUploadBytes, files: 1 },
  });

  router.get('/', (req, res) => {
    const items = leagueFiles(db, req.league.id);
    res.json({
      items,
      total: items.length,
      limits: { maxBytes: config.limits.maxUploadBytes, extensions: ALLOWED_UPLOAD_EXTENSIONS },
    });
  });

  router.post(
    '/',
    upload.single('file'),
    validate({ body: schemas.fileUpload }),
    (req, res) => {
      if (!req.file) throw badRequest('NO_FILE', 'فایلی انتخاب نشده است');
      const originalName = sanitizeFilename(decodeUploadFilename(req.file.originalname));
      const extension = validateUpload(originalName, req.file.mimetype, req.file.size);
      const storedName = `${crypto.randomUUID()}${extension}`;
      const target = path.join(config.uploadsDir, storedName);
      fs.mkdirSync(config.uploadsDir, { recursive: true });
      fs.writeFileSync(target, req.file.buffer);

      const info = db.prepare(`
        INSERT INTO files (league_id, teacher_id, original_name, stored_name, mime, size, description, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        req.league.id,
        req.user.id,
        originalName,
        storedName,
        req.file.mimetype || 'application/octet-stream',
        req.file.size,
        req.body.description ?? '',
        isoNow(),
      );
      const created = leagueFiles(db, req.league.id).find((row) => row.id === Number(info.lastInsertRowid));
      res.status(201).json({ file: created });
    },
  );

  return router;
}

/** Download is allowed for the owning teacher and for students of the same league. */
export function createFilesRouter({ db }) {
  const router = Router();

  router.get('/:id/download', requireAuth, (req, res, next) => {
    const id = Number.parseInt(req.params.id, 10);
    const file = Number.isFinite(id) ? db.prepare('SELECT * FROM files WHERE id = ?').get(id) : null;
    if (!file) throw notFound('فایل یافت نشد');

    const league = db.prepare('SELECT * FROM leagues WHERE id = ?').get(file.league_id);
    let allowed = false;
    if (req.user.role === 'teacher') {
      allowed = league?.teacher_id === req.user.id;
    } else if (req.user.role === 'student') {
      const student = db.prepare('SELECT id FROM students WHERE user_id = ? AND league_id = ?').get(req.user.id, file.league_id);
      allowed = Boolean(student);
    }
    if (!allowed) throw forbidden('دسترسی به این فایل مجاز نیست');

    const resolved = path.resolve(config.uploadsDir, file.stored_name);
    if (!resolved.startsWith(path.resolve(config.uploadsDir) + path.sep)) {
      throw forbidden('مسیر فایل نامعتبر است');
    }
    if (!fs.existsSync(resolved)) throw notFound('فایل روی سرور موجود نیست');

    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.type(file.mime || 'application/octet-stream');
    return res.download(resolved, file.original_name, (err) => {
      if (err && !res.headersSent) next(err);
    });
  });

  router.delete('/:id', requireTeacher, (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    const file = Number.isFinite(id) ? db.prepare('SELECT * FROM files WHERE id = ?').get(id) : null;
    if (!file) throw notFound('فایل یافت نشد');
    const league = db.prepare('SELECT * FROM leagues WHERE id = ?').get(file.league_id);
    if (league?.teacher_id !== req.user.id) throw forbidden('این فایل به لیگ شما تعلق ندارد');
    db.prepare('DELETE FROM files WHERE id = ?').run(file.id);
    try {
      fs.rmSync(path.resolve(config.uploadsDir, file.stored_name), { force: true });
    } catch {
      /* the row is gone; an orphaned blob is harmless */
    }
    res.json({ ok: true });
  });

  return router;
}
