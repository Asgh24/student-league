import { createLeague, getColumns } from '../src/repositories/leagues.js';
import { createUser } from '../src/repositories/users.js';
import { createTeam } from '../src/services/teams.js';

export const TEACHER_A = { username: 'teacher-a', password: 'password-a1', displayName: 'خانم الف' };
export const TEACHER_B = { username: 'teacher-b', password: 'password-b1', displayName: 'آقای ب' };
export const STUDENT_A = { username: 'student-a', password: 'student-a1', displayName: 'آرش آزمون' };
export const STUDENT_B = { username: 'student-b', password: 'student-b1', displayName: 'بهار بنفش' };

/**
 * Builds a deterministic two-teacher fixture:
 * teacher A owns "لیگ الف" with three students (one with a login) and two teams,
 * teacher B owns "لیگ ب" with a single student.
 */
export function buildFixture(db, { studentNames = ['آرش آزمون', 'بهار بنفش', 'پویا پیشرو'] } = {}) {
  const teacherA = createUser(db, { ...TEACHER_A, role: 'teacher' });
  const teacherB = createUser(db, { ...TEACHER_B, role: 'teacher' });
  const studentUserA = createUser(db, { ...STUDENT_A, role: 'student' });
  const studentUserB = createUser(db, { ...STUDENT_B, role: 'student' });

  const leagueA = createLeague(db, teacherA.id, 'لیگ الف');
  const leagueB = createLeague(db, teacherB.id, 'لیگ ب');

  const insertStudent = db.prepare('INSERT INTO students (league_id, user_id, name, created_at) VALUES (?, ?, ?, ?)');
  const now = new Date().toISOString();

  const studentsA = studentNames.map((name, index) => ({
    id: Number(insertStudent.run(leagueA.id, index === 0 ? studentUserA.id : null, name, now).lastInsertRowid),
    name,
  }));
  const studentsB = [
    { id: Number(insertStudent.run(leagueB.id, studentUserB.id, 'سارا تنها', now).lastInsertRowid), name: 'سارا تنها' },
  ];

  const teamsA = [
    createTeam(db, leagueA.id, { name: 'تیم آبی' }),
    createTeam(db, leagueA.id, { name: 'تیم سبز' }),
  ];

  return {
    teacherA,
    teacherB,
    studentUserA,
    studentUserB,
    leagueA,
    leagueB,
    studentsA,
    studentsB,
    teamsA,
    columnsA: getColumns(db, leagueA.id),
    columnsB: getColumns(db, leagueB.id),
  };
}
