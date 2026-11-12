export const id = '026_discipline_sheet';

/**
 * Independent daily discipline sheet, modelled on attendance but without any
 * automatic score effect. Each student gets one entry per day:
 *
 *  - `status` is «منظم» (`orderly`) or «بین‌نظمی» (`disorderly`).
 *  - `note` stores the optional reason the teacher/assistant wrote.
 *  - `actor_id` remembers who marked it (teacher or assistant).
 *
 * The unique key makes repeated edits update the same row instead of stacking.
 */
export function up(db) {
  db.exec(`
    CREATE TABLE discipline (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      league_id  INTEGER NOT NULL REFERENCES leagues (id) ON DELETE CASCADE,
      student_id INTEGER NOT NULL REFERENCES students (id) ON DELETE CASCADE,
      day        TEXT NOT NULL,
      status     TEXT NOT NULL CHECK (status IN ('orderly', 'disorderly')),
      note       TEXT NOT NULL DEFAULT '',
      actor_id   INTEGER REFERENCES users (id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (student_id, day)
    );
    CREATE INDEX idx_discipline_league_day ON discipline (league_id, day);
    CREATE INDEX idx_discipline_student ON discipline (student_id, day);
  `);
}
