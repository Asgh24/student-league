import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { closeDatabase, openDatabase } from '../src/db.js';
import { config } from '../src/config.js';
import { runMigrations } from '../src/migrate.js';
import { migrations } from '../src/migrations/index.js';
import { bootstrapProblem, runBootstrap } from '../src/bootstrap.js';
import { findByUsername, verifyPassword } from '../src/repositories/users.js';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

function openDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scl-bootstrap-'));
  const db = openDatabase(path.join(dir, 'league.db'));
  runMigrations(db, migrations);
  cleanups.push(() => {
    closeDatabase(db);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return db;
}

function cfg(overrides = {}) {
  return { enabled: true, username: 'teacher', password: 'first-teacher-password', displayName: 'مدیر', allowWeakPassword: false, ...overrides };
}

describe('first teacher bootstrap', () => {
  it('creates a teacher who can log in with the configured password', () => {
    const db = openDb();
    const messages = [];
    const result = runBootstrap(db, { cfg: cfg(), log: (message) => messages.push(message) });

    expect(result).toMatchObject({ created: true, username: 'teacher' });
    const user = findByUsername(db, 'teacher');
    expect(user.role).toBe('teacher');
    expect(user.display_name).toBe('مدیر');
    expect(verifyPassword('first-teacher-password', user.password_hash)).toBe(true);
    expect(verifyPassword('teacher1234', user.password_hash)).toBe(false);
    expect(messages.join(' ')).toMatch(/created the first teacher/);
  });

  it('does nothing when the database already has accounts', () => {
    const db = openDb();
    runBootstrap(db, { cfg: cfg(), log: () => {} });
    const second = runBootstrap(db, { cfg: cfg({ username: 'other' }), log: () => {} });

    expect(second).toMatchObject({ created: false, reason: 'database-already-has-users' });
    expect(findByUsername(db, 'other')).toBeUndefined();
  });

  it('resets the password with force, which is how a forgotten login is recovered', () => {
    const db = openDb();
    runBootstrap(db, { cfg: cfg(), log: () => {} });
    const result = runBootstrap(db, { cfg: cfg({ password: 'a-brand-new-password' }), force: true, log: () => {} });

    expect(result).toMatchObject({ created: false, updated: true, username: 'teacher' });
    const user = findByUsername(db, 'teacher');
    expect(verifyPassword('a-brand-new-password', user.password_hash)).toBe(true);
    expect(verifyPassword('first-teacher-password', user.password_hash)).toBe(false);
    expect(db.prepare('SELECT COUNT(*) AS n FROM users').get().n).toBe(1);
  });

  it('never creates an account without a usable password', () => {
    const db = openDb();
    for (const password of ['', 'short', 'teacher1234']) {
      const messages = [];
      const result = runBootstrap(db, { cfg: cfg({ password }), log: (message) => messages.push(message) });
      expect(result).toMatchObject({ created: false, reason: 'invalid-config' });
      expect(messages.join(' ')).toMatch(/not created/);
    }
    expect(db.prepare('SELECT COUNT(*) AS n FROM users').get().n).toBe(0);
  });

  it('accepts a demo password only when weak passwords are explicitly allowed', () => {
    expect(bootstrapProblem(cfg({ password: 'teacher1234' }))).toMatch(/demo default/);
    expect(bootstrapProblem(cfg({ password: 'teacher1234', allowWeakPassword: true }))).toBeNull();
    expect(bootstrapProblem(cfg({ password: 'teacher1234', allowWeakPassword: true, username: '' }))).toMatch(/USER/);
  });

  it('is enabled in production and opt-in in development', () => {
    const previous = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      expect(config.bootstrap.enabled).toBe(true);
      process.env.NODE_ENV = 'development';
      expect(config.bootstrap.enabled).toBe(false);
      process.env.BOOTSTRAP_TEACHER = 'true';
      expect(config.bootstrap.enabled).toBe(true);
    } finally {
      delete process.env.BOOTSTRAP_TEACHER;
      process.env.NODE_ENV = previous;
    }
  });

  it('falls back to the SEED_* names for the username but never for a default password', () => {
    const previous = { user: process.env.SEED_TEACHER_USER, pass: process.env.SEED_TEACHER_PASS, boot: process.env.BOOTSTRAP_TEACHER_PASS };
    try {
      process.env.SEED_TEACHER_USER = 'modir';
      delete process.env.BOOTSTRAP_TEACHER_PASS;
      delete process.env.SEED_TEACHER_PASS;
      expect(config.bootstrap.username).toBe('modir');
      expect(config.bootstrap.password).toBe('');
      expect(bootstrapProblem(config.bootstrap)).toMatch(/BOOTSTRAP_TEACHER_PASS/);

      process.env.SEED_TEACHER_PASS = 'teacher1234';
      expect(bootstrapProblem(config.bootstrap)).toMatch(/demo default/);

      process.env.BOOTSTRAP_TEACHER_PASS = 'a-real-production-password';
      expect(bootstrapProblem(config.bootstrap)).toBeNull();
    } finally {
      if (previous.user === undefined) delete process.env.SEED_TEACHER_USER; else process.env.SEED_TEACHER_USER = previous.user;
      if (previous.pass === undefined) delete process.env.SEED_TEACHER_PASS; else process.env.SEED_TEACHER_PASS = previous.pass;
      if (previous.boot === undefined) delete process.env.BOOTSTRAP_TEACHER_PASS; else process.env.BOOTSTRAP_TEACHER_PASS = previous.boot;
    }
  });
});
