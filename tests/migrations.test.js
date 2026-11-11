import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { closeDatabase, openDatabase } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';
import { migrations } from '../src/migrations/index.js';
import { buildFixture } from './fixtures.js';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

/** Opens a database with every migration before the homework upgrade applied. */
function openBeforeHomeworkUpgrade() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scl-migration-'));
  const db = openDatabase(path.join(dir, 'league.db'));
  runMigrations(db, migrations.filter((migration) => migration.id < '025_homework_penalties_and_column'));
  cleanups.push(() => {
    closeDatabase(db);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return db;
}

describe('025 homework penalties and column', () => {
  it('backfills the applied column and accepts the new not_brought status', () => {
    const db = openBeforeHomeworkUpgrade();
    const fixture = buildFixture(db);
    const discipline = fixture.columnsA.find((column) => column.name === 'انضباطی');
    const student = fixture.studentsA[0];
    const now = new Date().toISOString();

    const homework = db.prepare(`
      INSERT INTO homework (league_id, teacher_id, title, description, due_date, points, created_at)
      VALUES (?, ?, ?, '', NULL, 10, ?)
    `).run(fixture.leagueA.id, fixture.teacherA.id, 'تکلیف قدیمی', now);
    const homeworkId = Number(homework.lastInsertRowid);
    db.prepare(`
      INSERT INTO homework_status (homework_id, student_id, status, awarded, updated_at)
      VALUES (?, ?, 'done', 10, ?)
    `).run(homeworkId, student.id, now);

    runMigrations(db, migrations);

    // The existing award is remembered in the column it was really applied to.
    const status = db.prepare('SELECT column_id, status, awarded FROM homework_status WHERE homework_id = ?').get(homeworkId);
    expect(status).toEqual({ column_id: discipline.id, status: 'done', awarded: 10 });

    // The rebuilt CHECK accepts «نیاورده».
    db.prepare("UPDATE homework_status SET status = 'not_brought' WHERE homework_id = ?").run(homeworkId);
    expect(db.prepare('SELECT status FROM homework_status WHERE homework_id = ?').get(homeworkId).status).toBe('not_brought');

    // Existing assignments keep the legacy zero penalty and default column.
    const row = db.prepare('SELECT penalty_points, column_id FROM homework WHERE id = ?').get(homeworkId);
    expect(row).toEqual({ penalty_points: 0, column_id: null });
  });
});
