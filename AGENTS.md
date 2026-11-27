# AGENTS.md — working guide for this repository

> **این فایل برای هر ایجنت/دستگاه دیگری است که روی این پروژه کار می‌کند.**
> قبل از هر تغییر، این فایل را کامل بخوانید. قواعد «هرگز» و «قبل از اتمام» قابل مذاکره نیستند.

This document is the operating manual for coding agents on this project. It
records the conventions, safety rules, verification protocol and hard-won
lessons from previous sessions. Follow it unless the user explicitly asks for a
different approach.

---

## 0. Golden rules (خلاصهٔ غیرقابل‌مذاکره)

1. **هرگز** `.env`، `production.env`، `a.env`، `data/`، دیتابیس‌ها، تصاویر رسید و
   پوشهٔ untracked `artifacts/` را commit یا push نکنید.
2. **هرگز** `git add -A` یا `git add .` نزنید. فایل‌ها را صریح stage کنید.
3. قبل از ادعای «تمام شد»، واقعاً lint + کل تست‌ها (و برای کارهای UI، تست مرورگر
   واقعی) را اجرا کنید و خروجی را ببینید.
4. بعد از هر push یادآوری کنید: **Parspack → Redeploy/Restart** و **Ctrl+F5** در مرورگر.
5. رابط کاربری فارسی/RTL است؛ باید از عرض **360px** بدون سرریز افقی کار کند.
6. هیچ CDN/فونت/اسکریپت بیرونی اضافه نکنید؛ پروژه باید آفلاین کار کند.
7. رازها را هرگز چاپ نکنید (حتی در لاگ تست یا خروجی دستور).

---

## 1. Project snapshot

- **What:** «لیگ جامع دانش‌آموزی» / brand «تیچ لینک» — a Persian RTL classroom
  gamification SaaS for teachers, students and a site owner.
- **Root:** `E:\Random project` (the old `F:\Random project` no longer exists).
  The path contains a **space** — quote it in shells and browser launch args.
- **Runtime:** Node.js **22+** (tested on Node 26), native **ES modules**.
- **Backend:** Express 5, better-sqlite3 (single SQLite file), zod validation,
  express-session, helmet, rate limiting.
- **Frontend:** no bundler/build step. Native ES modules in `public/js`, served
  as static files. Chart.js and Vazirmatn are vendored under `public/vendor`.
- **Tests:** Vitest + supertest (backend) and jsdom (frontend).
- **Current baseline (keep README in sync):** `52` test files, `643` tests.
- **Current `main`:** tracks `origin/main`; feature commit `930ebb9`
  (in-site notifications).

Key commands:

```powershell
npm start                 # node server.js (default port 3000)
npm run dev               # nodemon
npm run migrate           # apply migrations only
npm run seed              # idempotent demo data (refuses in production)
npm run lint              # eslint .
npm test                  # vitest run
npx vitest run tests/<file>.test.js --reporter=verbose
```

---

## 2. Safety: secrets, data and git

### Never commit

- `.env`, `.env.*`, `*.env` (including `a.env`, `production.env`)
- `data/`, `*.db`, `*.db-wal`, `*.db-shm`, uploads, backups
- receipt images / payment proof files
- `artifacts/` (untracked verification output: scripts, screenshots, browser profiles)
- anything under `node_modules/`

`.gitignore` already covers most of these. `artifacts/` is **not** ignored, so it
is your responsibility to leave it untracked.

### Staging discipline

Stage explicit paths only:

```powershell
git add README.md public/css/components.css public/js/main.js
git add src/services/notifications.js tests/notifications.test.js
# NOT: git add -A / git add .
git status --short
```

Before committing, confirm:
- no `.env`/`data/`/artifact paths are staged;
- only intended source/docs/tests are staged;
- `git status -sb` shows `main...origin/main` (or the expected branch).

### Secrets

- Teacher SMS credentials and provider keys are encrypted server-side and are
  never returned by the API. Do not print them.
- Local dev teacher password comes from `BOOTSTRAP_TEACHER_PASS` in `.env`, not
  the seed default. Load it with `dotenv` in verification scripts; never echo it.
- `student1` demo login uses `student1234` in the current dev database.
- Useful login verification without printing secrets: compare candidate
  passwords against `users.password_hash` with `bcrypt.compareSync`.

---

## 3. Definition of done (mandatory)

A change is not done until **all** of these are true:

