export const id = '009_mcq_questions';

/**
 * Multiple-choice class questions.
 *
 * `options_json` holds the teacher-authored choices (a JSON array of strings)
 * and `correct_index` points at the right one. Both stay NULL for questions
 * created before this migration, so the old free-text flow keeps working.
 * `selected_index` records which choice a student picked; `answers.body` still
 * stores the matching option text so every existing view keeps working.
 */
export function up(db) {
  db.exec(`
    ALTER TABLE questions ADD COLUMN options_json TEXT;
    ALTER TABLE questions ADD COLUMN correct_index INTEGER;
    ALTER TABLE answers ADD COLUMN selected_index INTEGER;
  `);
}
