import * as core from './001_core.js';
import * as tools from './002_tools.js';
import * as evaluations from './003_evaluations.js';
import * as evaluationPoints from './004_evaluation_points.js';
import * as quizSessions from './005_quiz_sessions.js';
import * as seating from './006_seating.js';
import * as contactsReports from './007_contacts_reports.js';
import * as platform from './008_platform.js';
import * as mcqQuestions from './009_mcq_questions.js';
import * as teacherSmsSettings from './010_teacher_sms_settings.js';

/** Ordered list of migrations applied automatically on boot. */
export const migrations = [
  core,
  tools,
  evaluations,
  evaluationPoints,
  quizSessions,
  seating,
  contactsReports,
  platform,
  mcqQuestions,
  teacherSmsSettings,
];
