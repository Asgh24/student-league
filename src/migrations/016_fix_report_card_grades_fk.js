/**
 * Migration 015 declared `subject_name` as a foreign key to
 * `report_card_subjects(name)`, but SQLite only accepts a UNIQUE column as a
 * foreign-key parent. That left a broken FK on `report_card_grades`, so any
 * cascade delete (league or teacher removal) failed with
 * "foreign key mismatch".
 *
 * Rebuild the table without that invalid reference. The subject name is still
 * validated by the report-card service, and the index keeps lookups fast.
 */

export const id = '016_fix_report_card_grades_fk';

export function up(db) {
  db.exec(`
    CREATE TABLE report_card_grades_new (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      report_id       INTEGER NOT NULL REFERENCES report_cards (id) ON DELETE CASCADE,
      subject_name    TEXT NOT NULL,
      grade_numeric   REAL,
      grade_descrip   TEXT,
      teacher_notes   TEXT,
      CHECK (grade_numeric IS NOT NULL OR grade_descrip IS NOT NULL)
    );

    INSERT INTO report_card_grades_new
      (id, report_id, subject_name, grade_numeric, grade_descrip, teacher_notes)
    SELECT id, report_id, subject_name, grade_numeric, grade_descrip, teacher_notes
    FROM report_card_grades;

    DROP TABLE report_card_grades;
    ALTER TABLE report_card_grades_new RENAME TO report_card_grades;

    CREATE INDEX idx_report_card_grades_report ON report_card_grades (report_id);
    CREATE INDEX idx_report_card_grades_subject ON report_card_grades (subject_name);
  `);
}

export function down(db) {
  db.exec(`
    CREATE TABLE report_card_grades_old (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      report_id       INTEGER NOT NULL REFERENCES report_cards (id) ON DELETE CASCADE,
      subject_name    TEXT NOT NULL REFERENCES report_card_subjects (name),
      grade_numeric   REAL,
      grade_descrip   TEXT,
      teacher_notes   TEXT,
      CHECK (grade_numeric IS NOT NULL OR grade_descrip IS NOT NULL)
    );

    INSERT INTO report_card_grades_old
      (id, report_id, subject_name, grade_numeric, grade_descrip, teacher_notes)
    SELECT id, report_id, subject_name, grade_numeric, grade_descrip, teacher_notes
    FROM report_card_grades;

    DROP TABLE report_card_grades;
    ALTER TABLE report_card_grades_old RENAME TO report_card_grades;

    CREATE INDEX idx_report_card_grades_report ON report_card_grades (report_id);
    CREATE INDEX idx_report_card_grades_subject ON report_card_grades (subject_name);
  `);
}
