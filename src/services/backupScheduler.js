import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { isConfigured, missingSettings } from './githubBackup.js';

/**
 * Runs the GitHub backup on a configurable interval.
 *
 * State lives in `${DATA_DIR}/backup-state.json` (never in the database, so a
 * restore does not lose it), which also means a restart re-reads when the last
 * successful backup happened instead of pushing on every boot.
 */
const RETRY_DELAY_MS = 15 * 60 * 1000;

/**
 * Accepts either a callable log or a logger object with `info`/`warn`/`error`, so
 * the scheduler can be handed `logger` from the server or a plain function in tests.
 */
function normalizeLog(log) {
  const base = typeof log === 'function' ? log : () => {};
  return {
    info: typeof log?.info === 'function' ? log.info.bind(log) : base,
    warn: typeof log?.warn === 'function' ? log.warn.bind(log) : base,
    error: typeof log?.error === 'function' ? log.error.bind(log) : base,
  };
}

export function stateFileFor() {
  return process.env.BACKUP_GITHUB_STATE_FILE || path.join(config.dataDir, 'backup-state.json');
}

export function readState(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

export function writeState(state, file) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`);
  } catch {
    /* a missing state file only means "back up again on the next boot" */
  }
}

/** Milliseconds until the next backup is due (0 when one is overdue). */
export function msUntilDue({ lastSuccessAt, intervalMinutes, now = Date.now() } = {}) {
  if (!lastSuccessAt) return 0;
  const last = new Date(lastSuccessAt).getTime();
  if (!Number.isFinite(last)) return 0;
  return Math.max(0, last + intervalMinutes * 60 * 1000 - now);
}

export function createBackupScheduler({ cfg = config.githubBackup, log: rawLog = () => {}, runBackup, now = () => Date.now(), stateFile = stateFileFor() } = {}) {
  const log = normalizeLog(rawLog);
  let timer = null;
  let stopped = false;

  function schedule(delayMs) {
    if (stopped) return;
    timer = setTimeout(() => {
      timer = null;
      void tick();
    }, Math.max(0, delayMs));
    timer.unref?.();
  }

  async function tick() {
    if (stopped) return { skipped: true };
    const state = readState(stateFile);
    const due = msUntilDue({ lastSuccessAt: state.lastSuccessAt, intervalMinutes: cfg.intervalMinutes, now: now() });
    if (due > 0) {
      schedule(due);
      return { skipped: true, dueInMs: due };
    }
    try {
      const result = await runBackup();
      writeState({ ...state, lastSuccessAt: new Date(now()).toISOString(), lastFile: result?.file ?? null, lastError: null }, stateFile);
      log.info('scheduled GitHub backup complete', { file: result?.file ?? null, bytes: result?.bytes ?? null });
      schedule(cfg.intervalMinutes * 60 * 1000);
      return { backedUp: true, result };
    } catch (err) {
      const message = String(err?.message || err);
      writeState({ ...state, lastAttemptAt: new Date(now()).toISOString(), lastError: message }, stateFile);
      log.error('scheduled GitHub backup failed', { error: message });
      schedule(Math.min(RETRY_DELAY_MS, cfg.intervalMinutes * 60 * 1000));
      return { backedUp: false, error: message };
    }
  }

  function start() {
    if (!cfg.enabled) return { stop() {}, tick: async () => ({ skipped: true, reason: 'disabled' }) };
    if (!isConfigured(cfg)) {
      log.warn('GitHub backup is enabled but not configured; nothing will be uploaded', { missing: missingSettings(cfg) });
      return { stop() {}, tick: async () => ({ skipped: true, reason: 'not-configured' }) };
    }
    const state = readState(stateFile);
    const due = msUntilDue({ lastSuccessAt: state.lastSuccessAt, intervalMinutes: cfg.intervalMinutes, now: now() });
    schedule(due > 0 ? due : cfg.startDelayMs);
    log.info('GitHub backup scheduled', {
      repo: cfg.repo,
      branch: cfg.branch,
      everyMinutes: cfg.intervalMinutes,
      nextBackupInMinutes: Math.round((due > 0 ? due : cfg.startDelayMs) / 60000),
      keep: cfg.keep,
    });
    return {
      tick,
      stop() {
        stopped = true;
        if (timer) clearTimeout(timer);
        timer = null;
      },
    };
  }

  return { start, stop: () => { stopped = true; if (timer) clearTimeout(timer); }, tick };
}
