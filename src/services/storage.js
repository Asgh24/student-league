import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { AppError } from '../lib/errors.js';
import { toPersianDigits } from '../lib/normalize.js';

const MEBIBYTE = 1024 * 1024;

/** Formats a byte count for user-facing Persian quota messages. */
export function formatStorageSize(value) {
  const bytes = Math.max(0, Number(value) || 0);
  const megabytes = bytes / MEBIBYTE;
  const rounded = megabytes >= 10 ? Math.round(megabytes) : Math.round(megabytes * 10) / 10;
  return `${toPersianDigits(rounded)} مگابایت`;
}

/** Builds a storage summary from an already counted byte total. */
export function storageUsageFromBytes(usedBytes, { fileCount = 0, limitBytes = config.limits.teacherStorageBytes } = {}) {
  const used = Math.max(0, Number(usedBytes) || 0);
  const limit = Math.max(0, Number(limitBytes) || 0);
  return {
    usedBytes: used,
    limitBytes: limit,
    remainingBytes: Math.max(0, limit - used),
    fileCount: Math.max(0, Number(fileCount) || 0),
    percentUsed: limit > 0 ? Math.min(100, Math.round((used / limit) * 1000) / 10) : 0,
  };
}

/**
 * Total storage used by one teacher, across every league. Files are counted
 * through the owning league so legacy rows without `teacher_id` still belong to
 * the teacher who owns that league.
 */
export function teacherStorageUsage(db, teacherId) {
  const row = db.prepare(`
    SELECT COUNT(f.id) AS file_count, COALESCE(SUM(f.size), 0) AS used_bytes
    FROM files f JOIN leagues l ON l.id = f.league_id
    WHERE l.teacher_id = ?
  `).get(teacherId);
  return storageUsageFromBytes(row?.used_bytes, { fileCount: row?.file_count });
}

/**
 * Throws before an upload is written when the new file would push the teacher
 * past the shared quota. Deleting an existing file recalculates the usage from
 * the `files` table immediately, so freed space is available on the next try.
 */
export function assertTeacherStorageAvailable(db, teacherId, incomingBytes) {
  const usage = teacherStorageUsage(db, teacherId);
  const incoming = Math.max(0, Number(incomingBytes) || 0);
  if (usage.usedBytes + incoming > usage.limitBytes) {
    throw new AppError(
      413,
      'STORAGE_QUOTA_EXCEEDED',
      `فضای ذخیره‌سازی شما تکمیل شده است. سقف مجاز ${formatStorageSize(usage.limitBytes)} است و فقط ${formatStorageSize(usage.remainingBytes)} فضای خالی دارید. برای ارسال فایل جدید ابتدا فایل‌های قبلی را حذف کنید.`,
      { ...usage, incomingBytes: incoming },
    );
  }
  return usage;
}

/** Blob names belonging to a teacher, used when an admin deletes the account. */
export function teacherFileBlobs(db, teacherId) {
  return db.prepare(`
    SELECT f.stored_name AS storedName, f.size
    FROM files f JOIN leagues l ON l.id = f.league_id
    WHERE l.teacher_id = ?
  `).all(teacherId);
}

/** Removes one upload from disk without ever following a path outside uploadsDir. */
export function removeUploadedFile(storedName) {
  if (!storedName) return;
  try {
    const base = path.resolve(config.uploadsDir);
    const target = path.resolve(base, path.basename(String(storedName)));
    if (!target.startsWith(`${base}${path.sep}`)) return;
    fs.rmSync(target, { force: true });
  } catch {
    /* the database row is the source of truth; an orphaned blob is harmless */
  }
}
