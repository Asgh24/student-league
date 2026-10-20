// @vitest-environment jsdom
/**
 * Frontend tests: RTL shell, Jalali parity with the server, XSS-safe rendering,
 * chart configuration and view smoke tests for the teacher/student flows.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as serverJalali from '../src/lib/jalali.js';
import * as clientEvalMeta from '../public/js/evaluationMeta.js';
import * as serverEval from '../src/services/evaluations.js';
import * as browserJalali from '../public/js/jalali.js';
import { jalaliDateInput } from '../public/js/jalaliDate.js';
import { number as formatNumber, rating } from '../public/js/format.js';
import { matches, normalizeFa } from '../public/js/normalize.js';
import { buildPointsChartConfig } from '../public/js/charts.js';
import { buildPath, matchPattern } from '../public/js/router.js';
import { el, mount } from '../public/js/dom.js';
import { state, setPersianDigits, setUser } from '../public/js/store.js';

vi.mock('../public/js/api.js', () => {
  const api = {
    request: vi.fn(),
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    del: vi.fn(),
    upload: vi.fn(),
  };
  return {
    api,
    ApiError: class ApiError extends Error {},
    setCsrfToken: vi.fn(),
    getCsrfToken: () => null,
    meta: vi.fn(),
    me: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
  };
});

const { api } = await import('../public/js/api.js');
const { renderTeacherDashboard } = await import('../public/js/views/dashboard.js');
const { createScoresTable } = await import('../public/js/views/scoresTable.js');
const { renderTeams } = await import('../public/js/views/teams.js');
const { renderStudentDashboard } = await import('../public/js/views/student/dashboard.js');
const { renderReportCard } = await import('../public/js/views/student/reportcard.js');
const { renderEvaluations } = await import('../public/js/views/evaluations.js');
const { renderStudentEvaluations } = await import('../public/js/views/student/evaluations.js');

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shellHtml = fs.readFileSync(path.join(rootDir, 'public', 'index.html'), 'utf8');

function installShellSkeleton() {
  document.body.innerHTML = `
    <header class="topbar" id="topbar" hidden>
      <button class="icon-btn" id="menu-btn" type="button"></button>
      <span class="topbar__title" id="topbar-title"></span>
      <span class="spacer"></span>
      <button class="pill" id="league-pill" hidden></button>
      <span class="pill pill--user" id="user-pill" hidden></span>
    </header>
    <div class="scrim" id="scrim" hidden></div>
    <aside class="drawer" id="drawer">
      <div class="drawer__head"><strong id="drawer-title"></strong><button id="drawer-close"></button></div>
      <nav class="drawer__nav" id="drawer-nav"></nav>
      <div class="drawer__foot" id="drawer-foot"></div>
    </aside>
    <main class="view" id="view" tabindex="-1"></main>
    <div class="toasts" id="toasts"></div>
    <div id="modal-root"></div>
  `;
}

beforeEach(() => {
  vi.clearAllMocks();
  installShellSkeleton();
  window.location.hash = '';
  setUser(null);
  setPersianDigits(true);
  state.leagueId = null;
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('shell markup', () => {
  it('declares a Persian RTL document', () => {
    const dom = new JSDOM(shellHtml);
    const html = dom.window.document.documentElement;
    expect(html.getAttribute('lang')).toBe('fa');
    expect(html.getAttribute('dir')).toBe('rtl');
  });

  it('loads only same-origin assets (no CDN references)', () => {
    const dom = new JSDOM(shellHtml);
    const sources = [...dom.window.document.querySelectorAll('script[src], link[href]')]
      .map((node) => node.getAttribute('src') ?? node.getAttribute('href'))
      .filter((value) => value && !value.startsWith('data:'));
    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) {
      expect(source.startsWith('/')).toBe(true);
    }
  });
});

describe('Jalali parity between client and server', () => {
  it('converts the same Gregorian dates identically', () => {
    const start = Date.UTC(2019, 0, 1);
    for (let index = 0; index < 900; index += 1) {
      const date = new Date(start + index * 86400000 * 3);
      const gy = date.getUTCFullYear();
      const gm = date.getUTCMonth() + 1;
      const gd = date.getUTCDate();
      expect(browserJalali.toJalali(gy, gm, gd)).toEqual(serverJalali.toJalali(gy, gm, gd));
      const j = serverJalali.toJalali(gy, gm, gd);
      expect(browserJalali.toGregorian(j.jy, j.jm, j.jd)).toEqual(serverJalali.toGregorian(j.jy, j.jm, j.jd));
    }
  });

  it('agrees on leap years and month lengths', () => {
    for (let year = 1390; year <= 1450; year += 1) {
      expect(browserJalali.isJalaliLeap(year)).toBe(serverJalali.isJalaliLeap(year));
      for (let month = 1; month <= 12; month += 1) {
        expect(browserJalali.jalaliMonthLength(year, month)).toBe(serverJalali.jalaliMonthLength(year, month));
      }
    }
  });

  it('formats the known reference dates', () => {
    expect(browserJalali.formatJalaliDate('2026-08-01')).toBe('۱۴۰۵/۰۵/۱۰');
    expect(browserJalali.formatJalaliDate('2026-03-21')).toBe('۱۴۰۵/۰۱/۰۱');
    expect(browserJalali.formatJalaliDate('2026-08-01', { persianDigits: false })).toBe('1405/05/10');
    expect(browserJalali.jalaliWeekdayName('2026-08-01')).toBe('شنبه');
  });
});

describe('Jalali date field', () => {
  it('shows the Shamsi date and exposes the ISO value the API expects', () => {
    const field = jalaliDateInput({ id: 'held-on', value: '2026-10-20' });
    const selects = [...field.querySelectorAll('select')];

    expect(field.id).toBe('held-on');
    expect(field.className).toContain('jalali-date');
    expect(selects).toHaveLength(3);
    expect(selects.map((select) => select.value)).toEqual(['1405', '7', '28']);
    expect(field.querySelector('.jalali-date__month').selectedOptions[0].textContent).toBe('مهر');
    expect(field.value).toBe('2026-10-20');
  });

  it('defaults required dates to today and lets optional filters stay empty', () => {
    expect(jalaliDateInput({ value: '' }).value).toBe(browserJalali.todayIso(210));

    const filter = jalaliDateInput({ value: '', allowEmpty: true });
    expect(filter.value).toBe('');
    expect([...filter.querySelectorAll('select')].every((select) => select.value === '')).toBe(true);
  });

  it('completes an optional date only when all three parts are picked', () => {
    const filter = jalaliDateInput({ value: '', allowEmpty: true });
    const [year, month, day] = filter.querySelectorAll('select');

    year.value = '1405';
    year.dispatchEvent(new window.Event('change', { bubbles: true }));
    expect(filter.value).toBe('');

    month.value = '7';
    month.dispatchEvent(new window.Event('change', { bubbles: true }));
    day.value = '28';
    day.dispatchEvent(new window.Event('change', { bubbles: true }));
    expect(filter.value).toBe('2026-10-20');

    day.value = '';
    day.dispatchEvent(new window.Event('change', { bubbles: true }));
    expect(filter.value).toBe('');
  });

  it('clamps the day when the chosen month is shorter', () => {
    const field = jalaliDateInput({ value: browserJalali.jalaliToIso(1403, 12, 30) }); // leap Esfand: 30 days
    const [year, , day] = field.querySelectorAll('select');
    expect(day.value).toBe('30');

    year.value = '1404'; // Esfand has 29 days
    year.dispatchEvent(new window.Event('change', { bubbles: true }));
    expect(day.value).toBe('29');
    expect(field.value).toBe(browserJalali.jalaliToIso(1404, 12, 29));
  });

  it('accepts a value assignment and reports changes as ISO dates', () => {
    const seen = [];
    const field = jalaliDateInput({ value: '2026-10-20', onChange: (iso) => seen.push(iso) });
    const [, month, day] = field.querySelectorAll('select');

    month.value = '12';
    month.dispatchEvent(new window.Event('change', { bubbles: true }));
    expect(seen.at(-1)).toBe(browserJalali.jalaliToIso(1405, 12, 28));

    day.value = '1';
    day.dispatchEvent(new window.Event('change', { bubbles: true }));
    expect(field.value).toBe(browserJalali.jalaliToIso(1405, 12, 1));

    field.value = '2026-03-20'; // 1404/12/29
    expect(field.value).toBe('2026-03-20');
    expect(day.value).toBe('29');
  });
});

describe('safe rendering', () => {
  it('never parses user text as markup', () => {
    const host = el('div');
    mount(host, [el('span', { text: '<img src=x onerror="window.pwned=1">' })]);
    expect(host.querySelector('img')).toBeNull();
    expect(host.textContent).toContain('<img');
  });

  it('escapes hostile names inside a table cell', () => {
    const cell = el('td.name-cell', { text: '<script>alert(1)</script>' });
    expect(cell.querySelector('script')).toBeNull();
    expect(cell.textContent).toBe('<script>alert(1)</script>');
  });

  it('normalizes Persian characters for search', () => {
    expect(normalizeFa('علي كريمي')).toBe(normalizeFa('علی کریمی'));
    expect(matches('علی\u200cرضا', 'علیرضا')).toBe(true);
    expect(matches('محمد', 'رضا')).toBe(false);
  });

  it('formats numbers with Persian digits on demand', () => {
    expect(formatNumber(1250, true)).toBe('۱۲۵۰');
    expect(formatNumber(1250, false)).toBe('1250');
    expect(rating(250).title).toBe('فرمانده');
  });
});

describe('router', () => {
  it('matches parameterised patterns', () => {
    expect(matchPattern('teacher/league/:id', 'teacher/league/12')).toEqual({ id: '12' });
    expect(matchPattern('teacher/league/:id', 'teacher/league/12/teams')).toBeNull();
    expect(matchPattern('teacher', 'teacher')).toEqual({});
  });

  it('builds paths back from parameters', () => {
    expect(buildPath('teacher/league/:id/teams', { id: 7 })).toBe('teacher/league/7/teams');
  });
});

describe('student progress chart', () => {
  it('colours gains green, losses red and the edges blue', () => {
    const series = {
      start: 100,
      points: [
        { id: 1, delta: 25, total: 125, columnName: 'ریاضی', reason: 'پاسخ درست', createdAt: '2026-08-01T10:00:00.000Z' },
        { id: 2, delta: -10, total: 115, columnName: 'انضباطی', reason: 'تأخیر', createdAt: '2026-08-02T10:00:00.000Z' },
        { id: 3, delta: 15, total: 130, columnName: 'علوم', reason: '', createdAt: '2026-08-03T10:00:00.000Z' },
      ],
    };
    const { config, colors, data, labels } = buildPointsChartConfig(series, { persianDigits: false });
    expect(data).toEqual([100, 125, 115, 130]);
    expect(labels[0]).toBe('شروع');
    expect(colors[0]).toBe('#2563eb');
    expect(colors[colors.length - 1]).toBe('#2563eb');
    expect(colors[1]).toBe('#16a34a');
    expect(colors[2]).toBe('#dc2626');
    expect(config.type).toBe('line');
    expect(config.data.datasets[0].fill).toBe(true);
    expect(config.options.plugins.tooltip.rtl).toBe(true);
  });

  it('handles an empty series without throwing', () => {
    const { data, labels } = buildPointsChartConfig({ start: 0, points: [] });
    expect(data).toEqual([0]);
    expect(labels).toEqual(['شروع']);
  });
});

describe('teacher dashboard', () => {
  it('renders the league selector and the twelve tool tiles', async () => {
    api.get.mockImplementation((url) => {
      if (url === '/leagues') {
        return Promise.resolve({
          items: [{ id: 3, name: 'کلاس ششم الف', status: 'active', studentCount: 22, teamCount: 4, createdAt: '2026-08-01T00:00:00.000Z' }],
        });
      }
      if (url === '/leagues/3') {
        return Promise.resolve({
          league: { id: 3, name: 'کلاس ششم الف', status: 'active', createdAt: '2026-08-01T00:00:00.000Z' },
          summary: { studentCount: 22, presentToday: 18, absentToday: 2, lateToday: 2, unmarkedToday: 0, averageScore: 240, teamCount: 4, columnCount: 8 },
        });
      }
      return Promise.reject(new Error(`unexpected url ${url}`));
    });

    await renderTeacherDashboard();

    const tiles = document.querySelectorAll('#view .tile');
    expect(tiles).toHaveLength(12);
    expect(document.querySelector('#view').textContent).toContain('کلاس ششم الف');
    expect(document.querySelector('#view').textContent).toContain('لیگ انفرادی');
    expect(document.querySelector('#view').textContent).toContain('ارزشیابی دروس');
    expect(state.leagueId).toBe(3);
  });
});

describe('staged score editing', () => {
  it('stages per-row deltas and commits them in one request', async () => {
    api.post.mockResolvedValue({ studentId: 5, total: 75, applied: 2 });
    const columns = [
      { id: 1, name: 'ریاضی', step: 25 },
      { id: 2, name: 'فارسی', step: 25 },
    ];
    const students = [
      { id: 5, name: 'زهرا محمدی', rank: 1, total: 25, scores: { 1: 25 }, attended: 3, recorded: 3, championships: 0, title: { title: 'جنگجو' } },
    ];
    const reload = vi.fn();

    const node = createScoresTable({ leagueId: 3, columns, students, reload });
    const host = el('div');
    mount(host, [node]);

    const plusMath = host.querySelector('[aria-label="افزایش ریاضی"]');
    const plusPersian = host.querySelector('[aria-label="افزایش فارسی"]');
    expect(plusMath).not.toBeNull();
    plusMath.click();
    plusMath.click();
    plusPersian.click();

    const totalCell = host.querySelector('td.total-cell');
    expect(totalCell.textContent).toContain('۱۰۰');

    host.querySelector('[aria-label="ثبت تغییرات این ردیف"]').click();
    await vi.waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));

    const [url, body] = api.post.mock.calls[0];
    expect(url).toBe('/leagues/3/scores/commit');
    expect(body.studentId).toBe(5);
    expect(body.changes).toEqual(
      expect.arrayContaining([
        { columnId: 1, delta: 50 },
        { columnId: 2, delta: 25 },
      ]),
    );
    expect(body.changes).toHaveLength(2);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('keeps rows narrow: two actions and the pinned column classes', () => {
    const columns = [
      { id: 1, name: 'ریاضی', step: 25 },
      { id: 2, name: 'فارسی', step: 25 },
    ];
    const students = [
      { id: 5, name: 'زهرا محمدی', rank: 2, total: 35, scores: { 1: 25, 2: 10 }, attended: 3, recorded: 3, championships: 1, title: { title: 'جنگجو' } },
    ];

    const node = createScoresTable({ leagueId: 3, columns, students, reload: vi.fn() });
    const host = el('div');
    mount(host, [node]);

    // The sticky rail CSS in components.css relies on these classes.
    for (const selector of ['td.col-rank', 'td.name-cell', 'td.total-cell', 'td.actions-td', 'th.col-rank', 'th.col-name', 'th.col-total', 'th.col-actions']) {
      expect(host.querySelector(selector), selector).not.toBeNull();
    }

    // Only commit + profile stay in the row; the rest moved to the profile dialog
    // so the table fits without horizontal scrolling.
    const actions = host.querySelectorAll('td.actions-td button');
    expect([...actions].map((button) => button.getAttribute('aria-label'))).toEqual([
      'ثبت تغییرات این ردیف',
      'پرونده دانش‌آموز',
    ]);

    // Staging must not change the column width: the label shows the resulting
    // value and the delta is carried by the badge attribute.
    host.querySelector('[aria-label="افزایش ریاضی"]').click();
    const staged = host.querySelector('.score-value.is-staged');
    expect(staged).not.toBeNull();
    expect(staged.textContent).toBe('۵۰');
    expect(staged.dataset.delta).toBe('+۲۵');
  });
});

describe('inline add student', () => {
  const emptyTable = (reload) => {
    const node = createScoresTable({ leagueId: 3, columns: [], students: [], reload });
    const host = el('div');
    mount(host, [node]);
    return host;
  };

  it('shows the add row even when the league has no students yet', () => {
    const host = emptyTable(vi.fn());
    expect(host.querySelector('[aria-label="نام دانش‌آموز جدید"]')).not.toBeNull();
    expect(host.textContent).toContain('هنوز دانش‌آموزی اضافه نشده');
  });

  it('adds a student by name and clears the field', async () => {
    api.post.mockResolvedValue({ student: { id: 9, name: 'سارا تازه' } });
    const reload = vi.fn();
    const host = emptyTable(reload);

    const input = host.querySelector('[aria-label="نام دانش‌آموز جدید"]');
    input.value = '  سارا تازه  ';
    input.nextElementSibling.click(); // the inline «افزودن» button

    await vi.waitFor(() => expect(input.value).toBe(''));
    expect(api.post).toHaveBeenCalledWith('/leagues/3/students', { name: 'سارا تازه' });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('ignores an empty name', () => {
    const reload = vi.fn();
    const host = emptyTable(reload);
    const input = host.querySelector('[aria-label="نام دانش‌آموز جدید"]');
    input.value = '   ';
    input.nextElementSibling.click();
    expect(api.post).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('team assignment', () => {
  it('assigns an unassigned student to the selected team by clicking their chip', async () => {
    api.get.mockImplementation((url) => {
      if (url === '/leagues/3') {
        return Promise.resolve({ league: { id: 3, name: 'کلاس ششم الف' } });
      }
      if (url === '/leagues/3/teams') {
        return Promise.resolve({
          individualAffectsTeam: true,
          settings: { individualAffectsTeam: true },
          teams: [
            {
              id: 9,
              name: 'عقاب‌ها',
              label: null,
              basePoints: 40,
              individualPoints: 120,
              memberAverage: 60,
              memberCount: 2,
              finalPoints: 100,
              rank: 1,
              members: [{ studentId: 1, name: 'علی' }],
            },
          ],
          unassigned: [{ studentId: 7, name: 'سمیرا', total: 30 }],
        });
      }
      return Promise.reject(new Error(`unexpected url ${url}`));
    });
    api.post.mockResolvedValue({});

    await renderTeams({ params: { id: '3' } });

    const view = document.querySelector('#view');
    expect(view.textContent).toContain('عقاب‌ها');
    expect(view.textContent).toContain('سمیرا');

    const chip = [...view.querySelectorAll('button.chip')].find((node) => node.textContent.includes('سمیرا'));
    chip.click();

    await vi.waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    const [url, body] = api.post.mock.calls[0];
    expect(url).toBe('/leagues/3/teams/assign');
    expect(body).toEqual({ teamId: 9, studentId: 7 });
  });
});

describe('student dashboard', () => {
  it('greets the student, shows stats and mounts the chart canvas', async () => {
    api.get.mockResolvedValue({
      studentId: 4,
      name: 'زهرا محمدی',
      leagueName: 'کلاس ششم الف',
      leagueStatus: 'active',
      points: 320,
      rank: 2,
      totalStudents: 22,
      championships: 1,
      completedLeagues: 0,
      title: { title: 'فرمانده', icon: '🛡️' },
      medals: [{ id: 1, title: 'نایب قهرمان', rank: 2, source: 'league_completed', createdAt: '2026-08-02T10:00:00.000Z' }],
      team: { id: 9, name: 'عقاب‌ها', rank: 1, members: 3 },
      series: {
        start: 100,
        points: [
          { id: 1, delta: 220, total: 320, columnName: 'ریاضی', reason: 'آزمون', createdAt: '2026-08-03T10:00:00.000Z' },
        ],
      },
    });

    await renderStudentDashboard();

    const view = document.querySelector('#view');
    expect(view.textContent).toContain('سلام زهرا!');
    expect(view.textContent).toContain('کلاس ششم الف');
    expect(view.textContent).toContain('۳۲۰');
    expect(view.textContent).toContain('رتبه من');
    expect(view.querySelector('canvas')).not.toBeNull();
    expect(document.getElementById('league-pill').hidden).toBe(false);
  });

  it('shows an empty state when no points were recorded yet', async () => {
    api.get.mockResolvedValue({
      studentId: 4,
      name: 'رضا',
      leagueName: 'کلاس',
      leagueStatus: 'active',
      points: 0,
      rank: 22,
      totalStudents: 22,
      championships: 0,
      medals: [],
      team: null,
      title: { title: 'نوآموز', icon: '🌱' },
      series: { start: 0, points: [] },
    });

    await renderStudentDashboard();
    const view = document.querySelector('#view');
    expect(view.querySelector('canvas')).toBeNull();
    expect(view.textContent).toContain('هنوز امتیازی ثبت نشده است');
  });
});

describe('student report card', () => {
  const payload = {
    studentId: 4,
    name: 'زهرا محمدی',
    leagueName: 'کلاس ششم الف',
    grade: 'ششم',
    total: 320,
    rank: 2,
    totalStudents: 22,
    title: { title: 'فرمانده', icon: '🛡️' },
    columns: [{ id: 1, name: 'ریاضی', step: 25 }, { id: 2, name: 'فارسی', step: 25 }],
    filters: { columnId: null, from: null, to: null, limit: 200 },
    items: [
      { columnId: 1, name: 'ریاضی', step: 25, value: 200 },
      { columnId: 2, name: 'فارسی', step: 25, value: 120 },
    ],
    sessions: [
      {
        id: 9, columnId: 1, columnName: 'ریاضی', topic: 'هفته ۴', delta: 50, actorName: 'خانم الف',
        totalAfter: 320, createdAt: '2026-08-03T10:00:00.000Z', quality: { key: 'excellent', label: 'عالی', icon: '🌟' },
      },
      {
        id: 8, columnId: 2, columnName: 'فارسی', topic: '', delta: -5, actorName: '',
        totalAfter: 270, createdAt: '2026-08-02T10:00:00.000Z', quality: { key: 'negative', label: 'کسر امتیاز', icon: '⚠️' },
      },
    ],
    sessionCount: 2,
  };

  it('renders the profile band, the session lines and the chart', async () => {
    api.get.mockResolvedValue(payload);
    await renderReportCard();

    const view = document.querySelector('#view');
    expect(view.textContent).toContain('زهرا محمدی');
    expect(view.textContent).toContain('پایه: ششم');
    expect(view.textContent).toContain('ریاضی — هفته ۴');
    expect(view.querySelectorAll('.session-card')).toHaveLength(2);
    expect(view.querySelector('.chip--gold').textContent).toContain('عالی');
    expect(view.querySelector('.session-card__points.is-negative').textContent).toContain('−');
    expect(view.querySelector('canvas')).not.toBeNull();
    expect(api.get).toHaveBeenCalledWith('/student/report-card');
  });

  it('shows an empty state when the selected range has no records', async () => {
    api.get.mockResolvedValue({ ...payload, sessions: [], sessionCount: 0 });
    await renderReportCard();

    const view = document.querySelector('#view');
    expect(view.querySelectorAll('.session-card')).toHaveLength(0);
    expect(view.textContent).toContain('در این بازه ثبتی وجود ندارد');
  });

  it('reloads with the chosen subject and date range', async () => {
    api.get.mockResolvedValue(payload);
    await renderReportCard();
    api.get.mockClear();

    document.querySelector('#rc-column').value = '2';
    document.querySelector('#rc-from').value = '2026-02-01';
    document.querySelector('#rc-to').value = '2026-02-28';
    const apply = [...document.querySelectorAll('#view button')].find((node) => node.textContent.includes('اعمال فیلتر'));
    apply.click();

    await vi.waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/student/report-card?columnId=2&from=2026-02-01&to=2026-02-28');
    });
  });
});

describe('evaluation vocabulary parity between client and server', () => {
  it('shares levels, grades, kinds and descriptive labels', () => {
    expect(clientEvalMeta.SCHOOL_LEVELS).toEqual(serverEval.SCHOOL_LEVELS);
    expect(clientEvalMeta.GRADES_BY_LEVEL).toEqual(serverEval.GRADES_BY_LEVEL);
    expect(clientEvalMeta.GRADES).toEqual(serverEval.GRADES);
    expect(clientEvalMeta.DESCRIPTIVE_LEVELS).toEqual(serverEval.DESCRIPTIVE_LEVELS);
    expect(clientEvalMeta.EVALUATION_KINDS.map((kind) => kind.key)).toEqual(serverEval.EVALUATION_KINDS.map((kind) => kind.key));
  });

  it('bands numeric marks identically on both sides', () => {
    for (const score of [0, 4.5, 9.75, 10, 12, 14.5, 15, 17, 18, 19.5, 20]) {
      expect(clientEvalMeta.numericBand(score, 20)).toEqual(serverEval.numericBand(score, 20));
    }
    for (const score of [0, 25, 49, 50, 74, 75, 89, 90, 99, 100]) {
      expect(clientEvalMeta.numericBand(score, 100)).toEqual(serverEval.numericBand(score, 100));
    }
    expect(clientEvalMeta.numericBand(null, 20)).toEqual(serverEval.numericBand(null, 20));
  });

  it('resolves descriptive labels identically', () => {
    for (const key of ['excellent', 'good', 'fair', 'needs-work', '', 'perfect']) {
      expect(clientEvalMeta.descriptiveLevel(key)).toEqual(serverEval.descriptiveLevel(key));
    }
  });
});

describe('course evaluations (teacher view)', () => {
  const evaluation = {
    id: 7,
    leagueId: 3,
    subject: 'ریاضی',
    title: 'آزمون فصل ۲',
    level: 'ابتدایی',
    grade: 'ششم',
    kind: 'numeric',
    scaleMin: 0,
    scaleMax: 20,
    heldOn: '2026-10-12',
    note: '',
    columnId: 1,
    gradedCount: 2,
    studentCount: 3,
    average: 17.5,
    minScore: 15,
    maxScore: 20,
  };

  const listPayload = {
    league: { id: 3, name: 'کلاس ششم الف', grade: 'ششم' },
    items: [
      evaluation,
      { ...evaluation, id: 6, subject: 'هدیه', title: 'ارزشیابی توصیفی', kind: 'descriptive', average: null, gradedCount: 0, heldOn: '2026-10-05' },
    ],
    total: 2,
    stats: { count: 2, subjectCount: 2, studentCount: 3, gradedCount: 2, average: 17.5 },
    subjects: ['ریاضی', 'هدیه'],
    titles: ['آزمون فصل ۲'],
    columns: [{ id: 1, name: 'ریاضی', step: 25 }],
    scoring: { enabled: true, excellent: 100, good: 25, fair: -25, needsWork: -50 },
    options: {
      levels: serverEval.SCHOOL_LEVELS,
      grades: serverEval.GRADES,
      gradesByLevel: serverEval.GRADES_BY_LEVEL,
      kinds: serverEval.EVALUATION_KINDS,
      descriptive: serverEval.DESCRIPTIVE_LEVELS,
    },
  };

  const detail = {
    evaluation,
    students: [
      { studentId: 11, name: 'آرش آزمون', score: 20, label: '', note: '' },
      { studentId: 12, name: 'بهار بنفش', score: 15, label: '', note: '' },
      { studentId: 13, name: 'پویا پیشرو', score: null, label: '', note: '' },
    ],
  };

  it('renders the stats, the create form and the recorded list', async () => {
    api.get.mockResolvedValue(listPayload);
    await renderEvaluations({ params: { id: '3' } });

    const view = document.querySelector('#view');
    expect(view.textContent).toContain('ارزشیابی دروس');
    expect(view.textContent).toContain('۱۷.۵');
    expect(view.textContent).toContain('کلاس ششم الف');
    expect(view.querySelectorAll('.timeline-item')).toHaveLength(2);
    expect(view.textContent).toContain('ریاضی — آزمون فصل ۲');

    // the form pre-selects the level/grade configured for the league
    expect(view.querySelector('#ev-level').value).toBe('ابتدایی');
    expect(view.querySelector('#ev-grade').value).toBe('ششم');
    // the date field is a Shamsi picker whose value stays an ISO date for the API
    const dateField = view.querySelector('#ev-date');
    expect(dateField.querySelectorAll('select')).toHaveLength(3);
    expect(dateField.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(view.textContent).toContain('تاریخ (شمسی)');
    expect(view.querySelector('#ev-filter-from').value).toBe('');
    expect(view.querySelector('#ev-max').value).toBe('20');
    expect(api.get).toHaveBeenCalledWith('/leagues/3/evaluations');

    // a subject matching a league column is announced with the scoring behaviour
    const subject = view.querySelector('#ev-subject');
    subject.value = 'ریاضی';
    subject.dispatchEvent(new window.Event('input', { bubbles: true }));
    expect(view.textContent).toContain('به ستون «ریاضی»');
    expect(view.textContent).toContain('به ستون «ریاضی» لیگ اضافه می‌شوند');
  });

  it('previews the mark-to-points mapping and saves the scoring settings', async () => {
    api.get.mockResolvedValue(listPayload);
    api.put.mockResolvedValue({ scoring: listPayload.scoring });
    await renderEvaluations({ params: { id: '3' } });

    const view = document.querySelector('#view');
    const sample = view.querySelector('#ev-points-sample');
    expect(view.querySelector('#ev-points-enabled').checked).toBe(true);
    expect(sample.value).toBe('9.99');
    expect(view.textContent).toContain('نیاز به تلاش ← -۵۰');

    // 15/20 is «خوب» and the preview follows the edited point values
    sample.value = '15';
    sample.dispatchEvent(new window.Event('input', { bubbles: true }));
    expect(view.textContent).toContain('خوب ← ۲۵');

    const good = view.querySelector('#ev-points-good');
    good.value = '40';
    good.dispatchEvent(new window.Event('input', { bubbles: true }));
    expect(view.textContent).toContain('خوب ← ۴۰');

    view.querySelector('#ev-points-enabled').checked = false;
    [...view.querySelectorAll('button')].find((node) => node.textContent.includes('ذخیره تنظیمات امتیازدهی')).click();

    await vi.waitFor(() => expect(api.put).toHaveBeenCalledWith('/leagues/3/evaluations/scoring', {
      enabled: false,
      excellent: 100,
      good: 40,
      fair: -25,
      needsWork: -50,
    }));
  });

  it('creates a new evaluation from the inline form', async () => {
    api.get.mockResolvedValue(listPayload);
    api.post.mockResolvedValue({ evaluation: { ...evaluation, id: 9 } });
    await renderEvaluations({ params: { id: '3' } });

    const view = document.querySelector('#view');
    view.querySelector('#ev-subject').value = 'علوم';
    view.querySelector('#ev-title').value = 'آزمون فصل ۳';
    view.querySelector('#ev-date').value = '2026-10-20';
    view.querySelector('#ev-note').value = 'فصل سوم';
    [...view.querySelectorAll('button')].find((node) => node.textContent.includes('ثبت ارزشیابی')).click();

    await vi.waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(api.post).toHaveBeenCalledWith('/leagues/3/evaluations', {
      subject: 'علوم',
      title: 'آزمون فصل ۳',
      level: 'ابتدایی',
      grade: 'ششم',
      kind: 'numeric',
      scaleMin: 0,
      scaleMax: 20,
      heldOn: '2026-10-20',
      note: 'فصل سوم',
    });
  });

  it('opens the mark sheet, fills every mark and saves them', async () => {
    api.get.mockImplementation((url) => Promise.resolve(url === '/leagues/3/evaluations' ? listPayload : detail));
    api.put.mockResolvedValue({ evaluation: { ...evaluation, gradedCount: 3 }, students: detail.students });
    await renderEvaluations({ params: { id: '3' } });

    document.querySelector('#view button[aria-label="ثبت نمرات"]').click();
    await vi.waitFor(() => expect(document.querySelector('#view table.grid-table input[type="number"]')).not.toBeNull());

    const view = document.querySelector('#view');
    expect(view.textContent).toContain('نمرات ریاضی — آزمون فصل ۲');
    const inputs = [...view.querySelectorAll('table.grid-table input[type="number"]')];
    expect(inputs).toHaveLength(3);
    expect(inputs.map((input) => input.value)).toEqual(['20', '15', '']);
    expect(view.querySelector('.chip--gold').textContent).toContain('عالی');
    expect(view.querySelector('table.grid-table .chip--amber').textContent).toContain('خوب');
    expect(view.textContent).toContain('ثبت‌شده ۲ از ۳');
    expect(view.textContent).toContain('بدون اثر روی امتیاز لیگ');

    [...view.querySelectorAll('button')].find((node) => node.textContent.includes('نمرهٔ کامل')).click();
    expect(inputs.every((input) => input.value === '20')).toBe(true);

    [...view.querySelectorAll('button')].find((node) => node.textContent.includes('ذخیره نمرات')).click();
    await vi.waitFor(() => expect(api.put).toHaveBeenCalled());
    expect(api.put).toHaveBeenCalledWith('/leagues/3/evaluations/7/scores', {
      scores: [
        { studentId: 11, score: 20, label: '' },
        { studentId: 12, score: 20, label: '' },
        { studentId: 13, score: 20, label: '' },
      ],
    });
  });

  it('grades a descriptive evaluation with level selectors', async () => {
    const descriptive = { ...evaluation, id: 6, kind: 'descriptive', subject: 'هدیه', title: 'ارزشیابی توصیفی' };
    api.get.mockImplementation((url) => Promise.resolve(url === '/leagues/3/evaluations'
      ? listPayload
      : { evaluation: descriptive, students: [{ studentId: 11, name: 'آرش آزمون', score: null, label: 'good', note: '' }] }));
    api.put.mockResolvedValue({ evaluation: descriptive, students: [] });
    await renderEvaluations({ params: { id: '3' } });

    document.querySelector('#view button[aria-label="ثبت نمرات"]').click();
    await vi.waitFor(() => expect(document.querySelector('#view table.grid-table select')).not.toBeNull());

    const view = document.querySelector('#view');
    const select = view.querySelector('table.grid-table select');
    expect(select.value).toBe('good');
    expect(select.querySelectorAll('option')).toHaveLength(5);
    expect(view.textContent).toContain('خوب');
    // descriptive sheets offer the qualitative levels instead of a full-mark button
    expect([...view.querySelectorAll('button')].some((node) => node.textContent.includes('نیاز به تلاش'))).toBe(true);
    expect([...view.querySelectorAll('button')].some((node) => node.textContent.includes('نمرهٔ کامل'))).toBe(false);
  });
});

describe('student evaluations view', () => {
  const payload = {
    items: [
      {
        id: 7, subject: 'ریاضی', title: 'آزمون فصل ۲', level: 'ابتدایی', grade: 'ششم', kind: 'numeric',
        scaleMin: 0, scaleMax: 20, heldOn: '2026-10-12', note: '', score: 20, label: '',
        average: 16.67, topScore: 20, gradedCount: 3, studentCount: 3, rank: 1,
        band: { key: 'excellent', label: 'عالی', icon: '🌟' },
      },
      {
        id: 6, subject: 'هدیه', title: 'ارزشیابی توصیفی', level: 'ابتدایی', grade: 'ششم', kind: 'descriptive',
        scaleMin: 0, scaleMax: 20, heldOn: '2026-10-05', note: 'تلاش خوب', score: null, label: 'good',
        average: null, topScore: null, gradedCount: 1, studentCount: 3, rank: null,
        band: { key: 'good', label: 'خوب', icon: '👍' },
      },
      {
        id: 5, subject: 'علوم', title: 'آزمون مهر', level: 'ابتدایی', grade: 'ششم', kind: 'numeric',
        scaleMin: 0, scaleMax: 20, heldOn: '2026-10-01', note: '', score: null, label: '',
        average: null, topScore: null, gradedCount: 0, studentCount: 3, rank: null, band: null,
      },
    ],
    stats: { count: 3, graded: 1, average: 20, bestSubject: 'ریاضی', subjects: [{ subject: 'ریاضی', average: 20, count: 1 }] },
  };

  it('lists own marks with bands, class average and rank', async () => {
    api.get.mockResolvedValue(payload);
    await renderStudentEvaluations();

    const view = document.querySelector('#view');
    expect(view.textContent).toContain('ارزشیابی من');
    expect(view.querySelectorAll('.timeline-item')).toHaveLength(3);
    expect(view.textContent).toContain('ریاضی — آزمون فصل ۲');
    expect(view.querySelector('.chip--gold').textContent).toContain('عالی');
    expect(view.querySelector('.chip--amber').textContent).toContain('خوب');
    expect(view.querySelector('.eval-score').textContent).toBe('۲۰');
    expect(view.textContent).toContain('میانگین کلاس ۱۶.۶۷');
    expect(view.textContent).toContain('رتبهٔ ۱ از ۳');
    expect(view.textContent).toContain('ثبت نشده');
    expect(view.textContent).toContain('بهترین درس');
    expect(view.textContent).toContain('ریاضی: ۲۰');
    expect(api.get).toHaveBeenCalledWith('/student/evaluations');
  });

  it('shows an empty state before any evaluation exists', async () => {
    api.get.mockResolvedValue({ items: [], stats: { count: 0, graded: 0, average: null, bestSubject: null, subjects: [] } });
    await renderStudentEvaluations();
    expect(document.querySelector('#view').textContent).toContain('هنوز ارزشیابی‌ای ثبت نشده است');
  });
});

describe('modal dialogs', () => {
  it('keeps the footer close button alive when async content replaces the body', async () => {
    const { openModal } = await import('../public/js/ui.js');
    const body = el('div', {}, [el('p', { text: 'در حال بارگذاری…' })]);
    const modal = openModal({ title: 'پرونده رضا', body });

    const root = document.getElementById('modal-root');
    const closeButton = [...root.querySelectorAll('button')].find((node) => node.textContent === 'بستن');
    expect(closeButton).toBeDefined();

    // this is what the async profile drawer does once the data arrives
    modal.setContent([el('h2.modal__title', { text: 'پرونده رضا' }), el('p', { text: '۲۲۰ امتیاز' })]);

    const after = document.getElementById('modal-root');
    expect(after.textContent).toContain('۲۲۰ امتیاز');
    expect([...after.querySelectorAll('button')].find((node) => node.textContent === 'بستن')).toBe(closeButton);

    // and the preserved button still closes the dialog
    closeButton.click();
    expect(document.querySelector('#modal-root .modal')).toBeNull();
  });

  it('closes on Escape and restores focus to the element that opened it', async () => {
    const { openModal } = await import('../public/js/ui.js');
    const trigger = el('button.btn', { type: 'button', text: 'باز کن' });
    document.querySelector('#view').appendChild(trigger);
    trigger.focus();

    openModal({ title: 'تأیید', body: el('p', { text: 'متن' }) });
    expect(document.querySelector('#modal-root .modal')).not.toBeNull();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('#modal-root .modal')).toBeNull();
    expect(document.activeElement?.textContent).toBe('باز کن');
  });
});
