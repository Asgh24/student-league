/**
 * «کارنامه دانش‌آموز» — manual report cards.
 *
 * A teacher defines the subjects once per league, then fills one card per
 * student/semester with numeric (0-100) or descriptive marks. The detail payload
 * also carries the student's evaluation achievements, league points, rank,
 * attendance and score columns so the teacher does not need to jump between
 * sections.
 */

import { badRequest, conflict, notFound } from '../lib/errors.js';
import { isoNow } from '../lib/http.js';
import { getColumns } from '../repositories/leagues.js';
import { descriptiveLevel, numericBand } from './evaluations.js';
import { championshipsFor, columnValues, rankingForLeague, titleForPoints } from './scoring.js';

/** Persian descriptive grading scale for manual report cards. */
export const REPORT_CARD_LEVELS = [
  { value: 'very_good', label: 'خیلی خوب', icon: '🌟', percent: 95 },
  { value: 'good', label: 'خوب', icon: '👍', percent: 80 },
  { value: 'acceptable', label: 'قابل قبول', icon: '🙂', percent: 65 },
  { value: 'needs_improvement', label: 'نیاز به تلاش بیشتر', icon: '🎯', percent: 40 },
];

const LEVEL_VALUES = new Set(REPORT_CARD_LEVELS.map((level) => level.value));

function levelFor(value) {
  return REPORT_CARD_LEVELS.find((level) => level.value === value) ?? null;
}

function levelPercent(value) {
  return levelFor(value)?.percent ?? null;
}

/** Overall descriptive result derived from the numeric percentage. */
export function overallLevel(percent) {
  const value = Number(percent) || 0;
  if (value >= 90) return levelFor('very_good');
  if (value >= 75) return levelFor('good');
  if (value >= 60) return levelFor('acceptable');
  return levelFor('needs_improvement');
}

function requireStudentInLeague(db, leagueId, studentId) {
  const student = db.prepare('SELECT id, name, league_id AS leagueId FROM students WHERE id = ? AND league_id = ?')
    .get(studentId, leagueId);
  if (!student) throw notFound('دانش‌آموز در این لیگ یافت نشد');
  return student;
}

function requireLeagueCard(db, leagueId, cardId) {
  const card = db.prepare(`
    SELECT r.*, s.name AS studentName, s.league_id AS leagueId, l.name AS leagueName
    FROM report_cards r
    JOIN students s ON s.id = r.student_id
    JOIN leagues l ON l.id = s.league_id
    WHERE r.id = ? AND s.league_id = ?
  `).get(cardId, leagueId);
  if (!card) throw notFound('کارنامه یافت نشد');
  return card;
}