1. **Lint:** `npm run lint` (or `npx eslint .`) exits with no output/errors.
2. **Full tests:** `npm test` passes. Note the new counts (files/tests).
3. **Targeted tests:** new behavior has backend and/or jsdom tests.
4. **UI check (for UI work):** headless browser at **390px and 360px** with:
   - `0` console errors/warnings that are actually caused by the app,
   - `document.documentElement.scrollWidth - clientWidth === 0`,
   - the real flow clicked/submitted end-to-end (not only a DOM snapshot).
5. **README synced** (see §10).
6. **Commit** after green with a Conventional Commit message.
7. **Push** to `origin/main`, then remind the user:
   - Parspack panel → **Redeploy / Restart** (if backend/migrations changed),
   - browser **Ctrl+F5** after deploy.

Never say "done/passing" without having run the commands in this session.

---

## 4. Repository map

```
server.js                     Express app bootstrap
src/
  config.js                   env config (PORT, DATA_DIR, seed, SMS, …)
  db.js                       SQLite connection
  migrate.js                  runs versioned migrations on boot
  migrations/                 NNN_name.js modules + index.js registry
  routes/                     Express routers (one file per resource)
  services/                   business logic (notifications, sms, assistants, …)
  repositories/               focused DB accessors (users, admins, …)
  middleware/                 auth, csrf, session, errorHandler
  lib/                        errors, http, validate (zod schemas), phone, …
public/
  index.html                  static shell (topbar/drawer/view roots)
  css/base.css                tokens + palettes
  css/components.css          feature/component styles
  js/main.js                  boot, routes, nav, shell wiring
  js/store.js                 shared state + subscribe
  js/shell.js                 view mount, drawer/topbar helpers
  js/dom.js                   safe `el()` builder
  js/api.js                   fetch wrapper + CSRF retry
  js/notifications.js         bell badge, polling, browser notifications
  js/views/                   one module per screen
tests/                        Vitest suites + helpers/fixtures
scripts/                      CLI: migrate, seed, bootstrap, backup, vendor
artifacts/                    untracked audit/verification output
```

---

## 5. Backend conventions

- ES modules only (`import`/`export`, `"type": "module"`).
- Routes stay thin; put logic in `src/services/*` and DB accessors in
  `src/repositories/*`.
- Register every new migration in `src/migrations/index.js`; name it
  `NNN_snake_name.js` and export `id` + `up(db)`. Migrations run on boot, so a
  deployed server creates the schema automatically.
- Validate all input with a zod schema in `src/lib/validate.js` and the shared
  `validate({ body, query, params })` middleware. Query values arrive as
  strings; use `z.coerce` or `preprocess` deliberately (e.g. `unread`).
- Use the shared error helpers (`badRequest`, `notFound`, `AppError`) and stable
  machine codes (`VALIDATION_ERROR`, `NO_RECIPIENTS`, `STUDENTS_NOT_FOUND`, …).
- Use parameterized SQL only. No string-built SQL.
- Wrap multi-row writes in `db.transaction(() => …)`.
- `isoNow()` for timestamps; store ISO strings consistently.
- Mount new routers explicitly in `src/routes/index.js` (teacher/student) and
  `src/routes/admin.js` (owner-only). Mind route order: static paths before
  `/:id` paths.

### Roles and access (important)

- `users.role` is only `teacher` or `student`.
- **Admins live in a separate `admins` table/session** (`adminId`). Never assume
  an admin is a `users` row.
- An **assistant** is a `users.role = 'teacher'` account with
  `is_assistant = 1`, an `ownerId` and a scoped `assistant.leagueId`.
- Use `requireTeacher`, `requireStudent`, `requireAdmin`, `requireOwnerTeacher`,
  `requirePermission(permission)` and `loadOwnedLeague(db)`/`loadOwnedStudent(db)`.
- `requireTeacher` also enforces an active trial/subscription and returns
  `402 SUBSCRIPTION_REQUIRED`; use `requireTeacherAccount` only where an expired
  teacher must still pay/renew.
- `teacherId(req)` returns `ownerId` for assistants, otherwise the user id.
  Write data under the owner id, not the assistant user id.
- Students have no parent login. The only parent contact channel is
  `students.parent_phone` through the existing sms.ir outbox.
- Assistants receive a new section only when the owner grants the matching
  permission from `ASSISTANT_PERMISSIONS` in `src/services/assistants.js`.

### SMS

- `src/services/sms.js` exposes `queueMessage`, `deliverSms`, `markMessage`,
  `resolveSmsProvider`. Without credentials, rows stay `queued` (never dropped).
