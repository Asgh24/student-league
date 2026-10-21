/** Application bootstrap: shell wiring, route table and session restoration. */

import { logout as apiLogout, me as apiMe, meta as apiMeta, setCsrfToken } from './api.js';
import { el } from './dom.js';
import { errorMessage } from './format.js';
import { createRouter, currentPath } from './router.js';
import {
  bindShellHandlers,
  closeDrawer,
  renderDrawerFoot,
  renderDrawerNav,
  setDrawerTitle,
  setLeaguePill,
  setUserPill,
  showTopbar,
} from './shell.js';
import { homePath, isStudent, isTeacher, setLeagueId, setMeta, setUser, state, storedLeagueId, subscribe } from './store.js';
import { notify } from './ui.js';

import { renderAttendance } from './views/attendance.js';
import { renderTeacherDashboard } from './views/dashboard.js';
import { renderEvaluations } from './views/evaluations.js';
import { renderFiles } from './views/files.js';
import { renderHomework } from './views/homework.js';
import { renderLeague } from './views/league.js';
import { renderLiveBoard } from './views/liveboard.js';
import { renderLogin } from './views/login.js';
import { renderQa } from './views/qa.js';
import { renderRaffle } from './views/raffle.js';
import { renderSchedule } from './views/schedule.js';
import { renderSeating } from './views/seating.js';
import { renderSettings } from './views/settings.js';
import { renderTeams } from './views/teams.js';
import { renderTimerTools } from './views/timer.js';
import { renderWheel } from './views/wheel.js';

import { renderStudentAttendance } from './views/student/attendance.js';
import { renderStudentDashboard } from './views/student/dashboard.js';
import { renderStudentEvaluations } from './views/student/evaluations.js';
import { renderStudentHistory } from './views/student/history.js';
import { renderStudentLikes } from './views/student/likes.js';
import { renderStudentRanking } from './views/student/ranking.js';
import { renderReportCard } from './views/student/reportcard.js';
import { renderStudentTeam } from './views/student/team.js';

function leagueNavItems() {
  const base = `teacher/league/${state.leagueId}`;
  const active = currentPath();
  const entries = [
    ['', '🏆', 'لیگ انفرادی'],
    ['teams', '🛡️', 'لیگ تیمی'],
    ['attendance', '🗓️', 'حضور و غیاب'],
    ['evaluations', '📝', 'ارزشیابی'],
    ['raffle', '🎲', 'قرعه‌کشی'],
    ['wheel', '🎡', 'گردونه شانس'],
    ['live', '📺', 'تابلوی زنده'],
    ['timer', '⏱️', 'تایمر و ابزار'],
    ['qa', '❓', 'سوال و پاسخ'],
    ['homework', '📚', 'تکالیف'],
    ['schedule', '🗂️', 'برنامه هفتگی'],
    ['files', '📎', 'ارسال فایل'],
    ['seating', '🪑', 'جای‌گیری'],
  ];
  return entries.map(([suffix, icon, label]) => {
    const href = suffix ? `${base}/${suffix}` : base;
    return { label, icon, href, active: active === href };
  });
}

function teacherNav() {
  const active = currentPath();
  const items = [
    { group: 'میزکار' },
    { label: 'میزکار معلم', icon: '🏠', href: 'teacher', active: active === 'teacher' },
  ];
  if (state.leagueId) {
    items.push({ group: 'لیگ فعال' });
    items.push(...leagueNavItems());
  }
  items.push({ group: 'حساب کاربری' });
  items.push({ label: 'تنظیمات', icon: '⚙️', href: 'teacher/settings', active: active === 'teacher/settings' });
  return items;
}

function studentNav() {
  const active = currentPath();
  const tabs = [
    ['student', '🏠', 'میزکار'],
    ['student/report-card', '📄', 'کارنامه'],
    ['student/evaluations', '📝', 'ارزشیابی'],
    ['student/attendance', '🗓️', 'حضور و غیاب'],
    ['student/team', '🛡️', 'تیم من'],
    ['student/history', '📜', 'تاریخچه'],
    ['student/ranking', '🏅', 'رده‌بندی'],
    ['student/likes', '💜', 'لایک'],
    ['student/settings', '⚙️', 'تنظیمات'],
  ];
  return tabs.map(([href, icon, label]) => ({ label, icon, href, active: active === href }));
}

function logoutButton() {
  return el('button.btn.btn--ghost.btn--block', {
    type: 'button',
    onclick: () => {
      void doLogout();
    },
  }, [el('span', { text: '🚪', 'aria-hidden': 'true' }), el('span', { text: 'خروج از حساب' })]);
}

async function doLogout() {
  try {
    await apiLogout();
  } catch {
    /* the session is cleared locally even if the server call fails */
  }
  setCsrfToken(null);
  setUser(null);
  setLeagueId(null);
  closeDrawer();
  window.location.hash = '#/login';
  notify.info('از حساب خود خارج شدید');
}

function renderShell() {
  const loggedIn = Boolean(state.user);
  showTopbar(loggedIn);
  setUserPill();
  setDrawerTitle(state.meta.appName);
  if (!loggedIn) {
    setLeaguePill(null);
    renderDrawerNav([]);
    renderDrawerFoot([]);
    closeDrawer();
    return;
  }
  renderDrawerNav(isTeacher() ? teacherNav() : studentNav());
  renderDrawerFoot(logoutButton());
}