function publicSubject(row) {
  return {
    id: row.id,
    leagueId: row.league_id,
    name: row.name,
    orderIndex: row.order_index,
    color: row.color,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** ===== Subjects ===== */

export function listReportCardSubjects(db, leagueId) {
  return db.prepare(`
    SELECT * FROM report_card_subjects
    WHERE league_id = ?
    ORDER BY order_index ASC, name ASC
  `).all(leagueId).map(publicSubject);
}

export function createReportCardSubject(db, { leagueId, name, orderIndex, color }) {
  const clean = String(name ?? '').trim();
  if (!clean) throw badRequest('SUBJECT_NAME_REQUIRED', 'نام درس الزامی است');
  const duplicate = db.prepare('SELECT id FROM report_card_subjects WHERE league_id = ? AND name = ?')
    .get(leagueId, clean);
  if (duplicate) throw conflict('SUBJECT_EXISTS', 'این درس قبلاً برای این کلاس تعریف شده است');

  const nextOrder = db.prepare('SELECT COALESCE(MAX(order_index), 0) + 1 AS next FROM report_card_subjects WHERE league_id = ?')
    .get(leagueId).next;
  const now = isoNow();
  const info = db.prepare(`
    INSERT INTO report_card_subjects (league_id, name, order_index, color, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(leagueId, clean, orderIndex ?? nextOrder, color ?? '#6366f1', now, now);
  return publicSubject(db.prepare('SELECT * FROM report_card_subjects WHERE id = ?').get(info.lastInsertRowid));
}

export function updateReportCardSubject(db, leagueId, subjectId, { name, orderIndex, color } = {}) {
  const subject = db.prepare('SELECT * FROM report_card_subjects WHERE id = ? AND league_id = ?').get(subjectId, leagueId);
  if (!subject) throw notFound('درس یافت نشد');

  const clean = name === undefined ? subject.name : String(name).trim();
  if (!clean) throw badRequest('SUBJECT_NAME_REQUIRED', 'نام درس الزامی است');
  if (clean !== subject.name) {
    const duplicate = db.prepare('SELECT id FROM report_card_subjects WHERE league_id = ? AND name = ? AND id <> ?')
      .get(leagueId, clean, subjectId);
    if (duplicate) throw conflict('SUBJECT_EXISTS', 'درسی با این نام از قبل وجود دارد');
  }

  const run = db.transaction(() => {
    db.prepare(`
      UPDATE report_card_subjects
      SET name = ?, order_index = ?, color = ?, updated_at = ?
      WHERE id = ? AND league_id = ?
    `).run(
      clean,
      orderIndex === undefined ? subject.order_index : orderIndex,
      color ?? subject.color,
      isoNow(),
      subjectId,
      leagueId,
    );
    if (clean !== subject.name) {
      db.prepare('UPDATE report_card_grades SET subject_name = ? WHERE subject_id = ?').run(clean, subjectId);
    }
  });
  run();
  return publicSubject(db.prepare('SELECT * FROM report_card_subjects WHERE id = ?').get(subjectId));
}

export function deleteReportCardSubject(db, leagueId, subjectId) {
  const subject = db.prepare('SELECT * FROM report_card_subjects WHERE id = ? AND league_id = ?').get(subjectId, leagueId);
  if (!subject) throw notFound('درس یافت نشد');

  const used = db.prepare(`
    SELECT COUNT(*) AS n
    FROM report_card_grades g
    JOIN report_cards r ON r.id = g.report_id
    JOIN students s ON s.id = r.student_id
    WHERE s.league_id = ? AND (g.subject_id = ? OR (g.subject_id IS NULL AND g.subject_name = ?))
  `).get(leagueId, subjectId, subject.name).n;
  if (used > 0) {
    throw badRequest('SUBJECT_IN_USE', 'این درس در کارنامه دانش‌آموزان استفاده شده است؛ ابتدا نمره‌های آن را پاک کنید');
  }

  db.prepare('DELETE FROM report_card_subjects WHERE id = ?').run(subjectId);
  return { ok: true };
}

/** ===== Report cards ===== */

function gradesForCard(db, cardId) {
  return db.prepare(`
    SELECT g.id,
           g.subject_id AS subjectId,
           COALESCE(sub.name, g.subject_name) AS subjectName,
           COALESCE(sub.color, '#6366f1') AS color,
           COALESCE(sub.order_index, 999) AS orderIndex,
           g.grade_numeric AS numeric,
           g.grade_descrip AS descriptive,
           g.teacher_notes AS notes
    FROM report_card_grades g
    LEFT JOIN report_card_subjects sub ON sub.id = g.subject_id
    WHERE g.report_id = ?
    ORDER BY COALESCE(sub.order_index, 999), COALESCE(sub.name, g.subject_name)
  `).all(cardId).map((row) => ({
    ...row,
    level: row.descriptive ? levelFor(row.descriptive) : null,
  }));
}

function listCardRows(db, leagueId, { publishedOnly = false } = {}) {
  const extra = publishedOnly ? 'AND r.is_published = 1' : '';
  return db.prepare(`
    SELECT r.id, r.student_id AS studentId, s.name AS studentName,
           r.semester, r.total_percent AS totalPercent, r.is_published AS isPublished,
           r.notes, r.created_at AS createdAt, r.updated_at AS updatedAt,
           (SELECT COUNT(*) FROM report_card_grades g
             WHERE g.report_id = r.id AND (g.grade_numeric IS NOT NULL OR g.grade_descrip IS NOT NULL)) AS gradedCount
    FROM report_cards r
    JOIN students s ON s.id = r.student_id
    WHERE s.league_id = ? ${extra}
    ORDER BY r.updated_at DESC, r.id DESC
  `).all(leagueId).map((row) => ({
    ...row,
    isPublished: row.isPublished === 1,
    level: row.gradedCount > 0 ? overallLevel(row.totalPercent) : null,
  }));
}

export function listReportCardsForLeague(db, leagueId) {
  return listCardRows(db, leagueId);
}

export function listReportCardsForStudent(db, leagueId, studentId) {
  return listCardRows(db, leagueId).filter((card) => card.studentId === studentId);
}

export function listPublishedReportCards(db, leagueId, studentId) {
  return listCardRows(db, leagueId, { publishedOnly: true })
    .filter((card) => card.studentId === studentId)
    .map((card) => ({ ...card, grades: gradesForCard(db, card.id) }));
}

export function findReportCardForStudent(db, leagueId, studentId, semester = null) {
  const row = db.prepare(`
    SELECT r.id FROM report_cards r
    JOIN students s ON s.id = r.student_id
    WHERE s.league_id = ? AND r.student_id = ? ${semester ? 'AND r.semester = ?' : ''}
    ORDER BY r.updated_at DESC, r.id DESC LIMIT 1
  `).get(...(semester ? [leagueId, studentId, semester] : [leagueId, studentId]));
  return row ? getReportCardDetail(db, leagueId, row.id) : null;
}

export function createReportCard(db, leagueId, { studentId, semester }) {
  const student = requireStudentInLeague(db, leagueId, studentId);
  const clean = String(semester ?? '').trim();
  if (!clean) throw badRequest('SEMESTER_REQUIRED', 'نام نوبت الزامی است');

  const duplicate = db.prepare('SELECT id FROM report_cards WHERE student_id = ? AND semester = ?').get(studentId, clean);
  if (duplicate) throw conflict('CARD_EXISTS', 'برای این دانش‌آموز در این نوبت کارنامه وجود دارد');

  const subjects = listReportCardSubjects(db, leagueId);
  if (subjects.length === 0) {
    throw badRequest('NO_SUBJECTS', 'ابتدا درس‌های کارنامه را برای این کلاس تعریف کنید');
  }

  const run = db.transaction(() => {
    const now = isoNow();
    const info = db.prepare(`
      INSERT INTO report_cards (student_id, semester, total_percent, is_published, notes, created_at, updated_at)
      VALUES (?, ?, 0, 0, '', ?, ?)
    `).run(studentId, clean, now, now);
    const cardId = Number(info.lastInsertRowid);
    const insert = db.prepare(`
      INSERT INTO report_card_grades (report_id, subject_id, subject_name, grade_numeric, grade_descrip, teacher_notes)
      VALUES (?, ?, ?, NULL, NULL, '')
    `);
    for (const subject of subjects) insert.run(cardId, subject.id, subject.name);
    return cardId;
  });
  const cardId = run();
  return { card: getReportCardDetail(db, leagueId, cardId), student };
}

export function saveReportCard(db, leagueId, cardId, payload = {}) {
  const card = requireLeagueCard(db, leagueId, cardId);
  const { semester, notes, isPublished, grades } = payload;

  const run = db.transaction(() => {
    const now = isoNow();
    if (semester !== undefined) {
      const clean = String(semester ?? '').trim();
      if (!clean) throw badRequest('SEMESTER_REQUIRED', 'نام نوبت الزامی است');
      db.prepare('UPDATE report_cards SET semester = ? WHERE id = ?').run(clean, cardId);
    }
    if (notes !== undefined) {
      db.prepare('UPDATE report_cards SET notes = ? WHERE id = ?').run(String(notes ?? '').trim(), cardId);
    }
    if (isPublished !== undefined) {
      db.prepare('UPDATE report_cards SET is_published = ? WHERE id = ?').run(isPublished ? 1 : 0, cardId);
    }

    if (Array.isArray(grades)) {
      const subjects = new Map(listReportCardSubjects(db, leagueId).map((subject) => [subject.id, subject]));
      const existing = new Map(gradesForCard(db, cardId).map((grade) => [grade.subjectId, grade]));
      const update = db.prepare(`
        UPDATE report_card_grades
        SET subject_name = ?, grade_numeric = ?, grade_descrip = ?, teacher_notes = ?
        WHERE id = ?
      `);
      const insert = db.prepare(`
        INSERT INTO report_card_grades (report_id, subject_id, subject_name, grade_numeric, grade_descrip, teacher_notes)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      for (const item of grades) {
        const subjectId = Number(item?.subjectId);
        const subject = subjects.get(subjectId);
        if (!subject) throw badRequest('SUBJECT_NOT_FOUND', 'درس انتخاب‌شده برای این کلاس تعریف نشده است');

        const numeric = item?.numeric === null || item?.numeric === undefined || item?.numeric === ''
          ? null
          : Number(item.numeric);
        if (numeric !== null && (!Number.isFinite(numeric) || numeric < 0 || numeric > 100)) {
          throw badRequest('GRADE_OUT_OF_RANGE', 'نمره کمی باید بین ۰ تا ۱۰۰ باشد');
        }
        const descriptive = item?.descriptive ? String(item.descriptive) : null;
        if (descriptive !== null && !LEVEL_VALUES.has(descriptive)) {
          throw badRequest('GRADE_LEVEL_INVALID', 'سطح توصیفی انتخاب‌شده معتبر نیست');
        }

        const previous = existing.get(subjectId);
        if (previous) {
          update.run(subject.name, numeric, descriptive, String(item?.notes ?? '').trim(), previous.id);
        } else {
          insert.run(cardId, subject.id, subject.name, numeric, descriptive, String(item?.notes ?? '').trim());
        }
      }
    }

    const rows = db.prepare('SELECT grade_numeric AS numeric, grade_descrip AS descriptive FROM report_card_grades WHERE report_id = ?')
      .all(cardId);
    const percents = rows
      .map((row) => (row.numeric !== null && row.numeric !== undefined ? Number(row.numeric) : levelPercent(row.descriptive)))
      .filter((value) => Number.isFinite(value));
    const totalPercent = percents.length
      ? Number((percents.reduce((sum, value) => sum + value, 0) / percents.length).toFixed(2))
      : 0;
    db.prepare('UPDATE report_cards SET total_percent = ?, updated_at = ? WHERE id = ?').run(totalPercent, now, cardId);
  });
  run();

  void card;
  return getReportCardDetail(db, leagueId, cardId);
}