- Teachers can use their own encrypted sms.ir key/line; the server-wide
  `SMSIR_*` config is only a fallback for teachers with no own settings.
- Shad delivery is manual (open PV link + copy report); do not invent an API.

---

## 6. Frontend conventions

- **No build step.** Files under `public/` are served as-is. Keep imports
  relative and make sure every named import actually exists (the
  `moduleLinks` test checks this; Vite/jsdom transforms can hide typos).
- **XSS safety:** build DOM with `el()` and write user text through `text` /
  `textContent`. `innerHTML` is only for trusted, developer-authored markup.
- Views export a `renderX()` function and call `renderView([...nodes])`; route
  table lives in `main.js` with lazy `import()` loaders.
- Use `setTopbarTitle`, `renderView`, `pageHead`, `card`, `button`, `chip`,
  `emptyState`, `notify`, `confirmDialog`, `formDialog` for consistency.
- Shared state lives in `store.js` (`state`, `subscribe`, `setUser`,
  `setLeagueId`, `isTeacher`, `isStudent`, `isAdmin`, `isAssistant`, `can`).
  Prefer updating state through helpers; `emit()` re-renders the shell.
- Drawer badges: pass `badge` + `badgeKind: 'notifications'`; `shell.js` then
  emits `data-notify-badge` so the live badge updater can find it. Other badges
  default to `data-admin-pending`.
- Palettes: `ember` (default), `violet`, `ocean`. Use CSS variables
  (`--brand`, `--surface`, `--line`, …); do not hard-code a palette colour in a
  component unless it is semantic (e.g. red danger).
- Mobile: support **360px** minimum. Avoid fixed widths, wide tables must
  scroll inside their own wrapper or become labelled cards. The topbar hides
  the support shortcut under 480px (it stays reachable from drawer/footer).
- The app must work offline: no external URLs, no Google Fonts, no CDN.

### Router

- Route matching is exact on segment count, so `…/notifications` and
  `…/notifications/new` do not collide.
- Add a route **and** its nav entry, guard, and badge together.
- Lazy-loaded views must export the exact function name used by `loadView`.

---

## 7. Notifications feature reference (newest subsystem)

Purpose: teachers inform students/parents, the site owner broadcasts to all
users.

- **Data model:** `notifications` (one row per send) + `notification_recipients`
  (fan-out, per-user `read_at`). This keeps the inbox/unread badge cheap.
- **Migration:** `src/migrations/029_notifications.js`; registered in
  `src/migrations/index.js`.
- **Service:** `src/services/notifications.js` — categories, safe internal
  `link`, `unreadCount`, `unreadSummary`, `listInbox`, `markRead`,
  `markAllRead`, `deleteForUser`, `leagueAudience`, `sendTeacherNotification`,
  `sendAdminNotification`, `listSent`.
- **Routes:**
  - `src/routes/notifications.js`
    - `/api/v1/notifications` (inbox, `/unread`, `/read-all`, `/:id/read`,
      `DELETE /:id`)
    - `/api/v1/leagues/:id/notifications` (teacher history/audience/send)
    - `/api/v1/admin/notifications` (owner broadcast/history)
  - mounted in `src/routes/index.js` and `src/routes/admin.js`.
- **Validation:** `notificationList`, `notificationCompose`,
  `adminNotification` in `src/lib/validate.js`.
- **Permission:** `notifications` added to `ASSISTANT_PERMISSIONS`.
- **Frontend:**
  - `public/js/notifications.js` — `updateNotificationsBadge`,
    `refreshNotificationsBadge`, `startNotificationPolling`, browser-notification
    opt-in (`localStorage` key `scl.desktopNotifications`).
  - `public/js/views/notifications.js` — inbox; compose gated by
    `admin || (teacher && (!isAssistant() || can('notifications')))`.
  - `public/js/views/notificationsCompose.js` — teacher league notice or admin
    broadcast, student picker, SMS toggle, sent history.
  - topbar bell `#notif-btn` / `#notif-badge` in `public/index.html`.
- **Delivery choice:** polling every 45s (visibility-aware, also runs while the
  tab is hidden). **No SSE and no Web Push/service worker.** Closed-app delivery
  is covered only by the optional parent SMS. Do not add a service worker for
  notifications unless the user explicitly asks and accepts the trade-off.
