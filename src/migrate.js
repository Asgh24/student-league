import { logger } from './logger.js';

/**
 * Applies every pending migration exactly once, in id order, each inside its
 * own transaction. The `_migrations` table records what has been applied.
 */
export function runMigrations(db, migrations) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set(db.prepare('SELECT id FROM _migrations').all().map((r) => r.id));
  const ordered = [...migrations].sort((a, b) => a.id.localeCompare(b.id));
  const ran = [];

  for (const migration of ordered) {
    if (applied.has(migration.id)) continue;
    const apply = db.transaction(() => {
      migration.up(db);
      db.prepare('INSERT INTO _migrations (id, applied_at) VALUES (?, ?)').run(migration.id, new Date().toISOString());
    });
    apply();
    ran.push(migration.id);
    logger.info('migration applied', { id: migration.id });
  }

  return { ran, total: ordered.length, applied: applied.size + ran.length };
}

export function migrationStatus(db, migrations) {
  const applied = new Set(db.prepare('SELECT id FROM _migrations').all().map((r) => r.id));
  return [...migrations]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((m) => ({ id: m.id, applied: applied.has(m.id) }));
}
