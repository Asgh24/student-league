export const id = '024_student_parent_credentials';

/** Remembers which student logins should follow the saved parent mobile. */
export function up(db) {
  db.exec(`
    ALTER TABLE students ADD COLUMN credentials_from_parent INTEGER NOT NULL DEFAULT 0
      CHECK (credentials_from_parent IN (0, 1));
  `);
}