export function getReportCardDetail(db, leagueId, cardId) {
  const card = requireLeagueCard(db, leagueId, cardId);
  const grades = gradesForCard(db, cardId);
  const hasGrade = grades.some((grade) => grade.numeric !== null || grade.descriptive !== null);
  return {
    id: card.id,
    studentId: card.student_id,
    studentName: card.studentName,
    leagueId: card.leagueId,
    leagueName: card.leagueName,
    semester: card.semester,
    totalPercent: card.total_percent,
    level: hasGrade ? overallLevel(card.total_percent) : null,
    isPublished: card.is_published === 1,
    notes: card.notes ?? '',
    createdAt: card.created_at,
    updatedAt: card.updated_at,
    grades,
    performance: buildPerformance(db, leagueId, card.student_id),
  };
}

export function deleteReportCard(db, leagueId, cardId) {
  requireLeagueCard(db, leagueId, cardId);
  db.prepare('DELETE FROM report_cards WHERE id = ?').run(cardId);
  return { ok: true };
}

/** Published card for a student. Drafts stay invisible to the student. */
export function getPublishedReportCard(db, leagueId, studentId, cardId) {
  const card = requireLeagueCard(db, leagueId, cardId);
  if (card.student_id !== studentId) throw notFound('کارنامه یافت نشد');
  if (card.is_published !== 1) throw notFound('این کارنامه هنوز منتشر نشده است');
  return getReportCardDetail(db, leagueId, cardId);
}