const routes = [
  {
    path: 'login',
    view: (ctx) => (state.user ? homePath() : renderLogin(ctx)),
  },
  {
    path: '',
    view: () => homePath(),
  },
  { path: 'teacher', guard: () => (isTeacher() ? undefined : 'login'), view: (ctx) => renderTeacherDashboard(ctx) },
  { path: 'teacher/settings', guard: () => (isTeacher() ? undefined : 'login'), view: (ctx) => renderSettings(ctx) },
  { path: 'teacher/league/:id', guard: () => (isTeacher() ? undefined : 'login'), view: (ctx) => renderLeague(ctx) },
  { path: 'teacher/league/:id/teams', guard: () => (isTeacher() ? undefined : 'login'), view: (ctx) => renderTeams(ctx) },
  { path: 'teacher/league/:id/attendance', guard: () => (isTeacher() ? undefined : 'login'), view: (ctx) => renderAttendance(ctx) },
  { path: 'teacher/league/:id/evaluations', guard: () => (isTeacher() ? undefined : 'login'), view: (ctx) => renderEvaluations(ctx) },
  { path: 'teacher/league/:id/raffle', guard: () => (isTeacher() ? undefined : 'login'), view: (ctx) => renderRaffle(ctx) },
  { path: 'teacher/league/:id/wheel', guard: () => (isTeacher() ? undefined : 'login'), view: (ctx) => renderWheel(ctx) },
  { path: 'teacher/league/:id/live', guard: () => (isTeacher() ? undefined : 'login'), view: (ctx) => renderLiveBoard(ctx) },
  { path: 'teacher/league/:id/timer', guard: () => (isTeacher() ? undefined : 'login'), view: (ctx) => renderTimerTools(ctx) },
  { path: 'teacher/league/:id/homework', guard: () => (isTeacher() ? undefined : 'login'), view: (ctx) => renderHomework(ctx) },
  { path: 'teacher/league/:id/qa', guard: () => (isTeacher() ? undefined : 'login'), view: (ctx) => renderQa(ctx) },
  { path: 'teacher/league/:id/schedule', guard: () => (isTeacher() ? undefined : 'login'), view: (ctx) => renderSchedule(ctx) },
  { path: 'teacher/league/:id/files', guard: () => (isTeacher() ? undefined : 'login'), view: (ctx) => renderFiles(ctx) },
  { path: 'teacher/league/:id/seating', guard: () => (isTeacher() ? undefined : 'login'), view: (ctx) => renderSeating(ctx) },
  { path: 'student', guard: () => (isStudent() ? undefined : 'login'), view: (ctx) => renderStudentDashboard(ctx) },
  { path: 'student/report-card', guard: () => (isStudent() ? undefined : 'login'), view: (ctx) => renderReportCard(ctx) },
  { path: 'student/evaluations', guard: () => (isStudent() ? undefined : 'login'), view: (ctx) => renderStudentEvaluations(ctx) },
  { path: 'student/attendance', guard: () => (isStudent() ? undefined : 'login'), view: (ctx) => renderStudentAttendance(ctx) },
  { path: 'student/team', guard: () => (isStudent() ? undefined : 'login'), view: (ctx) => renderStudentTeam(ctx) },
  { path: 'student/history', guard: () => (isStudent() ? undefined : 'login'), view: (ctx) => renderStudentHistory(ctx) },
  { path: 'student/ranking', guard: () => (isStudent() ? undefined : 'login'), view: (ctx) => renderStudentRanking(ctx) },
  { path: 'student/likes', guard: () => (isStudent() ? undefined : 'login'), view: (ctx) => renderStudentLikes(ctx) },
  { path: 'student/settings', guard: () => (isStudent() ? undefined : 'login'), view: (ctx) => renderSettings(ctx) },
];

const router = createRouter({
  routes,
  onError(error) {
    notify.error(errorMessage(error));
  },
  fallback() {
    void router.navigate(homePath(), { replace: true });
  },
});

subscribe(renderShell);
bindShellHandlers({
  onLeaguePill: () => {
    void router.navigate('teacher');
  },
});

async function boot() {
  try {
    const metaPayload = await apiMeta();
    setMeta(metaPayload ?? {});
  } catch {
    setMeta({ appName: 'لیگ جامع دانش‌آموزی' });
  }

  try {
    const session = await apiMe();
    if (session?.csrfToken) setCsrfToken(session.csrfToken);
    setUser(session?.user ?? null);
  } catch {
    setUser(null);
  }

  if (state.user && !state.user.persianDigits) state.persianDigits = false;
  if (state.leagueId === null) setLeagueId(storedLeagueId());

  renderShell();
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    if (reason && reason.name === 'ApiError' && reason.status !== 0) return;
    notify.error(errorMessage(reason));
  });

  const started = router.start();
  if (started && typeof started.catch === 'function') {
    started.catch((error) => notify.error(errorMessage(error)));
  }
  return null;
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      void boot();
    });
  } else {
    void boot();
  }
}
