import { config } from './config.js';
import { isoNow } from './lib/http.js';
import { createLeague, getColumns } from './repositories/leagues.js';
import { createUser, findByUsername } from './repositories/users.js';
import { applyScoreDelta, studentTotal } from './services/scoring.js';

export const DEMO_LEAGUE_NAME = 'لیگ نمونه';
export const DEMO_STUDENT_USERNAME = 'student1';

const DEMO_STUDENTS = [
  'علی رضایی', 'زهرا محمدی', 'محمد حسینی', 'فاطمه کریمی', 'امیر موسوی', 'نرگس احمدی',
  'رضا صادقی', 'مریم نوری', 'حسین جعفری', 'سارا رحیمی', 'مهدی شریفی', 'الهام قاسمی',
  'سینا اکبری', 'زینب کاظمی', 'پارسا یوسفی', 'نازنین فرهادی', 'آرمان طاهری', 'هدیه سلطانی',
  'یاسین مرادی', 'کوثر عباسی', 'محمدرضا دهقان', 'محدثه زمانی',
];

const TEAM_NAMES = ['تیم آبی', 'تیم بنفش', 'تیم صورتی', 'تیم نارنجی'];

/** Deterministic PRNG so a fresh seed run produces a stable demo dataset. */
function mulberry32(seed) {
  let a = seed;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Idempotent demo data: teacher account, one league, 22 students, four teams,
 * attendance for the last few school days and a populated score history.
 */
export function runSeed(db, { log = () => {} } = {}) {
  const { teacherUser, teacherPass, demoPassword } = config.seed;
  const summary = { teacher: null, league: null, students: 0, teams: 0, historyEntries: 0, attendanceDays: 0 };

  const run = db.transaction(() => {
    let teacher = findByUsername(db, teacherUser);
    if (!teacher) {
      teacher = createUser(db, { username: teacherUser, password: teacherPass, role: 'teacher', displayName: 'معلم نمونه' });
      log(`created teacher "${teacherUser}"`);
    }
    summary.teacher = teacher.username;

    let league = db.prepare('SELECT * FROM leagues WHERE teacher_id = ? AND name = ?').get(teacher.id, DEMO_LEAGUE_NAME);
    if (!league) {
      league = createLeague(db, teacher.id, DEMO_LEAGUE_NAME);
      log(`created league "${DEMO_LEAGUE_NAME}"`);
    }
    summary.league = league.name;

    const columns = getColumns(db, league.id);
    const random = mulberry32(20260810);

    const existing = db.prepare('SELECT name FROM students WHERE league_id = ?').all(league.id).map((row) => row.name);
    const insertStudent = db.prepare('INSERT INTO students (league_id, user_id, name, created_at) VALUES (?, ?, ?, ?)');
    const createdAt = isoNow();

    for (const name of DEMO_STUDENTS) {
      if (existing.includes(name)) continue;
      let userId = null;
      if (name === DEMO_STUDENTS[0]) {
        let user = findByUsername(db, DEMO_STUDENT_USERNAME);
        if (!user) {
          user = createUser(db, { username: DEMO_STUDENT_USERNAME, password: demoPassword, role: 'student', displayName: name });
        }
        userId = user.id;
      }
      const info = insertStudent.run(league.id, userId, name, createdAt);
      summary.students += 1;

      // Seed a plausible score history so the student chart and totals look real.
      const student = db.prepare('SELECT * FROM students WHERE id = ?').get(info.lastInsertRowid);
      for (const column of columns) {
        const rounds = 1 + Math.floor(random() * 3);
        for (let i = 0; i < rounds; i += 1) {
          const multiplier = random();
          if (multiplier < 0.15) continue;
          const delta = Math.round(column.step * (0.5 + random() * 1.5)) * (multiplier < 0.22 ? -1 : 1);
          applyScoreDelta(db, {
            leagueId: league.id,
            student,
            column,
            delta,
            reason: 'امتیاز نمونه',
            actor: teacher,
          });
          summary.historyEntries += 1;
        }
      }
    }

    const teamCount = db.prepare('SELECT COUNT(*) AS n FROM teams WHERE league_id = ?').get(league.id).n;
    if (teamCount === 0) {
      const insertTeam = db.prepare('INSERT INTO teams (league_id, name, points, label, created_at) VALUES (?, ?, ?, ?, ?)');
      const teamIds = TEAM_NAMES.map((name) => Number(insertTeam.run(league.id, name, 0, null, createdAt).lastInsertRowid));
      summary.teams = teamIds.length;

      const studentRows = db.prepare('SELECT id FROM students WHERE league_id = ? ORDER BY id ASC').all(league.id);
      const assign = db.prepare('INSERT INTO team_members (team_id, student_id, created_at) VALUES (?, ?, ?) ON CONFLICT (student_id) DO NOTHING');
      studentRows.slice(0, 16).forEach((student, index) => {
        assign.run(teamIds[index % teamIds.length], student.id, createdAt);
      });
    }

    const attendanceCount = db.prepare('SELECT COUNT(*) AS n FROM attendance WHERE league_id = ?').get(league.id).n;
    if (attendanceCount === 0) {
      const students = db.prepare('SELECT id FROM students WHERE league_id = ? ORDER BY id ASC').all(league.id);
      const upsert = db.prepare(`
        INSERT INTO attendance (league_id, student_id, day, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (student_id, day) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at
      `);
      const days = [];
      for (let back = 1; days.length < 10 && back < 30; back += 1) {
        const date = new Date(Date.now() + config.tzOffsetMinutes * 60 * 1000 - back * 86400 * 1000);
        const weekday = (date.getUTCDay() + 1) % 7; // 0 = Saturday
        if (weekday === 6) continue; // skip Friday
        days.push(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`);
      }
      const now = isoNow();
      for (const day of days) {
        for (const student of students) {
          const roll = random();
          const status = roll < 0.86 ? 'present' : roll < 0.95 ? 'late' : 'absent';
          upsert.run(league.id, student.id, day, status, now, now);
        }
        summary.attendanceDays += 1;
      }
    }

    const total = studentsTotal(db, league.id);
    log(`seed complete: ${summary.students} students, ${summary.historyEntries} history entries`);
    summary.leagueTotalPoints = total;
  });

  run();
  return summary;
}

function studentsTotal(db, leagueId) {
  const rows = db.prepare('SELECT id FROM students WHERE league_id = ?').all(leagueId);
  return rows.reduce((acc, row) => acc + studentTotal(db, row.id), 0);
}