- **Teacher audience:** all students of an owned league or `selected` student
  ids. Students without a login still count for the optional parent SMS.
  Cross-league ids are rejected (`STUDENTS_NOT_FOUND`); foreign teachers get
  `403`; a send with no in-app recipients and no SMS gets `NO_RECIPIENTS`.
- **Admin audience:** `all` / `teachers` / `students`.
- **Important:** `updateNotificationsBadge` writes `state.notificationsUnread`
  directly **without** `emit()`. The topbar/drawer `[data-notify-badge]` nodes
  are updated immediately; a fully re-rendered drawer uses the state value.
- `renderShell()` in `main.js` calls `refreshNotificationsBadge()` on every
  logged-in render. This is deliberate: without it the bell stayed empty after
  login until the 45s poll. Do not remove it.
- Compose league guard must treat `null`, `undefined`, `0` and non-integers as
  “no league”:

  ```js
  const leagueId = Number(state.leagueId);
  if (!admin && (!Number.isInteger(leagueId) || leagueId <= 0)) { … }
  ```

  `Number(null) === 0` previously slipped past `Number.isFinite`.

---

## 8. Testing conventions

### Backend (supertest)

- `tests/helpers.js` provides `createTestDatabase()` / `createClient()`.
- `tests/fixtures.js` builds a realistic teacher/student graph. **Only
  `fixture.studentUserA` currently has a login**, so a league notice reaches one
  account; set `parent_phone` via a DB `UPDATE` to test SMS.
- Reuse the middleware chain from `tests/support.test.js` (session, CSRF,
  attachUser, API router, error handler) when testing a new router.
- Tests run against throwaway SQLite DBs; never use `data/league.db` in tests.
- CSRF: get a token from `/api/v1/auth/csrf`, send `x-csrf-token` on mutations.
- Add a new test file rather than growing an unrelated one.

### Frontend (jsdom)

- Start the file with `// @vitest-environment jsdom`.
- Mock the API module:

  ```js
  vi.mock('../public/js/api.js', () => {
    const api = { get: vi.fn(), post: vi.fn(), del: vi.fn(), /* … */ };
    return { api, ApiError: class ApiError extends Error {} };
  });
  ```

- For UI primitives, prefer a partial mock of `ui.js` that keeps
  `emptyState`/`statCard` real but stubs `confirmDialog`/`notify`.
- Build the minimal shell in `beforeEach`:
  `#view`, `#topbar-title`, `#notif-btn`/`#notif-badge`, `#modal-root`, `#toasts`.
- `renderView` calls `window.scrollTo` only outside jsdom, so no stub is needed.
- Module-level state persists across tests. For polling/badge modules, reset
  with `setUser(null)` + `await refreshNotificationsBadge()` in `beforeEach`,
  then `vi.clearAllMocks()` and set default resolved values.
- Use `vi.waitFor` for async render/requests; use fake timers only for the
  polling loop and restore them.

### README test bookkeeping

Whenever the suite changes:
- update `Test Files` / `Tests` counts,
- add a row to the suite table with the file name, test count and coverage,
- update the manual verification checklist if you verified a user flow.

---

## 9. Headless browser verification recipe

The proven pattern from `artifacts/pwa-check/verify.mjs` and
`artifacts/notif-check/verify.mjs`:

1. **Run everything in one self-contained PowerShell script.** Background
   processes started via the agent's background shell can be killed by the
   harness; a single foreground script avoids dangling state.
2. **Server:** `PORT=3005` (avoid the dev server on 3000), then wait for
   `/api/v1/meta` (not `/healthz`, which can be slow due to the integrity scan).
3. **Browser:** Edge is available at
   `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`.
   Launch headless with:
   `--headless=new --disable-gpu --remote-debugging-port=9223 --user-data-dir=<path> --no-first-run --no-default-browser-check about:blank`.
   **Use a profile path with no spaces** (e.g. under `$env:TEMP`). If the path
   contains a space and `Start-Process` receives it unquoted, Edge fails with
   `Multiple targets are not supported in headless mode`.
   Use a **fresh/timestamped** profile dir to avoid stale lock files.
4. **Target selection:** open your own target with
   `PUT http://127.0.0.1:9223/json/new?about:blank` and connect to that. Do not
   grab an arbitrary existing tab (the user may have real tabs or an Edge sync
   dialog open).
5. **Login:** do not call `logout()` on a fresh page (it produces a noisy `401`).
   Use `Network.clearBrowserCookies` via CDP, then navigate to `#/login`.
   For the local teacher, read `BOOTSTRAP_TEACHER_USER`/`BOOTSTRAP_TEACHER_PASS`
   from `.env` with `dotenv`; do not print the password.
