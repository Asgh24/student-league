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
import * as teacherGroqSettings from './011_teacher_groq_settings.js';
import * as cardToCardPayments from './012_card_to_card_payments.js';
import * as classRepresentative from './013_class_representative.js';
import * as assistants from './014_assistants.js';
import * as studentReports from './015_student_reports.js';
import * as fixReportCardGradesFk from './016_fix_report_card_grades_fk.js';
import * as reportCardSubjectLinks from './017_report_card_subject_links.js';
import * as reportCardGradeNullable from './018_report_card_grade_nullable.js';
import * as reportChannelsShad from './019_report_channels_shad.js';
import * as homeworkPoints from './020_homework_points.js';
import * as supportMessages from './021_support_messages.js';
import * as supportGuestMessages from './022_support_guest_messages.js';
import * as planOriginalPrice from './023_plan_original_price.js';

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
  teacherGroqSettings,
  cardToCardPayments,
  classRepresentative,
  assistants,
  studentReports,
  fixReportCardGradesFk,
  reportCardSubjectLinks,
  reportCardGradeNullable,
  reportChannelsShad,
  homeworkPoints,
  supportMessages,
  supportGuestMessages,
  planOriginalPrice,
];
