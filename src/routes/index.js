import { Router } from 'express';
import { createAnswersRouter, createLeagueQuestionsRouter, createLeagueQuizRouter, createQuestionsRouter } from './qa.js';
import { createAdminRouter } from './admin.js';
import { createAiSettingsRouter, createLeagueAiRouter } from './ai.js';
import { createAttendanceRouter } from './attendance.js';
import { createAuthRouter } from './auth.js';
import { createColumnsRouter, createLeagueColumnsRouter } from './columns.js';
import { createLeagueContactsRouter } from './contacts.js';
import { createLeagueEvaluationsRouter } from './evaluations.js';
import { createFilesRouter, createLeagueFilesRouter } from './files.js';
import { createHomeworkRouter, createLeagueHomeworkRouter } from './homework.js';
import { createLeaguesRouter } from './leagues.js';
import { createMessagesRouter } from './messages.js';
import { createMetaRouter } from './meta.js';
import { createLeagueReportsRouter } from './reports.js';
import { createScheduleRouter } from './schedule.js';
import { createLeagueSeatingRouter } from './seating.js';
import { createSmsSettingsRouter } from './sms.js';
import { createScoresRouter } from './scores.js';
import { createStudentPortalRouter } from './student.js';
import { createSubscriptionRouter } from './subscription.js';
import { createLeagueStudentsRouter, createStudentsRouter } from './students.js';
import { createLeagueTeamsRouter, createTeamsRouter } from './teams.js';
import { createToolsRouter } from './tools.js';

/** Mounts every `/api/v1` resource router. */
export function createApiRouter(ctx) {
  const router = Router();

  router.use('/auth', createAuthRouter(ctx));
  router.use('/meta', createMetaRouter(ctx));
  router.use('/admin', createAdminRouter(ctx));
  router.use('/subscription', createSubscriptionRouter(ctx));
  router.use('/messages', createMessagesRouter(ctx));
  router.use('/sms', createSmsSettingsRouter(ctx));
  router.use('/ai', createAiSettingsRouter(ctx));

  // Teacher resources scoped to a league the teacher owns.
  router.use('/leagues/:id/students', createLeagueStudentsRouter(ctx));
  router.use('/leagues/:id/columns', createLeagueColumnsRouter(ctx));
  router.use('/leagues/:id/scores', createScoresRouter(ctx));
  router.use('/leagues/:id/teams', createLeagueTeamsRouter(ctx));
  router.use('/leagues/:id/attendance', createAttendanceRouter(ctx));
  router.use('/leagues/:id/evaluations', createLeagueEvaluationsRouter(ctx));
  router.use('/leagues/:id/homework', createLeagueHomeworkRouter(ctx));
  router.use('/leagues/:id/questions', createLeagueQuestionsRouter(ctx));
  router.use('/leagues/:id/ai', createLeagueAiRouter(ctx));
  router.use('/leagues/:id/quiz-sessions', createLeagueQuizRouter(ctx));
  router.use('/leagues/:id/seating', createLeagueSeatingRouter(ctx));
  router.use('/leagues/:id/contacts', createLeagueContactsRouter(ctx));
  router.use('/leagues/:id/reports', createLeagueReportsRouter(ctx));
  router.use('/leagues/:id/tools', createToolsRouter(ctx));
  router.use('/leagues/:id/schedule', createScheduleRouter(ctx));
  router.use('/leagues/:id/files', createLeagueFilesRouter(ctx));
  router.use('/leagues', createLeaguesRouter(ctx));

  // Teacher resources addressed by their own identifier.
  router.use('/students', createStudentsRouter(ctx));
  router.use('/columns', createColumnsRouter(ctx));
  router.use('/teams', createTeamsRouter(ctx));
  router.use('/homework', createHomeworkRouter(ctx));
  router.use('/questions', createQuestionsRouter(ctx));
  router.use('/answers', createAnswersRouter(ctx));
  router.use('/files', createFilesRouter(ctx));

  // Student portal.
  router.use('/student', createStudentPortalRouter(ctx));

  return router;
}
