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
import { homePath, isAdmin, isStudent, isTeacher, setLeagueId, setMeta, setUser, state, storedLeagueId, subscribe } from './store.js';
import { notify } from './ui.js';

import { renderAttendance } from './views/attendance.js';
import { renderContacts } from './views/contacts.js';
import { renderTeacherDashboard } from './views/dashboard.js';
import { renderEvaluations } from './views/evaluations.js';
import { renderFiles } from './views/files.js';
import { renderFun } from './views/fun.js';
import { renderHomework } from './views/homework.js';
import { renderLeague } from './views/league.js';
import { renderLiveBoard } from './views/liveboard.js';
import { renderLogin } from './views/login.js';
import { renderStudentMessages, renderTeacherMessages } from './views/messages.js';
import { renderQa } from './views/qa.js';
import { renderRaffle } from './views/raffle.js';
import { renderReports } from './views/reports.js';
import { renderSchedule } from './views/schedule.js';
import { renderSeating } from './views/seating.js';
import { renderSettings } from './views/settings.js';
import { renderSubscription } from './views/subscription.js';
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

import { renderAdminDashboard } from './views/admin/dashboard.js';
import { renderAdminPayments } from './views/admin/payments.js';
import { renderAdminPlans } from './views/admin/plans.js';
import { renderAdminSms } from './views/admin/sms.js';
import { renderAdminTeachers } from './views/admin/teachers.js';

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
    ['contacts', '📱', 'شماره‌ها'],
    ['reports', '📨', 'گزارش روزانه'],
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
  items.push({ group: 'ارتباط و اشتراک' });
  items.push({ label: 'پیام‌ها', icon: '💬', href: 'teacher/messages', active: active === 'teacher/messages' });
  items.push({ label: 'اشتراک من', icon: '💳', href: 'teacher/subscription', active: active === 'teacher/subscription' });
  items.push({ group: 'حساب کاربری' });
  items.push({ label: 'تنظیمات', icon: '⚙️', href: 'teacher/settings', active: active === 'teacher/settings' });
  items.push({ label: 'سرگرمی', icon: '🎮', href: 'fun', active: active === 'fun' });
  return items;
}

function adminNav() {
  const active = currentPath();
  const tabs = [
    ['admin', '📊', 'داشبورد'],
    ['admin/teachers', '👩‍🏫', 'معلمان'],
    ['admin/plans', '🛍️', 'طرح‌های اشتراک'],
    ['admin/payments', '🧾', 'پرداخت‌ها'],
    ['admin/sms', '📨', 'پنل پیامک'],
    ['admin/settings', '⚙️', 'تنظیمات'],
  ];
  return [
    { group: 'پنل مدیر' },
    ...tabs.map(([href, icon, label]) => ({ label, icon, href, active: active === href })),
  ];
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
    ['student/messages', '💬', 'پیام‌ها'],
    ['student/settings', '⚙️', 'تنظیمات'],
    ['fun', '🎮', 'سرگرمی'],
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
  if (!isTeacher()) setLeaguePill(null);
  renderDrawerNav(isAdmin() ? adminNav() : isTeacher() ? teacherNav() : studentNav());
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
  { path: 'teacher/messages', guard: () => (isTeacher() ? undefined : 'login'), view: (ctx) => renderTeacherMessages(ctx) },
  { path: 'teacher/subscription', guard: () => (isTeacher() ? undefined : 'login'), view: (ctx) => renderSubscription(ctx) },
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
  { path: 'teacher/league/:id/contacts', guard: () => (isTeacher() ? undefined : 'login'), view: (ctx) => renderContacts(ctx) },
  { path: 'teacher/league/:id/reports', guard: () => (isTeacher() ? undefined : 'login'), view: (ctx) => renderReports(ctx) },
  { path: 'admin', guard: () => (isAdmin() ? undefined : 'login'), view: (ctx) => renderAdminDashboard(ctx) },
  { path: 'admin/teachers', guard: () => (isAdmin() ? undefined : 'login'), view: (ctx) => renderAdminTeachers(ctx) },
  { path: 'admin/plans', guard: () => (isAdmin() ? undefined : 'login'), view: (ctx) => renderAdminPlans(ctx) },
  { path: 'admin/payments', guard: () => (isAdmin() ? undefined : 'login'), view: (ctx) => renderAdminPayments(ctx) },
  { path: 'admin/sms', guard: () => (isAdmin() ? undefined : 'login'), view: (ctx) => renderAdminSms(ctx) },
  { path: 'admin/settings', guard: () => (isAdmin() ? undefined : 'login'), view: (ctx) => renderSettings(ctx) },
  { path: 'fun', guard: () => (state.user ? undefined : 'login'), view: () => renderFun() },
  { path: 'student', guard: () => (isStudent() ? undefined : 'login'), view: (ctx) => renderStudentDashboard(ctx) },
  { path: 'student/report-card', guard: () => (isStudent() ? undefined : 'login'), view: (ctx) => renderReportCard(ctx) },
  { path: 'student/evaluations', guard: () => (isStudent() ? undefined : 'login'), view: (ctx) => renderStudentEvaluations(ctx) },
  { path: 'student/attendance', guard: () => (isStudent() ? undefined : 'login'), view: (ctx) => renderStudentAttendance(ctx) },
  { path: 'student/team', guard: () => (isStudent() ? undefined : 'login'), view: (ctx) => renderStudentTeam(ctx) },
  { path: 'student/history', guard: () => (isStudent() ? undefined : 'login'), view: (ctx) => renderStudentHistory(ctx) },
  { path: 'student/ranking', guard: () => (isStudent() ? undefined : 'login'), view: (ctx) => renderStudentRanking(ctx) },
  { path: 'student/likes', guard: () => (isStudent() ? undefined : 'login'), view: (ctx) => renderStudentLikes(ctx) },
  { path: 'student/messages', guard: () => (isStudent() ? undefined : 'login'), view: (ctx) => renderStudentMessages(ctx) },
  { path: 'student/settings', guard: () => (isStudent() ? undefined : 'login'), view: (ctx) => renderSettings(ctx) },
];

const router = createRouter({
  routes,
  onError(error) {
    if (error?.code === 'SUBSCRIPTION_REQUIRED') {
      notify.warn(errorMessage(error));
      void router.navigate('teacher/subscription', { replace: true });
      return;
    }
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

function paintFooterYear() {
  const node = document.getElementById('footer-year');
  if (!node) return;
  try {
    node.textContent = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { year: 'numeric' }).format(new Date());
  } catch {
    node.textContent = new Date().toLocaleDateString('fa-IR');
  }
}

async function boot() {
  paintFooterYear();
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
