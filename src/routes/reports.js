/**
 * Student report card routes.
 * 
 * Features:
 *  - List/configure subjects per league (teacher only)
 *  - CRUD operations for report cards
 *  - Grade management (numeric & descriptive)
 *  - Achievement management
 */

import { Router } from 'express';
import { badRequest, notFound } from '../lib/errors.js';
import { schemas, validate } from '../lib/validate.js';
import { requireTeacher, loadOwnedLeague } from '../middleware/auth.js';
import { requirePermission } from '../middleware/ownership.js';
import {
  listReportCardSubjects,
  createReportCardSubject,
  updateReportCardSubject,
  deleteReportCardSubject,
  createReportCard,
  getReportCardById,
  updateReportCard,
  updateGradeForStudent,
  addAchievement,
  removeAchievement,
  listReportCardsForLeague,
} from '../services/reports.js';

export function createLeagueReportsRouter({ db }) {
  const router = Router();
  router.use(requireTeacher, loadOwnedLeague(db), requirePermission('evaluations'));

  /** ===== Subjects Configuration ===== */

  router.get('/subjects', (req, res) => {
    const subjects = listReportCardSubjects(db, req.league.id);
    res.json({ items: subjects });
  });

  router.post('/subjects', validate({ body: schemas.reportCardSubjectCreate }), (req, res) => {
    const { name, orderIndex, color } = req.body;
    
    // Check if subject already exists
    const existing = db.prepare(`
      SELECT id FROM report_card_subjects WHERE league_id = ? AND name = ?
    `).get(req.league.id, name.trim());
    
    if (existing) {
      throw badRequest('SUBJECT_EXISTS', 'این درس قبلاً تعریف شده است');
    }
    
    const subject = createReportCardSubject(db, {
      leagueId: req.league.id,
      name,
      orderIndex,
      color,
    });
    
    res.status(201).json({ subject });
  });

  router.patch('/subjects/:id', validate({ body: schemas.reportCardSubjectUpdate }), (req, res) => {
    const subjectId = Number.parseInt(req.params.id, 10);
    
    const subject = db.prepare('SELECT * FROM report_card_subjects WHERE id = ?').get(subjectId);
    if (!subject || subject.league_id !== req.league.id) {
      throw notFound('درس یافت نشد');
    }
    
    const updated = updateReportCardSubject(db, subjectId, req.body);
    res.json({ subject: updated });
  });

  router.delete('/subjects/:id', (req, res) => {
    const subjectId = Number.parseInt(req.params.id, 10);
    const success = deleteReportCardSubject(db, subjectId);
    
    if (!success) {
      throw notFound('درس یافت نشد');
    }
    
    res.json({ ok: true });
  });

  /** ===== Report Cards ===== */

  router.get('/cards', (req, res) => {
    const cards = listReportCardsForLeague(db, req.league.id);
    res.json({ items: cards });
  });

  router.post('/cards', validate({ body: schemas.reportCardCreate }), (req, res) => {
    const { studentId, semester } = req.body;
    
    const student = db.prepare('SELECT * FROM students WHERE id = ? AND league_id = ?').get(studentId, req.league.id);
    if (!student) {
      throw badRequest('STUDENT_NOT_FOUND', 'این دانش‌آموز در این لیگ نیست');
    }
    
    // Check if report card already exists for this semester
    const existing = db.prepare(`
      SELECT id FROM report_cards WHERE student_id = ? AND semester = ?
    `).get(studentId, semester);
    
    if (existing) {
      throw badRequest('CARD_EXISTS', 'کارنامه برای این نوبت از قبل وجود دارد');
    }
    
    const card = createReportCard(db, { studentId, semester });
    res.status(201).json({ card });
  });

  router.get('/cards/:id', (req, res) => {
    const cardId = Number.parseInt(req.params.id, 10);
    
    const card = getReportCardById(db, cardId);
    if (!card || card.league_id !== req.league.id) {
      throw notFound('کارنامه یافت نشد');
    }
    
    res.json({ card });
  });

  router.patch('/cards/:id', validate({ body: schemas.reportCardUpdate }), (req, res) => {
    const cardId = Number.parseInt(req.params.id, 10);
    
    const card = getReportCardById(db, cardId);
    if (!card || card.league_id !== req.league.id) {
      throw notFound('کارنامه یافت نشد');
    }
    
    const updated = updateReportCard(db, cardId, req.body);
    res.json({ card: updated });
  });

  /** ===== Grades ===== */

  router.post('/cards/:id/grades', validate({ body: schemas.reportCardGradeUpdate }), (req, res) => {
    const cardId = Number.parseInt(req.params.id, 10);
    const { subjectName, numeric, descriptive, notes } = req.body;
    
    const card = getReportCardById(db, cardId);
    if (!card || card.league_id !== req.league.id) {
      throw notFound('کارنامه یافت نشد');
    }
    
    const updated = updateGradeForStudent(db, cardId, subjectName, { numeric, descriptive, notes });
    res.json({ card: updated });
  });

  /** ===== Achievements ===== */

  router.post('/cards/:studentId/achievements', validate({ body: schemas.reportCardAchievementCreate }), (req, res) => {
    const studentId = Number.parseInt(req.params.studentId, 10);
    const { title, description, icon, points, category, dateAwarded } = req.body;
    
    // Verify student belongs to this league
    const student = db.prepare('SELECT * FROM students WHERE id = ? AND league_id = ?').get(studentId, req.league.id);
    if (!student) {
      throw badRequest('STUDENT_NOT_FOUND', 'این دانش‌آموز در این لیگ نیست');
    }
    
    const achievement = addAchievement(db, {
      studentId,
      title,
      description,
      icon,
      points,
      category,
      dateAwarded,
    });
    
    res.status(201).json({ achievement });
  });

  router.delete('/achievements/:id', (req, res) => {
    const achievementId = Number.parseInt(req.params.id, 10);
    const success = removeAchievement(db, achievementId);
    
    if (!success) {
      throw notFound('دستاورد یافت نشد');
    }
    
    res.json({ ok: true });
  });

  /** ===== Statistics ===== */

  router.get('/stats', (req, res) => {
    const stats = db.prepare(`
      SELECT 
        COUNT(DISTINCT r.id) AS totalCards,
        AVG(CASE WHEN r.total_percent > 0 THEN r.total_percent END) AS averagePercentage
      FROM report_cards r
      JOIN students s ON s.id = r.student_id
      JOIN leagues l ON l.id = s.league_id
      WHERE l.id = ?
    `).get(req.league.id);
    
    res.json({ stats });
  });

  return router;
}
