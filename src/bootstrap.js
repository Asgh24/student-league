import { config } from './config.js';
import { createUser, findByUsername, updatePassword } from './repositories/users.js';
import { createAdmin, findAdminByUsername, updateAdminPassword } from './repositories/admins.js';

/**
 * Creates the first teacher account on an empty database.
 *
 * Production never runs the demo seed, so without this an empty production
 * database has no account at all and nobody can log in. `npm run bootstrap`
 * uses `force` to reset the password of an existing account (forgotten
 * password), which is why it is a CLI and not an HTTP route.
 */
const WEAK_PASSWORDS = new Set(['teacher1234', 'student1234', 'changeme', 'change-me', 'password', 'password123']);

export const MIN_PASSWORD_LENGTH = 8;

export function bootstrapProblem(cfg = config.bootstrap) {
  if (!cfg.username) return 'BOOTSTRAP_TEACHER_USER (or SEED_TEACHER_USER) is empty';
  if (!cfg.password) return `no password given: set BOOTSTRAP_TEACHER_PASS (at least ${MIN_PASSWORD_LENGTH} characters)`;
  if (cfg.password.length < MIN_PASSWORD_LENGTH) return `password is shorter than ${MIN_PASSWORD_LENGTH} characters`;
  if (WEAK_PASSWORDS.has(cfg.password.toLowerCase()) && !cfg.allowWeakPassword) {
    return 'password is a known demo default; pick a real one or set BOOTSTRAP_ALLOW_WEAK=true';
  }
  return null;
}

export function runBootstrap(db, { cfg = config.bootstrap, force = false, log = () => {} } = {}) {
  const userCount = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (userCount > 0 && !force) {
    return { created: false, reason: 'database-already-has-users', users: userCount };
  }

  const problem = bootstrapProblem(cfg);
  if (problem) {
    log(`first teacher account not created: ${problem}`, { username: cfg.username || null });
    return { created: false, reason: 'invalid-config', problem };
  }

  const existing = findByUsername(db, cfg.username);
  if (existing) {
    updatePassword(db, existing.id, cfg.password);
    log(`bootstrap: password reset for "${cfg.username}"`, { role: existing.role });
    return { created: false, updated: true, username: cfg.username };
  }

  const user = createUser(db, {
    username: cfg.username,
    password: cfg.password,
    role: 'teacher',
    displayName: cfg.displayName,
  });
  log(`bootstrap: created the first teacher "${cfg.username}" — log in and change the password`, { id: user.id });
  return { created: true, username: user.username, id: user.id };
}

/**
 * Creates the site-owner account. It is independent of the teacher bootstrap:
 * a database with teachers can still gain its first admin on deploy. The
 * development default is admin/admin1234; production only creates an account
 * when ADMIN_PASSWORD is set.
 */
export function runAdminBootstrap(db, { cfg = config.admin, force = false, log = () => {} } = {}) {
  if (!cfg.enabled) return { created: false, reason: 'disabled' };
  if (!cfg.username) return { created: false, reason: 'invalid-config', problem: 'ADMIN_USERNAME is empty' };
  if (!cfg.password) {
    return {
      created: false,
      reason: 'invalid-config',
      problem: 'ADMIN_PASSWORD is required before an admin account can be created',
    };
  }
  if (cfg.password.length < MIN_PASSWORD_LENGTH) {
    return { created: false, reason: 'invalid-config', problem: `admin password is shorter than ${MIN_PASSWORD_LENGTH} characters` };
  }

  const existing = findAdminByUsername(db, cfg.username);
  if (existing) {
    if (force) {
      updateAdminPassword(db, existing.id, cfg.password);
      log(`bootstrap: admin password reset for "${cfg.username}"`);
      return { created: false, updated: true, username: cfg.username };
    }
    return { created: false, reason: 'already-exists', username: cfg.username };
  }

  const admin = createAdmin(db, {
    username: cfg.username,
    password: cfg.password,
    displayName: cfg.displayName,
  });
  log(`bootstrap: created the site admin "${cfg.username}" — change ADMIN_PASSWORD after the first login`, { id: admin.id });
  return { created: true, username: admin.username, id: admin.id };
}
