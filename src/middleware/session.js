import session from 'express-session';
import { config } from '../config.js';

/**
 * Minimal express-session store backed by the same SQLite connection as the
 * application. Sessions live in the `sessions` table so they survive restarts
 * and work on multi-instance deployments sharing the volume.
 */
export function createSessionStore(db) {
  const statements = {
    get: db.prepare('SELECT data, expires FROM sessions WHERE sid = ?'),
    set: db.prepare('INSERT INTO sessions (sid, expires, data) VALUES (?, ?, ?) ON CONFLICT (sid) DO UPDATE SET expires = excluded.expires, data = excluded.data'),
    touch: db.prepare('UPDATE sessions SET expires = ? WHERE sid = ?'),
    destroy: db.prepare('DELETE FROM sessions WHERE sid = ?'),
    sweep: db.prepare('DELETE FROM sessions WHERE expires < ?'),
    count: db.prepare('SELECT COUNT(*) AS n FROM sessions'),
    clear: db.prepare('DELETE FROM sessions'),
    all: db.prepare('SELECT sid, data FROM sessions WHERE expires >= ?'),
  };

  function expiryOf(sess) {
    const cookieExpires = sess?.cookie?.expires;
    if (cookieExpires) return new Date(cookieExpires).getTime();
    return Date.now() + config.sessionMaxAgeMs;
  }

  class SqliteSessionStore extends session.Store {
    get(sid, callback) {
      try {
        const row = statements.get.get(sid);
        if (!row) return callback(null, null);
        if (row.expires < Date.now()) {
          statements.destroy.run(sid);
          return callback(null, null);
        }
        return callback(null, JSON.parse(row.data));
      } catch (err) {
        return callback(err);
      }
    }

    set(sid, sess, callback) {
      try {
        statements.set.run(sid, expiryOf(sess), JSON.stringify(sess));
        return callback(null);
      } catch (err) {
        return callback(err);
      }
    }

    touch(sid, sess, callback) {
      try {
        statements.touch.run(expiryOf(sess), sid);
        return callback(null);
      } catch (err) {
        return callback(err);
      }
    }

    destroy(sid, callback) {
      try {
        statements.destroy.run(sid);
        return callback(null);
      } catch (err) {
        return callback(err);
      }
    }

    length(callback) {
      try {
        return callback(null, statements.count.get().n);
      } catch (err) {
        return callback(err);
      }
    }

    clear(callback) {
      try {
        statements.clear.run();
        return callback(null);
      } catch (err) {
        return callback(err);
      }
    }

    all(callback) {
      try {
        const rows = statements.all.all(Date.now()).map((r) => JSON.parse(r.data));
        return callback(null, rows);
      } catch (err) {
        return callback(err);
      }
    }

    /** Removes expired rows; safe to call periodically. */
    sweep() {
      return statements.sweep.run(Date.now()).changes;
    }
  }

  return new SqliteSessionStore();
}

export function sessionMiddleware(store) {
  return session({
    name: config.sessionCookieName,
    secret: config.sessionSecret,
    store,
    resave: false,
    // Only persist a session once the app actually stores something in it
    // (a CSRF token or a login), so anonymous page views cannot create rows.
    saveUninitialized: false,
    // The session lives for exactly `sessionMaxAgeMs` (24h by default) from the
    // login; normal activity must not extend that window.
    rolling: false,
    proxy: config.trustProxy,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.isProd,
      maxAge: config.sessionMaxAgeMs,
      path: '/',
    },
  });
}

/**
 * Periodically deletes expired session rows. Without this the store only drops
 * rows that are looked up again, so abandoned sessions accumulate forever.
 * The timer is unref'd so it never keeps the process alive.
 */
export function startSessionSweep(store, { intervalMs = 60 * 60 * 1000, onSweep = null } = {}) {
  const run = () => {
    try {
      const removed = store.sweep();
      if (removed > 0 && onSweep) onSweep(removed);
    } catch {
      /* sweeping is best effort; a failure must not crash the process */
    }
  };
  run();
  const timer = setInterval(run, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  return timer;
}
