/**
 * Student report card services.
 * 
 * Features:
 *  - Configure subjects per league (one-time setup)
 *  - Create/update report cards for students
 *  - Add/edit grades (numeric or descriptive)
 *  - Display achievements and monthly league points
 */

import { isoNow } from '../lib/http.js';
import { hasAssistantPermission } from '../middleware/auth.js';

/** Persian descriptive grading scale */
export const DESCRIPTIVE_GRADES = [
  { value: 'very_good', label: 'خیلی خوب', minScore: 90 },
  { value: 'good', label: 'خوب', minScore: 75 },
  { value: 'acceptable', label: 'قابل قبول', minScore: 60 },
  { value: 'needs_improvement', label: 'نیاز به تلاش بیشتر', minScore: 0 },
];

export function getDescriptiveGrade(numericGrade) {
  if (numericGrade === null || numericGrade === undefined) return null;
  for (const grade of DESCRIPTIVE_GRADES) {
    if (numericGrade >= grade.minScore) return grade.value;
  }
  return 'needs_improvement';
}

export function getDescriptiveLabel(value) {
  const grade = DESCRIPTIVE_GRADES.find(g => g.value === value);
  return grade ? grade.label : value;
}

/** ===== Subjects Configuration ===== */

export function listReportCardSubjects(db, leagueId) {
  return db.prepare(`
    SELECT * FROM report_card_subjects
    WHERE league_id = ?
    ORDER BY order_index ASC, name ASC
  `).all(leagueId);
}