/** ===== Performance panel ===== */

function buildPerformance(db, leagueId, studentId) {
  const ranking = rankingForLeague(db, leagueId);
  const index = ranking.findIndex((row) => row.studentId === studentId);
  const row = index === -1 ? { total: 0, rank: null } : ranking[index];
  const title = titleForPoints(row.total);

  const attendance = db.prepare(`
    SELECT COUNT(*) AS recorded,
           SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END) AS present,
           SUM(CASE WHEN status = 'late' THEN 1 ELSE 0 END) AS late,
           SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END) AS absent
    FROM attendance WHERE student_id = ?
  `).get(studentId);

  const evaluationRows = db.prepare(`
    SELECT e.id, e.subject, e.title, e.kind, e.held_on AS heldOn, e.scale_max AS scaleMax,
           e.column_id AS columnId,
           es.score, COALESCE(es.label, '') AS label, COALESCE(es.note, '') AS note,
           COALESCE(es.awarded_points, 0) AS awardedPoints,
           (SELECT AVG(x.score) FROM evaluation_scores x
             WHERE x.evaluation_id = e.id AND x.score IS NOT NULL) AS average,
           (SELECT COUNT(*) FROM evaluation_scores x
             WHERE x.evaluation_id = e.id AND x.score IS NOT NULL AND x.score > es.score) AS aboveMe
    FROM evaluation_scores es
    JOIN evaluations e ON e.id = es.evaluation_id
    WHERE e.league_id = ? AND es.student_id = ?
      AND (es.score IS NOT NULL OR es.label <> '')
    ORDER BY e.held_on DESC, e.id DESC
    LIMIT 20
  `).all(leagueId, studentId);

  const evaluations = evaluationRows.map((item) => {
    const band = item.kind === 'descriptive'
      ? (item.label ? descriptiveLevel(item.label) : null)
      : numericBand(item.score, item.scaleMax);
    return {
      id: item.id,
      subject: item.subject,
      title: item.title,
      kind: item.kind,
      heldOn: item.heldOn,
      score: item.score,
      label: item.label,
      note: item.note,
      band: band ? { key: band.key, label: band.label, icon: band.icon } : null,
      average: item.average === null ? null : Number(Number(item.average).toFixed(2)),
      rank: item.score === null || item.score === undefined ? null : (item.aboveMe ?? 0) + 1,
      awardedPoints: item.awardedPoints ?? 0,
    };
  });

  const manualAchievements = db.prepare(`
    SELECT id, title, description, icon, points, category, date_awarded AS dateAwarded
    FROM report_achievements WHERE student_id = ? ORDER BY date_awarded DESC, id DESC LIMIT 20
  `).all(studentId);

  const values = new Map(columnValues(db, studentId).map((item) => [item.columnId, item.value]));
  const columns = getColumns(db, leagueId).map((column) => ({
    id: column.id,
    name: column.name,
    step: column.step,
    value: values.get(column.id) ?? 0,
  }));

  return {
    league: {
      points: row.total,
      rank: row.rank,
      totalStudents: ranking.length,
      title: title.title,
      titleIcon: title.icon,
    },
    attendance: {
      recorded: attendance.recorded ?? 0,
      present: attendance.present ?? 0,
      late: attendance.late ?? 0,
      absent: attendance.absent ?? 0,
      attended: (attendance.present ?? 0) + (attendance.late ?? 0),
    },
    evaluations,
    evaluationPoints: evaluations.reduce((sum, item) => sum + (Number(item.awardedPoints) || 0), 0),
    championships: championshipsFor(db, studentId, 20),
    manualAchievements,
    columns,
  };
}
