export const id = '020_homework_points';

/**
 * Homework points and the two extra statuses (غایب / ناقص).
 *
 *  - `homework.points` is set by the teacher when the assignment is created:
 *    انجام‌شده awards +points, غایب deducts points, انجام‌نشده/ناقص award 0.
 *  - `homework_status.awarded` remembers the points currently applied for that
 *    student, so every status change (or a points edit) only moves the
 *    difference and re-marking the same status never double-counts.
 *  - The status CHECK is widened from two values to four, which requires
 *    rebuilding the table (SQLite cannot alter a CHECK in place).
 */
export function up(db) {
  db.exec(`
    ALTER TABLE homework ADD COLUMN points INTEGER NOT NULL DEFAULT 0;

    CREATE TABLE homework_status_new (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      homework_id INTEGER NOT NULL REFERENCES homework (id) ON DELETE CASCADE,
      student_id INTEGER NOT NULL REFERENCES students (id) ON DELETE CASCADE,
      status     TEXT NOT NULL DEFAULT 'not_done'
                 CHECK (status IN ('done', 'not_done', 'incomplete', 'absent')),
      awarded    INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      UNIQUE (homework_id, student_id)
    );
    INSERT INTO homework_status_new (id, homework_id, student_id, status, awarded, updated_at)
      SELECT id, homework_id, student_id, status, 0, updated_at FROM homework_status;
    DROP TABLE homework_status;
    ALTER TABLE homework_status_new RENAME TO homework_status;
    CREATE INDEX idx_homework_status_homework ON homework_status (homework_id);
    CREATE INDEX idx_homework_status_student ON homework_status (student_id);
  `);
}
