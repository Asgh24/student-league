import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const configUrl = new URL('../src/config.js', import.meta.url).href;
const tempDirs = [];

function tempDir() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'scl-env-'));
  tempDirs.push(dir);
  return dir;
}

function writeEnv(dir, name, values) {
  const body = Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  writeFileSync(path.join(dir, name), `${body}\n`, 'utf8');
}

function readConfig(cwd, extraEnv = {}) {
  const script = `
    import { config } from ${JSON.stringify(configUrl)};
    console.log(JSON.stringify({
      env: config.env,
      sessionSecret: config.sessionSecret,
      appName: config.appName,
      dataDir: config.dataDir,
    }));
  `;
  const env = { ...process.env, ...extraEnv };
  for (const key of [
    'NODE_ENV', 'SESSION_SECRET', 'SECRETS_KEY', 'DATA_DIR', 'APP_NAME',
    'APP_BASE_URL', 'ENV_FILE', 'DOTENV_CONFIG_PATH',
  ]) {
    if (!(key in extraEnv)) delete env[key];
  }

  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd,
    env,
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);

  const lines = result.stdout.trim().split(/\r?\n/);
  return JSON.parse(lines.at(-1));
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('environment file loading', () => {
  it('prefers production.env over .env in production', () => {
    const dir = tempDir();
    writeEnv(dir, 'production.env', {
      SESSION_SECRET: 'production-secret-that-is-long-enough',
      APP_NAME: 'production-app',
      DATA_DIR: './production-data',
    });
    writeEnv(dir, '.env', {
      SESSION_SECRET: 'development-secret-that-is-long-enough',
      APP_NAME: 'development-app',
      DATA_DIR: './development-data',
    });

    const result = readConfig(dir, { NODE_ENV: 'production' });

    expect(result.env).toBe('production');
    expect(result.sessionSecret).toBe('production-secret-that-is-long-enough');
    expect(result.appName).toBe('production-app');
    expect(result.dataDir).toBe(path.join(dir, 'production-data'));
  });

  it('lets panel or shell variables override production.env', () => {
    const dir = tempDir();
    writeEnv(dir, 'production.env', {
      SESSION_SECRET: 'file-secret-that-is-long-enough',
      APP_NAME: 'file-app',
      DATA_DIR: './file-data',
    });

    const result = readConfig(dir, {
      NODE_ENV: 'production',
      SESSION_SECRET: 'panel-secret-that-is-long-enough',
      APP_NAME: 'panel-app',
      DATA_DIR: './panel-data',
    });

    expect(result.sessionSecret).toBe('panel-secret-that-is-long-enough');
    expect(result.appName).toBe('panel-app');
    expect(result.dataDir).toBe(path.join(dir, 'panel-data'));
  });

  it('falls back to .env when production.env is absent', () => {
    const dir = tempDir();
    writeEnv(dir, '.env', {
      SESSION_SECRET: 'dotenv-secret-that-is-long-enough',
      APP_NAME: 'dotenv-app',
    });

    const result = readConfig(dir, { NODE_ENV: 'production' });

    expect(result.sessionSecret).toBe('dotenv-secret-that-is-long-enough');
    expect(result.appName).toBe('dotenv-app');
  });

  it('honours DOTENV_CONFIG_PATH so tests stay isolated', () => {
    const dir = tempDir();
    writeEnv(dir, 'production.env', {
      SESSION_SECRET: 'production-secret-that-is-long-enough',
      APP_NAME: 'production-app',
    });
    writeEnv(dir, 'explicit.env', {
      SESSION_SECRET: 'explicit-secret-that-is-long-enough',
      APP_NAME: 'explicit-app',
    });

    const result = readConfig(dir, {
      NODE_ENV: 'production',
      DOTENV_CONFIG_PATH: path.join(dir, 'explicit.env'),
    });

    expect(result.sessionSecret).toBe('explicit-secret-that-is-long-enough');
    expect(result.appName).toBe('explicit-app');
  });
});
