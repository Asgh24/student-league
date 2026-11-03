/**
 * A report-card row is created for every subject as soon as the card exists, so
 * grades start empty (both numeric and descriptive NULL). The original CHECK
 * constraint from migration 015 forbade that, making card creation fail.
 *
 * Rebuild the table without the constraint; the service validates that any
 * grade the teacher enters is either 0-100 or a known descriptive level.
 */

export const id = '018_report_card_grade_nullable';

export function up(db) {
  db.exec(`
    CREATE TABLE report_card_grades_new (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      report_id       INTEGER NOT NULL REFERENCES report_cards (id) ON DELETE CASCADE,
      subject_id      INTEGER REFERENCES report_card_subjects (id) ON DELETE SET NULL,
      subject_name    TEXT NOT NULL,
      grade_numeric   REAL,
      grade_descrip   TEXT,
      teacher_notes   TEXT
    );

    INSERT INTO report_card_grades_new
      (id, report_id, subject_id, subject_name, grade_numeric, grade_descrip, teacher_notes)
    SELECT id, report_id, subject_id, subject_name, grade_numeric, grade_descrip, teacher_notes
    FROM report_card_grades;

    DROP TABLE report_card_grades;
    ALTER TABLE report_card_grades_new RENAME TO report_card_grades;

    CREATE INDEX idx_report_card_grades_report ON report_card_grades (report_id);
    CREATE INDEX idx_report_card_grades_subject ON report_card_grades (subject_name);
    CREATE INDEX idx_report_card_grades_subject_id ON report_card_grades (subject_id);
  `);
}

export function down(db) {
  db.exec(`
    CREATE TABLE report_card_grades_old (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      report_id       INTEGER NOT NULL REFERENCES report_cards (id) ON DELETE CASCADE,
      subject_id      INTEGER REFERENCES report_card_subjects (id) ON DELETE SET NULL,
      subject_name    TEXT NOT NULL,
      grade_numeric   REAL,
      grade_descrip   TEXT,
      teacher_notes   TEXT,
      CHECK (grade_numeric IS NOT NULL OR grade_descrip IS NOT NULL)
    );

    INSERT INTO report_card_grades_old
      (id, report_id, subject_id, subject_name, grade_numeric, grade_descrip, teacher_notes)
    SELECT id, report_id, subject_id, subject_name, grade_numeric, grade_descrip, teacher_notes
    FROM report_card_grades;

    DROP TABLE report_card_grades;
    ALTER TABLE report_card_grades_old RENAME TO report_card_grades;

    CREATE INDEX idx_report_card_grades_report ON report_card_grades (report_id);
    CREATE INDEX idx_report_card_grades_subject ON report_card_grades (subject_name);
    CREATE INDEX idx_report_card_grades_subject_id ON report_card_grades (subject_id);
  `);
}