export function createReportCardSubject(db, { leagueId, name, orderIndex, color }) {
  const now = isoNow();
  const result = db.prepare(`
    INSERT INTO report_card_subjects (league_id, name, order_index, color, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(leagueId, name.trim(), orderIndex ?? 0, color ?? '#6366f1', now);
  
  return db.prepare('SELECT * FROM report_card_subjects WHERE id = ?').get(result.lastInsertRowid);
}

export function updateReportCardSubject(db, subjectId, { name, orderIndex, color }) {
  const existing = db.prepare('SELECT * FROM report_card_subjects WHERE id = ?').get(subjectId);
  if (!existing) return null;
  
  const now = isoNow();
  db.prepare(`
    UPDATE report_card_subjects 
    SET name = ?, order_index = COALESCE(?, order_index), color = COALESCE(?, color), updated_at = ?
    WHERE id = ? AND league_id = ?
  `).run(
    String(name ?? '').trim(),
    orderIndex !== undefined ? orderIndex : existing.order_index,
    color ?? existing.color,
    now,
    subjectId,
    existing.league_id,
  );
  
  return db.prepare('SELECT * FROM report_card_subjects WHERE id = ?').get(subjectId);
}

export function deleteReportCardSubject(db, subjectId) {
  const subject = db.prepare('SELECT * FROM report_card_subjects WHERE id = ?').get(subjectId);
  if (!subject) return false;
  
  // Check if there are any grades referencing this subject
  const used = db.prepare(`
    SELECT COUNT(*) AS count FROM report_card_grades WHERE subject_name = ?
  `).get(subject.name).count;
  
  if (used > 0) {
    throw new Error('SUBJECT_IN_USE', 'این درس در کارنامه برخی دانش‌آموزان استفاده شده است، ابتدا حذف کنید');
  }
  
  db.prepare('DELETE FROM report_card_subjects WHERE id = ?').run(subjectId);
  return true;
}

/** ===== Report Cards ===== */

export function createReportCard(db, { studentId, semester }) {
  const student = db.prepare('SELECT * FROM students WHERE id = ?').get(studentId);
  if (!student) throw new Error('STUDENT_NOT_FOUND');
  
  const now = isoNow();
  const result = db.prepare(`
    INSERT INTO report_cards (student_id, semester, total_percent, is_published, notes, created_at, updated_at)
    VALUES (?, ?, 0, 0, '', ?, ?)
  `).run(studentId, semester, now, now);
  
  const card = db.prepare('SELECT * FROM report_cards WHERE id = ?').get(result.lastInsertRowid);
  
  // Copy subjects from league as empty entries
  const subjects = db.prepare(`
    SELECT name FROM report_card_subjects WHERE league_id = (
      SELECT league_id FROM students WHERE id = ?
    )
  `).all(studentId);
  
  for (const subj of subjects) {
    db.prepare(`
      INSERT INTO report_card_grades (report_id, subject_name, grade_numeric, teacher_notes)
      VALUES (?, ?, NULL, '')
    `).run(result.lastInsertRowid, subj.name);
  }
  
  return card;
}

export function getReportCardById(db, cardId) {
  const card = db.prepare(`
    SELECT r.*, s.name AS studentName, s.username AS studentUsername, l.name AS leagueName
    FROM report_cards r
    JOIN students s ON s.id = r.student_id
    JOIN leagues l ON l.id = s.league_id
    WHERE r.id = ?
  `).get(cardId);
  
  if (!card) return null;
  
  // Get grades
  const grades = db.prepare(`
    SELECT g.*, s.name as subjectName, s.color as subjectColor, s.order_index
    FROM report_card_grades g
    LEFT JOIN report_card_subjects s ON s.name = g.subject_name AND s.league_id = ?
    WHERE g.report_id = ?
    ORDER BY COALESCE(s.order_index, 999), s.name
  `).all(card.league_id, card.id);
  
  // Get achievements for this student
  const achievements = db.prepare(`
    SELECT * FROM report_achievements
    WHERE student_id = ?
    ORDER BY date_awarded DESC
  `).all(card.student_id);
  
  // Get monthly league points
  const monthlyPoints = db.prepare(`
    SELECT l.id AS leagueId, l.name AS leagueName, COALESCE(SUM(CASE WHEN e.title IN ('قهرمان','نایب قهرمان','رده سوم') THEN e.points ELSE 0 END), 0) AS achievementPoints
    FROM evaluations e
    JOIN leagues l ON l.id = e.league_id AND l.id = ?
    WHERE l.is_monthly = 1 AND e.student_id = ?
  `).get(card.league_id, card.student_id);
  
  return {
    ...card,
    grades,
    achievements,
    monthlyPoints: monthlyPoints ?? { achievementPoints: 0 },
  };
}

export function updateReportCard(db, cardId, { semester, notes, isPublished }) {
  const existing = db.prepare('SELECT * FROM report_cards WHERE id = ?').get(cardId);
  if (!existing) return null;
  
  const now = isoNow();
  const updates = [];
  const values = [];
  
  if (semester !== undefined) {
    updates.push('semester = ?');
    values.push(String(semester ?? '').trim());
  }
  if (notes !== undefined) {
    updates.push('notes = ?');
    values.push(notes ?? '');
  }
  if (isPublished !== undefined) {
    updates.push('is_published = ?');
    values.push(isPublished ? 1 : 0);
  }
  
  if (updates.length === 0) return null;
  
  updates.push('updated_at = ?');
  values.push(now);
  values.push(cardId);
  
  db.prepare(`UPDATE report_cards SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  
  return getReportCardById(db, cardId);
}

/** ===== Grades Management ===== */

export function updateGradeForStudent(db, cardId, subjectName, { numeric, descriptive, notes }) {
  const card = db.prepare('SELECT * FROM report_cards WHERE id = ?').get(cardId);
  if (!card) throw new Error('REPORT_CARD_NOT_FOUND');
  
  // Check if subject exists
  const subjectExists = db.prepare(`
    SELECT 1 FROM report_card_subjects WHERE name = ? AND league_id = ?
  `).get(subjectName, card.league_id);
  
  if (!subjectExists) {
    // Auto-create subject
    db.prepare(`
      INSERT INTO report_card_subjects (league_id, name, order_index, color, created_at)
      VALUES (?, ?, 999, '#10b981', ?)
    `).run(card.league_id, subjectName, isoNow());
  }
  
  // Convert descriptive to numeric if needed
  let numericGrade = numeric;
  if (descriptive && numeric === null) {
    const conv = getDescriptiveGradeFromValue(descriptive);
    if (conv !== null) numericGrade = conv;
  }
  
  // Update or insert grade
  const existing = db.prepare(`
    SELECT id FROM report_card_grades 
    WHERE report_id = ? AND subject_name = ?
  `).get(cardId, subjectName);
  
  if (existing) {
    db.prepare(`
      UPDATE report_card_grades 
      SET grade_numeric = COALESCE(?, grade_numeric),
          grade_descrip = COALESCE(?, grade_descrip),
          teacher_notes = COALESCE(?, teacher_notes)
      WHERE id = ?
    `).run(numericGrade, descriptive, notes, existing.id);
  } else {
    db.prepare(`
      INSERT INTO report_card_grades (report_id, subject_name, grade_numeric, grade_descrip, teacher_notes)
      VALUES (?, ?, ?, ?, ?)
    `).run(cardId, subjectName, numericGrade, descriptive, notes);
  }
  
  return getReportCardById(db, cardId);
}

function getDescriptiveGradeFromValue(value) {
  const grade = DESCRIPTIVE_GRADES.find(g => g.value === value);
  return grade ? grade.minScore + Math.floor(Math.random() * 10) : null;
}

/** ===== Achievements ===== */

export function addAchievement(db, { studentId, title, description, icon, points, category, dateAwarded }) {
  const student = db.prepare('SELECT * FROM students WHERE id = ?').get(studentId);
  if (!student) throw new Error('STUDENT_NOT_FOUND');
  
  const now = isoNow();
  const result = db.prepare(`
    INSERT INTO report_achievements (student_id, title, description, icon, points, category, date_awarded, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    studentId,
    title,
    description ?? '',
    icon ?? '🏆',
    points ?? 0,
    category ?? 'general',
    dateAwarded || now,
    now,
  );
  
  return db.prepare('SELECT * FROM report_achievements WHERE id = ?').get(result.lastInsertRowid);
}

export function removeAchievement(db, achievementId) {
  const achievement = db.prepare('SELECT * FROM report_achievements WHERE id = ?').get(achievementId);
  if (!achievement) return false;
  
  db.prepare('DELETE FROM report_achievements WHERE id = ?').run(achievementId);
  return true;
}

/** ===== Statistics & Lists ===== */

export function listReportCardsForLeague(db, leagueId) {
  return db.prepare(`
    SELECT r.*, s.name AS studentName, l.name AS leagueName
    FROM report_cards r
    JOIN students s ON s.id = r.student_id
    JOIN leagues l ON l.id = s.league_id
    WHERE l.id = ?
    ORDER BY r.updated_at DESC
  `).all(leagueId);
}

export function calculateAverageGrade(db, cardId) {
  const grades = db.prepare(`
    SELECT grade_numeric FROM report_card_grades 
    WHERE report_id = ? AND grade_numeric IS NOT NULL
  `).all(cardId);
  
  if (grades.length === 0) return 0;
  
  const sum = grades.reduce((acc, g) => acc + g.grade_numeric, 0);
  return Number((sum / grades.length).toFixed(2));
}

export function getReportCardStats(db, leagueId) {
  return db.prepare(`
    SELECT 
      COUNT(DISTINCT r.id) AS totalCards,
      AVG(r.total_percent) AS averagePercentage,
      SUM(CASE WHEN r.is_published = 1 THEN 1 ELSE 0 END) AS publishedCount
    FROM report_cards r
    JOIN students s ON s.id = r.student_id
    JOIN leagues l ON l.id = s.league_id
    WHERE l.id = ?
  `).get(leagueId);
}

/** Helper for assistant permissions */
export function canAccessReportCard(db, user, cardId) {
  // For now, allow all authenticated teachers/assistants with evaluations permission
  if (!user?.assistant) return true;
  
  const card = db.prepare(`
    SELECT rc.*, s.league_id, l.teacher_id
    FROM report_cards rc
    JOIN students s ON s.id = rc.student_id
    JOIN leagues l ON l.id = s.league_id
    WHERE rc.id = ?
  `).get(cardId);
  
  if (!card || card.league_id !== user.assistant.leagueId) return false;
  
  return hasAssistantPermission(user, 'evaluations');
}
