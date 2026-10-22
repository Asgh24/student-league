// @vitest-environment jsdom
/** Frontend smoke test for the owner's backup/restore page. */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

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
const { renderAdminBackup } = await import('../public/js/views/admin/backup.js');
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

function payload(overrides = {}) {
  return {
    configured: true,
    enabled: true,
    missing: [],
    restoreOnEmpty: true,
    repo: 'owner/league-backups',
    branch: 'main',
    dir: 'db-backups',
    local: { dbBytes: 417792, uploadsBytes: 1024, uploadsFiles: 2 },
    remote: {
      count: 1,
      snapshots: [{ name: 'league-20261019T145242Z.db', size: 417792, sha: 'abc' }],
      newest: { name: 'league-20261019T145242Z.db', size: 417792, sha: 'abc' },
      manifest: { file: 'league-20261019T145242Z.db', createdAt: '2026-10-19T14:52:42.000Z' },
      error: null,
    },
    scheduler: { lastSuccessAt: '2026-10-19T14:52:42.000Z', lastFile: 'league-20261019T145242Z.db' },
    pendingRestore: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  installShellSkeleton();
  setUser({ id: 1, role: 'admin', username: 'admin', displayName: 'مدیر' });
  setPersianDigits(true);
  setMeta({ appName: 'لیگ جامع دانش‌آموزی' });
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('admin backup page', () => {
  it('explains the missing environment variables when GitHub is not configured', async () => {
    api.get.mockResolvedValueOnce(payload({
      configured: false,
      missing: ['BACKUP_GITHUB_REPO', 'BACKUP_GITHUB_TOKEN'],
      repo: '',
      remote: { count: 0, snapshots: [], newest: null, manifest: null, error: null },
    }));

    await renderAdminBackup();

    const text = document.body.textContent;
    expect(text).toContain('بکاپ و بازیابی');
    expect(text).toContain('BACKUP_GITHUB_REPO');
    expect(text).toContain('BACKUP_GITHUB_TOKEN');
    expect(text).toContain('دانلود بکاپ محلی');
    expect(text).not.toContain('null');
    const backupButton = [...document.querySelectorAll('button')].find((node) => node.textContent.includes('بکاپ همین حالا'));
    expect(backupButton.disabled).toBe(true);
  });

  it('lists remote snapshots and exposes a local download link', async () => {
    api.get.mockResolvedValueOnce(payload());

    await renderAdminBackup();

    expect(document.body.textContent).toContain('league-20261019T145242Z.db');
    expect(document.body.textContent).toContain('owner/league-backups');
    expect(document.body.textContent).toContain('بازیابی این نسخه');
    const download = document.querySelector('a[href="/api/v1/admin/backup/download"]');
    expect(download).toBeTruthy();
  });
});
