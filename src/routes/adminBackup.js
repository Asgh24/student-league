import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import { config } from '../config.js';
import { badRequest, notFound } from '../lib/errors.js';
import { asyncHandler } from '../lib/http.js';
import { requireAdmin } from '../middleware/auth.js';
import { APP_VERSION } from '../version.js';
import { readState, stateFileFor } from '../services/backupScheduler.js';
import {
  backupStatus,
  cancelStagedRestore,
  createClientFor,
  describeConfig,
  isConfigured,
  listSnapshots,
  missingSettings,
  normalizeSnapshotName,
  pushBackup,
  readManifest,
  readRestoreMarker,
  stageRestore,
} from '../services/githubBackup.js';

/**
 * Admin-only backup console.
 *
 * Restores are staged instead of swapped under the live SQLite connection. The
 * admin is told to restart the service; `applyStagedRestore` runs at the next
 * boot, before any database connection is opened.
 */

function downloadStamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function fileSize(file) {
  try {
    return fs.statSync(file).size;
  } catch {
    return null;
  }
}

async function directorySize(dir) {
  let total = 0;
  let count = 0;
  try {
    const entries = await fsp.readdir(dir, { recursive: true, withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const full = path.join(entry.parentPath ?? entry.path ?? dir, entry.name);
      try {
        total += (await fsp.stat(full)).size;
        count += 1;
      } catch {
        /* a file may disappear while the admin page is loading */
      }
    }
  } catch {
    /* uploads are optional */
  }
  return { bytes: total, files: count };
}

function removeTempDatabase(file) {
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.rmSync(`${file}${suffix}`, { force: true });
    } catch {
      /* best effort */
    }
  }
}

export function createAdminBackupRouter({ db }) {
  const router = Router();
  router.use(requireAdmin);

  async function remoteSummary(cfg) {
    if (!isConfigured(cfg)) {
      return { snapshots: [], manifest: null, error: null };
    }
    try {
      const client = createClientFor(cfg);
      const snapshots = await listSnapshots(client, cfg);
      const remote = await readManifest(client, cfg);
      return {
        snapshots: snapshots.slice().reverse(),
        manifest: remote?.manifest ?? null,
        error: null,
      };
    } catch (err) {
      return { snapshots: [], manifest: null, error: String(err?.message || err) };
    }
  }

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      const cfg = config.githubBackup;
      const configured = isConfigured(cfg);
      const remote = await remoteSummary(cfg);
      const uploads = await directorySize(config.uploadsDir);
      res.setHeader('Cache-Control', 'no-store');
      res.json({
        ...describeConfig(cfg),
        configured,
        enabled: cfg.enabled,
        missing: missingSettings(cfg),
        tokenSet: Boolean(cfg.token),
        restoreOnEmpty: cfg.restoreOnEmpty,
        maxBytes: cfg.maxBytes,
        local: {
          dbBytes: fileSize(config.dbFile),
          uploadsBytes: uploads.bytes,
          uploadsFiles: uploads.files,
        },
        remote: {
          snapshots: remote.snapshots,
          count: remote.snapshots.length,
          newest: remote.snapshots[0] ?? null,
          manifest: remote.manifest,
          error: remote.error,
        },
        scheduler: readState(stateFileFor()),
        pendingRestore: await readRestoreMarker(),
      });
    }),
  );

  /** Manual push, available even when the scheduled backup is disabled. */
  router.post(
    '/run',
    asyncHandler(async (_req, res) => {
      const cfg = config.githubBackup;
      if (!isConfigured(cfg)) {
        throw badRequest(
          'BACKUP_NOT_CONFIGURED',
          `ابتدا ${missingSettings(cfg).join(' و ')} را در محیط سرور تنظیم کنید`,
        );
      }
      const result = await pushBackup({
        db,
        cfg,
        client: createClientFor(cfg),
        log: () => {},
        appVersion: APP_VERSION,
      });
      res.status(201).json({ backup: result });
    }),
  );

  /** Download a consistent local snapshot; this is the manual offline copy. */
  router.get(
    '/download',
    asyncHandler(async (_req, res) => {
      const file = path.join(config.dataDir, `.download-${process.pid}-${Date.now()}.db`);
      try {
        await db.backup(file);
      } catch (err) {
        removeTempDatabase(file);
        throw err;
      }
      const name = `league-backup-${downloadStamp()}.db`;
      const info = await fsp.stat(file);
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
      res.setHeader('Content-Length', String(info.size));
      const stream = fs.createReadStream(file);
      const cleanup = () => removeTempDatabase(file);
      res.on('close', cleanup);
      stream.on('error', (err) => {
        cleanup();
        if (!res.headersSent) res.destroy(err);
        else res.end();
      });
      stream.pipe(res);
    }),
  );

  /** Stage the newest snapshot, or a specific one from the list. */
  router.post(
    '/restore',
    asyncHandler(async (req, res) => {
      const cfg = config.githubBackup;
      if (!isConfigured(cfg)) {
        throw badRequest(
          'BACKUP_NOT_CONFIGURED',
          `ابتدا ${missingSettings(cfg).join(' و ')} را در محیط سرور تنظیم کنید`,
        );
      }
      const rawFile = req.body?.file;
      let file = null;
      if (rawFile !== undefined && rawFile !== null && String(rawFile).trim() !== '') {
        try {
          file = normalizeSnapshotName(String(rawFile).trim());
        } catch {
          throw badRequest('INVALID_SNAPSHOT', 'نام فایل بکاپ معتبر نیست');
        }
      }

      const result = await stageRestore({ cfg, client: createClientFor(cfg), fileName: file });
      if (!result.staged) {
        if (result.reason === 'snapshot-not-found' || result.reason === 'no-manifest') {
          throw notFound('بکاپی برای بازیابی پیدا نشد');
        }
        throw badRequest('RESTORE_NOT_STAGED', 'فایل بکاپ قابل بازیابی نبود');
      }
      res.status(202).json({
        staged: true,
        restore: result,
        restartRequired: true,
        message: 'بکاپ آماده شد. برای اعمال آن، سرویس را یک‌بار ری‌استارت کنید.',
      });
    }),
  );

  router.delete(
    '/restore',
    asyncHandler(async (_req, res) => {
      const result = await cancelStagedRestore();
      res.json({ ...result, message: result.canceled ? 'بازیابی در انتظار لغو شد' : 'بازیابی در انتظاری وجود ندارد' });
    }),
  );

  /** Read-only remote summary; useful for refresh buttons without the local stats. */
  router.get(
    '/status',
    asyncHandler(async (_req, res) => {
      const cfg = config.githubBackup;
      if (!isConfigured(cfg)) {
        return res.json({ configured: false, missing: missingSettings(cfg), ...describeConfig(cfg) });
      }
      const status = await backupStatus({ cfg, client: createClientFor(cfg) });
      return res.json({ configured: true, ...status });
    }),
  );

  return router;
}