6. **Determinism:** for notification flows, clear
   `notification_recipients`/`notifications` in `data/league.db` before starting
   the server so the unread count is predictable. This mutates only the local
   dev DB.
7. **Checks:** measure
   `document.documentElement.scrollWidth - clientWidth` at 390px and 360px;
   assert `0`. Collect `Runtime.exceptionThrown`, `Runtime.consoleAPICalled`
   (`error`/`warning`) and `Log.entryAdded`; filter only harness noise.
8. **Cleanup:** stop the server by PID. Kill **only** the headless browser tree
   whose command line contains your private profile prefix (e.g.
   `notif-edge-check-`), via `Get-CimInstance Win32_Process`. **Never** kill all
   `msedge` processes — that would close the user's real browser.
9. Delete heavy browser profile directories from the repo afterwards. If a
   profile is left inside `artifacts/`, `eslint .` will scan thousands of
   browser JS files and report bogus errors.

Important gotchas:

- CDP over WebSocket: wait for `open`, then send `{ id, method, params }`;
  resolve a `pending` map on matching ids.
- `Page.navigate` waits are not automatic; poll a DOM selector with a timeout.
- `window.location.hash = '#/route'` is enough for SPA navigation; wait for the
  view selector afterwards.
- Manual screenshots are useful evidence but are not a substitute for
  assertions/measurements.

---

## 10. README synchronization

The README is the product documentation and is expected to stay current. When
adding a feature, update the relevant parts:

- Highlights tables (teacher/platform/student areas) — one concise row.
- Data model table — new tables/columns.
- API reference — new endpoints with body/response.
- Testing section — counts, suite table row, manual verification checklist.
- Known limitations / delivery notes when a design decision has a boundary
  (e.g. browser notifications only while the tab is open).

Keep the counts in README identical to the actual `npm test` output.

---

## 11. Git, commits and push

- Branch: `main`, tracks `origin/main`
  (`https://github.com/Asgh24/student-league.git`).
- Use Conventional Commits, matching existing history:
  - `feat(notifications): add an in-site notification centre`
  - `feat(student): add read-only league history`
  - `fix(ui): …`
  - `feat(pwa): …`
- Scope examples: `ui`, `mobile`, `student`, `students`, `pwa`, `notifications`,
  `backup`, `sms`.
- Commit only after lint + tests (+ UI verification for UI changes) are green.
- Push only after a successful commit: `git push origin main`.
- After any push, remind the user about Parspack **Redeploy/Restart** and
  **Ctrl+F5**. For a docs-only change, say a redeploy is not required but keep
  the reminder habit.
- `.gitattributes` normalizes text to **LF** in the repo; CRLF warnings from git
  are expected on Windows and are not a problem.

---

## 12. Common pitfalls and lessons learned

1. **`Number(null) === 0`** — never use bare `Number.isFinite` to validate an id
   that may be `null`/empty. Require an integer `> 0`.
2. **Contacts vs students** — `contactsList()` returns contact rows, not
   necessarily the full student row shape. For notification targets/`user_id`,
   query the `students` table directly (`user_id`, `parent_phone`, `name`).
3. **Bell badge after login** — polling alone is not enough; refresh the badge
   in `renderShell()` when a user is present.
4. **Drawer badge liveness** — `updateNotificationsBadge` updates
   `[data-notify-badge]` immediately but does not `emit()`. That is intentional;
   don't add an emit that could loop.
5. **Unused imports are lint failures** (e.g. `can`/`isAssistant` in the inbox
   before compose gating). Use them or remove them.
6. **`Start-Process` + paths with spaces** split into multiple arguments. Use a
   space-free temp path or quote the argument explicitly.
7. **Edge headless** rejects multiple targets; a stray unquoted path looks like
   an extra URL.
8. **Stale browser profile** can block a second launch; use a timestamped dir.
9. **Do not kill all `msedge.exe`** during cleanup; target only your profile.
10. **ESLint scans `artifacts/`** if browser profiles are left there. Keep the
    repo tree clean; put profiles under `$env:TEMP`.
11. **Background processes may be killed by the harness.** Run long verification
    (server + browser + script) inside one foreground command with `try/finally`.
12. **Zod query coercion** — `?unread=1` arrives as a string. Use a
    `preprocess` that recognizes `true`, `'1'`, `'true'`.
