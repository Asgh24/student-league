/**
 * Links report-card grades to their subject row and adds the missing
 * `updated_at` column used when a teacher edits a subject.
 *
 * Until now grades only stored the subject name, so renaming a subject left old
 * grades behind. The backfill below resolves existing rows by league + name.
 */

export const id = '017_report_card_subject_links';

export function up(db) {
  db.exec(`
    ALTER TABLE report_card_subjects ADD COLUMN updated_at TEXT;
    ALTER TABLE report_card_grades ADD COLUMN subject_id INTEGER REFERENCES report_card_subjects (id) ON DELETE SET NULL;
    CREATE INDEX idx_report_card_grades_subject_id ON report_card_grades (subject_id);

    UPDATE report_card_subjects SET updated_at = created_at WHERE updated_at IS NULL;

    UPDATE report_card_grades
    SET subject_id = (
      SELECT sub.id
      FROM report_card_subjects sub
      JOIN report_cards card ON card.id = report_card_grades.report_id
      JOIN students student ON student.id = card.student_id
      WHERE sub.league_id = student.league_id
        AND sub.name = report_card_grades.subject_name
      LIMIT 1
    )
    WHERE subject_id IS NULL;
  `);
}

export function down(db) {
  db.exec(`
    DROP INDEX IF EXISTS idx_report_card_grades_subject_id;
    ALTER TABLE report_card_grades DROP COLUMN subject_id;
    ALTER TABLE report_card_subjects DROP COLUMN updated_at;
  `);
}
