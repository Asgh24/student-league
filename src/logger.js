import { config } from './config.js';

const LEVELS = { debug: 20, info: 30, warn: 40, error: 50, silent: 100 };

const SENSITIVE = new Set(['password', 'pass', 'currentPassword', 'newPassword', 'password_hash', 'secret', 'token']);

function scrub(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(scrub);
  const out = {};
  for (const [key, val] of Object.entries(value)) {
    out[key] = SENSITIVE.has(key) ? '[redacted]' : scrub(val);
  }
  return out;
}

function emit(level, message, fields) {
  if (LEVELS[level] < (LEVELS[config.logLevel] ?? 20)) return;
  const record = { level, time: new Date().toISOString(), msg: String(message) };
  if (fields && typeof fields === 'object') Object.assign(record, scrub(fields));
  const line = `${JSON.stringify(record)}\n`;
  if (level === 'error' || level === 'warn') process.stderr.write(line);
  else process.stdout.write(line);
}

function make(base) {
  return {
    debug: (msg, fields) => emit('debug', msg, { ...base, ...fields }),
    info: (msg, fields) => emit('info', msg, { ...base, ...fields }),
    warn: (msg, fields) => emit('warn', msg, { ...base, ...fields }),
    error: (msg, fields) => emit('error', msg, { ...base, ...fields }),
    child: (bindings) => make({ ...base, ...bindings }),
  };
}

export const logger = make({});