13. **No service worker** — consistent with the PWA shortcut decision. Don't add
    one for notifications/push without explicit approval.
14. **Students without login** still matter for SMS; do not silently drop them.
    Return them as `skipped` with a reason.
15. **Admin ≠ user** — admin sessions must not be treated as `users` rows for
    fan-out; admin broadcasts target `users` (teachers/students).
16. **Assistants must be scoped** — they can only touch their assigned league
    and only sections the owner granted.
17. **Route additions need matching nav/guard/badge changes** and a module-link
    check (lazy import export names must exist).
18. **ReadWriteOnce disk + rolling update** — the production PVC can attach to one
    node only. A Deployment rollout that starts the new pod before the old one is
    gone deadlocks with `FailedAttachVolume` / `Multi-Attach` when the pods land on
    different nodes. The app did not crash; the new pod never started. Keep
    replicas 1 with the `Recreate` strategy, never trigger two rollouts in a row,
    and do not redeploy a docs-only commit. Recovery steps are in
    `DEPLOY-PARSPACK.md` §6.1.

---

## 13. Do-not-break checklist (regression-sensitive behavior)

- Auth/CSRF: login, logout, single CSRF retry on `INVALID_CSRF`.
- Subscription gate: expired teacher → `402 SUBSCRIPTION_REQUIRED` and redirect
  to renewal; `requireTeacherAccount` only for payment/renewal endpoints.
- Ownership isolation: teacher A cannot read/write teacher B's league; students
  are blocked from teacher endpoints.
- Assistant permissions: every section is gated; owner always has all.
- SMS outbox: no credentials → rows remain `queued`, never silently lost.
- Parent contact: only `students.parent_phone`; no parent site login.
- XSS: user content inserted only as text.
- Offline: no external asset requests.
- Mobile: 360px with 0 horizontal overflow.
- Notifications: per-user read/delete isolation; teacher cannot target another
  league; admin broadcast is admin-only; assistant compose needs permission.
- Lazy routes and `moduleLinks` test: every import/export name resolves.

---

## 14. Environment and local dev notes

- `.env` is loaded by `dotenv` at boot; `config.js` is the single source of
  runtime settings.
- `DATA_DIR` defaults to `./data`; the local DB is `data/league.db`.
- `PORT` defaults to `3000`; use `3005` for verification to avoid colliding with
  a running dev server.
- Boot applies all pending migrations automatically. Running the server is
  enough; `npm run migrate` is optional.
- The local DB may be bootstrapped (teacher display name «مدیر») rather than
  seed-created; its password is `BOOTSTRAP_TEACHER_PASS`, not `teacher1234`.
- `npm run seed` is idempotent but refuses in production; it will not overwrite
  an existing teacher password.
- `artifacts/` contains historical audit scripts/screenshots from previous
  sessions. Treat it as read-only evidence and keep it untracked.

---

## 15. Quick pre-flight checklist

Before editing:

- [ ] Read this file and the relevant README section.
- [ ] Check `git status`; note existing user changes and never discard them.
- [ ] For schema changes, add a new migration and register it.

Before claiming done:

- [ ] `npm run lint` → clean.
- [ ] `npm test` → all green; update README counts.
- [ ] UI flow verified at 390px and 360px (0 overflow, 0 console issues).
- [ ] Secrets/data/artifacts not staged.
- [ ] Conventional commit; push; post-push reminder.

---

## 16. Current notification API summary (for quick reference)

```
GET    /api/v1/notifications?page=&limit=&unread=
GET    /api/v1/notifications/unread
POST   /api/v1/notifications/:id/read
POST   /api/v1/notifications/read-all
DELETE /api/v1/notifications/:id
GET    /api/v1/leagues/:id/notifications
GET    /api/v1/leagues/:id/notifications/audience
POST   /api/v1/leagues/:id/notifications
GET    /api/v1/admin/notifications
POST   /api/v1/admin/notifications
```

Teacher payload:

```json
{
  "title": "…", "body": "…", "category": "info|success|warning|urgent",
  "audience": "all|selected", "studentIds": [1, 2],
  "link": "teacher/league/1/homework", "pinned": false, "sendSms": false
}
```

Admin payload: same text fields, `audience: "all|teachers|students"`, no
`studentIds`/`sendSms`.

---

_Last updated after the in-site notification feature (commit `930ebb9`)._
_If you change a convention or discover a new footgun, update this file in the
same commit._
