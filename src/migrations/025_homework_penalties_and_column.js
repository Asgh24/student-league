export const id = '025_homework_penalties_and_column';

/**
 * Homework scoring upgrade:
 *
 *  - `homework.column_id` picks which league score column receives the award.
 *    NULL keeps the legacy behaviour (the class «انضباطی» column, or the first
 *    column when no discipline column exists).
 *  - `homework.penalty_points` is the amount deducted for «انجام نشده»،
 *    «ناقص» and the new «نیاورده» status. `points` still rewards «انجام شد»
 *    and is deducted for «غایب» as before.
 *  - `homework_status.column_id` remembers where the applied award actually
 *    went, so changing the homework column moves the previous award instead of
 *    leaving it behind in the old column.
 *  - The status CHECK gains `not_brought`, which requires rebuilding the table.
 */
export function up(db) {
  db.exec(`
    ALTER TABLE homework ADD COLUMN column_id INTEGER REFERENCES columns (id) ON DELETE SET NULL;
    ALTER TABLE homework ADD COLUMN penalty_points INTEGER NOT NULL DEFAULT 0;

    CREATE TABLE homework_status_new (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      homework_id INTEGER NOT NULL REFERENCES homework (id) ON DELETE CASCADE,
      student_id  INTEGER NOT NULL REFERENCES students (id) ON DELETE CASCADE,
      status      TEXT NOT NULL DEFAULT 'not_done'
                  CHECK (status IN ('done', 'not_done', 'incomplete', 'absent', 'not_brought')),
      awarded     INTEGER NOT NULL DEFAULT 0,
      column_id   INTEGER REFERENCES columns (id) ON DELETE SET NULL,
      updated_at  TEXT NOT NULL,
      UNIQUE (homework_id, student_id)
    );
    INSERT INTO homework_status_new (id, homework_id, student_id, status, awarded, column_id, updated_at)
      SELECT id, homework_id, student_id, status, awarded, NULL, updated_at FROM homework_status;
    DROP TABLE homework_status;
    ALTER TABLE homework_status_new RENAME TO homework_status;
    CREATE INDEX idx_homework_status_homework ON homework_status (homework_id);
    CREATE INDEX idx_homework_status_student ON homework_status (student_id);

    -- Existing awards were applied to the class «انضباطی» column (or the first
    -- column when the class has none). Remember that column so a later column
    -- change reverses the award from where it really went.
    UPDATE homework_status
    SET column_id = (
      SELECT c.id
      FROM columns c
      JOIN homework h ON h.league_id = c.league_id
      WHERE h.id = homework_status.homework_id
      ORDER BY CASE WHEN c.name = 'انضباطی' THEN 0 ELSE 1 END, c.position ASC, c.id ASC
      LIMIT 1
    )
    WHERE awarded <> 0;
  `);
}
