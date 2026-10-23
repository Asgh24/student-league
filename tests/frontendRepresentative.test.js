// @vitest-environment jsdom
/** Frontend smoke test for the «نماینده کلاس» tool. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
    refreshCsrf: vi.fn(async () => 'csrf-test'),
    meta: vi.fn(async () => ({})),
    me: vi.fn(async () => ({ user: null })),
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
  };
});

const { api } = await import('../public/js/api.js');
const { renderRepresentative } = await import('../public/js/views/representative.js');
const { renderRepresentativeBoard } = await import('../public/js/views/representativeBoard.js');
const { setMeta, setPersianDigits, setUser } = await import('../public/js/store.js');

function installShellSkeleton() {
  document.body.innerHTML = `
    <header class="topbar" id="topbar" hidden>
      <button class="icon-btn" id="menu-btn" type="button"></button>
      <span class="topbar__title" id="topbar-title"></span>
      <span class="spacer"></span>
      <button class="pill" id="league-pill" hidden></button>
      <span class="pill pill--user" id="user-pill" hidden></span>
    </header>
    <main class="view" id="view" tabindex="-1"></main>
    <div class="toasts" id="toasts"></div>
    <div id="modal-root"></div>
  `;
}

function student(id, name, selected = false, timesSelected = 0) {
  return {
    studentId: id,
    name,
    selected,
    timesSelected,
    lastSelectedAt: timesSelected ? '2026-10-20T10:00:00.000Z' : null,
  };
}

function representativeState(overrides = {}) {
  return {
    cycle: 1,
    cycleStartedAt: '2026-10-20T09:00:00.000Z',
    cycleCompletedAt: null,
    completed: false,
    totalStudents: 3,
    selectedCount: 1,
    remainingCount: 2,
    percent: 33,
    lastSelected: {
      id: 1,
      studentId: 1,
      studentName: 'آرش آزمون',
      cycle: 1,
      createdAt: '2026-10-20T10:00:00.000Z',
    },
    students: [
      student(1, 'آرش آزمون', true, 1),
      student(2, 'بهار بنفش'),
      student(3, 'پویا پیشرو'),
    ],
    history: [
      { id: 1, studentId: 1, studentName: 'آرش آزمون', cycle: 1, createdAt: '2026-10-20T10:00:00.000Z' },
    ],
    cycles: [
      { cycle: 1, startedAt: '2026-10-20T09:00:00.000Z', completedAt: null, selectedCount: 1 },
    ],
    ...overrides,
  };
}

function mockLoad(state = representativeState()) {
  api.get.mockImplementation((url) => {
    if (url === '/leagues/7') {
      return Promise.resolve({ league: { id: 7, name: 'کلاس ششم الف', status: 'active' } });
    }
    if (url === '/leagues/7/tools/representative') return Promise.resolve(state);
    return Promise.reject(new Error(`unexpected url ${url}`));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  installShellSkeleton();
  setUser({ id: 2, role: 'teacher', username: 'teacher-a', displayName: 'خانم الف' });
  setPersianDigits(true);
  setMeta({ appName: 'لیگ جامع دانش‌آموزی' });
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('class representative page', () => {
  it('shows cycle progress, selected students and history', async () => {
    mockLoad();

    await renderRepresentative({ params: { id: 7 } });

    const text = document.body.textContent;
    expect(text).toContain('نماینده کلاس');
    expect(text).toContain('کلاس ششم الف');
    expect(text).toContain('دور ۱');
    expect(text).toContain('آرش آزمون');
    expect(text).toContain('بهار بنفش');
    expect(text).toContain('۳۳٪');
    expect(text).toContain('۱ از ۳ انتخاب‌شده');
    expect(document.querySelector('.rep-student.is-selected')).toBeTruthy();
    expect(document.querySelector('.rep-history')).toBeTruthy();
    expect([...document.querySelectorAll('button')].find((node) => node.textContent.includes('انتخاب نماینده بعدی'))).toBeTruthy();
  });

  it('draws the next representative and refreshes progress', async () => {
    mockLoad();
    const nextState = representativeState({
      selectedCount: 2,
      remainingCount: 1,
      percent: 67,
      lastSelected: {
        id: 2,
        studentId: 2,
        studentName: 'بهار بنفش',
        cycle: 1,
        createdAt: '2026-10-20T10:05:00.000Z',
      },
      students: [
        student(1, 'آرش آزمون', true, 1),
        student(2, 'بهار بنفش', true, 1),
        student(3, 'پویا پیشرو'),
      ],
      history: [
        { id: 2, studentId: 2, studentName: 'بهار بنفش', cycle: 1, createdAt: '2026-10-20T10:05:00.000Z' },
        { id: 1, studentId: 1, studentName: 'آرش آزمون', cycle: 1, createdAt: '2026-10-20T10:00:00.000Z' },
      ],
    });
    api.post.mockResolvedValueOnce({
      winner: { historyId: 2, studentId: 2, name: 'بهار بنفش' },
      cycle: 1,
      remaining: 1,
      completed: false,
      state: nextState,
    });

    await renderRepresentative({ params: { id: 7 } });
    [...document.querySelectorAll('button')].find((node) => node.textContent.includes('انتخاب نماینده بعدی')).click();

    await vi.waitFor(() => expect(document.querySelector('.rep-winner__name')?.textContent).toBe('بهار بنفش'));
    expect(api.post).toHaveBeenCalledWith('/leagues/7/tools/representative/draw', {});
    expect(document.body.textContent).toContain('۶۷٪');
    expect(document.querySelectorAll('.rep-student.is-selected')).toHaveLength(2);
    expect(document.querySelectorAll('.rep-history__row')).toHaveLength(2);
  });

  it('filters the student status list without changing the progress', async () => {
    mockLoad();

    await renderRepresentative({ params: { id: 7 } });
    const search = document.getElementById('rep-search');
    search.value = 'بهار';
    search.dispatchEvent(new Event('input', { bubbles: true }));

    const visible = [...document.querySelectorAll('.rep-student')].filter((node) => !node.hidden);
    expect(visible).toHaveLength(1);
    expect(visible[0].textContent).toContain('بهار بنفش');
    expect(document.body.textContent).toContain('نمایش ۱ از ۳ دانش‌آموز');
  });

  it('copies a ready-to-share announcement for the current winner', async () => {
    mockLoad();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    await renderRepresentative({ params: { id: 7 } });
    [...document.querySelectorAll('button')]
      .find((node) => node.textContent.includes('کپی متن اعلام'))
      .click();

    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const text = writeText.mock.calls[0][0];
    expect(text).toContain('نمایندهٔ کلاس کلاس ششم الف');
    expect(text).toContain('آرش آزمون');
    expect(text).toContain('دور ۱');
  });

  it('renders the projector board with the current winner and cycle picks', async () => {
    mockLoad();

    await renderRepresentativeBoard({ params: { id: 7 } });

    const stage = document.querySelector('.rep-stage');
    expect(stage).not.toBeNull();
    expect(stage.textContent).toContain('نمایندهٔ کلاس');
    expect(stage.textContent).toContain('کلاس ششم الف');
    expect(stage.textContent).toContain('آرش آزمون');
    expect(stage.textContent).toContain('۳۳٪');
    expect(stage.querySelectorAll('.rep-stage__pick')).toHaveLength(1);
    expect(stage.querySelector('a[href="#/teacher/league/7/representative"]')).not.toBeNull();
  });
});
