/**
 * «کارنامه دانش‌آموز»: Allows teachers to manually add report cards for students.
 * 
 * Two main entities:
 *  - report_card_subjects: Configurable subjects for each league (created once, reused)
 *  - report_cards: Student-specific evaluations with numeric or descriptive grades
 * 
 * Design decisions:
 *  - Teachers define subjects per league so each class can have custom subjects
 *  - Each report card links to a student, includes both numeric (percentage) and descriptive grades
 *  - Achievement points from monthly leagues are joined dynamically when viewing reports
 *  - Descriptive grades use Persian scale: خیلی خوب، خوب، قابل قبول، نیاز به تلاش
 */

export const id = '015_student_reports';

export function up(db) {
  db.exec(`
    -- Report card subjects configuration (one-time setup per league)
    CREATE TABLE report_card_subjects (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      league_id   INTEGER NOT NULL REFERENCES leagues (id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      order_index INTEGER NOT NULL DEFAULT 0,
      color       TEXT DEFAULT '#6366f1',
      created_at  TEXT NOT NULL,
      UNIQUE(league_id, name)
    );
    CREATE INDEX idx_report_card_subjects_league ON report_card_subjects (league_id);

    -- Student report cards (manual entry by teacher)
    CREATE TABLE report_cards (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id     INTEGER NOT NULL REFERENCES students (id) ON DELETE CASCADE,
      semester       TEXT NOT NULL DEFAULT 'نوبت اول',
      total_percent  REAL DEFAULT 0,
      is_published   INTEGER NOT NULL DEFAULT 0,
      notes          TEXT,
      created_at     TEXT NOT NULL,
      updated_at     TEXT NOT NULL,
      UNIQUE(student_id, semester)
    );
    CREATE INDEX idx_report_cards_student ON report_cards (student_id, semester);

    -- Subject grades within a report card
    CREATE TABLE report_card_grades (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      report_id       INTEGER NOT NULL REFERENCES report_cards (id) ON DELETE CASCADE,
      subject_name    TEXT NOT NULL REFERENCES report_card_subjects (name),
      grade_numeric   REAL, -- 0-100 percentage
      grade_descrip   TEXT, -- descriptive: خیلی خوب، خوب، etc
      teacher_notes   TEXT,
      CHECK (grade_numeric IS NOT NULL OR grade_descrip IS NOT NULL)
    );
    CREATE INDEX idx_report_card_grades_report ON report_card_grades (report_id);
    CREATE INDEX idx_report_card_grades_subject ON report_card_grades (subject_name);

    -- Achievement badges/special awards displayed on report cards
    CREATE TABLE report_achievements (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id   INTEGER NOT NULL REFERENCES students (id) ON DELETE CASCADE,
      title        TEXT NOT NULL,
      description  TEXT,
      icon         TEXT DEFAULT '🏆',
      points       INTEGER DEFAULT 0,
      category     TEXT DEFAULT 'general',
      date_awarded TEXT NOT NULL,
      created_at   TEXT NOT NULL
    );
    CREATE INDEX idx_report_achievements_student ON report_achievements (student_id);
    CREATE INDEX idx_report_achievements_category ON report_achievements (category);
  `);
}

export function down(db) {
  db.exec(`
    DROP TABLE IF EXISTS report_achievements;
    DROP TABLE IF EXISTS report_card_grades;
    DROP TABLE IF EXISTS report_cards;
    DROP TABLE IF EXISTS report_card_subjects;
  `);
}
