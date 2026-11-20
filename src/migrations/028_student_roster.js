export const id = '028_student_roster';

/**
 * Persistent teacher roster separated from league-specific participation.
 * Existing student rows stay untouched so every completed league keeps its
 * scores/history; each row is linked to a durable profile that can be copied
 * into the next league.
 */
export function up(db) {
  db.exec(`
    CREATE TABLE student_profiles (
      id                      INTEGER PRIMARY KEY AUTOINCREMENT,
      teacher_id              INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      user_id                 INTEGER REFERENCES users (id) ON DELETE SET NULL,
      name                    TEXT NOT NULL,
      parent_phone            TEXT NOT NULL DEFAULT '',
      student_phone           TEXT NOT NULL DEFAULT '',
      shad_pv_url             TEXT NOT NULL DEFAULT '',
      credentials_from_parent INTEGER NOT NULL DEFAULT 0
        CHECK (credentials_from_parent IN (0, 1)),
      created_at              TEXT NOT NULL,
      updated_at              TEXT NOT NULL
    );

    CREATE INDEX idx_student_profiles_teacher ON student_profiles (teacher_id, name);
    CREATE UNIQUE INDEX idx_student_profiles_user
      ON student_profiles (user_id) WHERE user_id IS NOT NULL;

    ALTER TABLE students ADD COLUMN profile_id INTEGER
      REFERENCES student_profiles (id) ON DELETE SET NULL;

    INSERT INTO student_profiles
      (id, teacher_id, user_id, name, parent_phone, student_phone, shad_pv_url,
       credentials_from_parent, created_at, updated_at)
    SELECT s.id, l.teacher_id, s.user_id, s.name, s.parent_phone, s.student_phone,
           s.shad_pv_url, s.credentials_from_parent, s.created_at, s.created_at
    FROM students s
    JOIN leagues l ON l.id = s.league_id
    ORDER BY s.id;

    UPDATE students SET profile_id = id;

    CREATE INDEX idx_students_profile ON students (profile_id);
    CREATE UNIQUE INDEX idx_students_league_profile
      ON students (league_id, profile_id) WHERE profile_id IS NOT NULL;
  `);
}
