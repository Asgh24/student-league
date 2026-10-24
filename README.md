# Student Comprehensive League (لیگ جامع دانش‌آموزی)

A complete, self-hosted classroom gamification platform for teachers and students.
One Node.js process serves both the REST API and the (build-free) frontend, so it
runs on any plain Node.js host — including Iranian PaaS providers and small VPSs.

Everything is Persian and RTL by default, works offline (no CDN, no Google Fonts,
no telemetry), and stores all data in a single SQLite file inside a persistent
`DATA_DIR`.

---

## Table of contents

1. [Highlights](#highlights)
2. [Tech stack](#tech-stack)
3. [Requirements](#requirements)
4. [Quick start (local)](#quick-start-local)
5. [Environment variables](#environment-variables)
6. [Commands](#commands)
7. [Project structure](#project-structure)
8. [Data model](#data-model)
9. [API reference](#api-reference)
10. [Security](#security)
11. [Testing](#testing)
12. [Manual verification checklist](#manual-verification-checklist)
13. [Deployment](#deployment)
    * [Parspack / Iranian PaaS walkthrough → `DEPLOY-PARSPACK.md`](DEPLOY-PARSPACK.md)
14. [Backup and restore](#backup-and-restore)
15. [Default credentials](#default-credentials)
16. [Known limitations](#known-limitations)

---

## Highlights

**Teacher area** – dashboard «میزکار معلم» with the classroom tools included in every plan:

| Tool | What it does |
| --- | --- |
| لیگ انفرادی | Students, dynamic score columns, staged per-row editing, totals, ranks, championship medals, per-change history. The table pins the rank/name (right) and total/commit (left) columns so the score grid can be filled without hunting for the ✓ button; the remaining per-student actions live in the profile dialog |
| لیگ تیمی | Teams, standings, manual adjustments, "no team" assignment panel, optional member-average scoring |
| حضور و غیاب | Daily present/absent/late sheet, "mark all present", Persian date picker, per-student ratios, history |
| قرعه‌کشی | Cryptographic random picker with "exclude previous", animated draw and history |
| نماینده کلاس | Fair representative picker: every student gets exactly one turn per cycle, with progress, remaining count, full status, cycle history, undo-last and reset. Includes a copy-ready class announcement and a projector board (`#/teacher/league/:id/representative/board`) that refreshes automatically |
| تابلوی زنده | Full-screen polling leaderboard for a projector |
| تایمر و ابزار | Countdown / stopwatch with a WebAudio alert |
| گردونه شانس | Canvas lucky wheel with teacher-editable segments |
| سوال و پاسخ | Teacher multiple-choice questions (2–10 options + correct answer), legacy text questions, student answers and manual point awards |
| تکالیف | Homework with due dates and per-student done/not-done |
| ارزشیابی دروس | Course evaluations: مقطع + پایه, exam title, numeric marks (۰–۲۰) or descriptive levels, per-student mark sheet with quick-fill, and an optional «تنظیمات امتیازدهی» mapping that turns marks into league points |
| برنامه هفتگی | Saturday→Friday weekly schedule grid |
| ارسال فایل | Uploaded files shared with the class, downloaded safely. Every teacher has one **70 MB** pool across all leagues; a new upload is rejected with a clear Persian message when it would exceed the pool, and deleting old files frees the space immediately |

**Platform area** – multi-teacher SaaS features built into the same process:

| Area | What it does |
| --- | --- |
| ثبت‌نام معلم | Self-service signup on the login screen; every new teacher starts a configurable **14-day trial** with all tools unlocked |
| اشتراک من | Trial/subscription banner, remaining days, admin-editable plans, Zarinpal checkout and payment history; an expired teacher is redirected here instead of seeing a broken dashboard |
| پنل مدیر | Separate site-owner login: teacher search/filter, manual subscription grants, plan CRUD, revenue and payment ledger, inbox/SMS health, and a backup/restore console. The «حذف منقضی‌ها» tab lists teachers whose trial and paid subscription have both ended and lets the owner permanently delete an account after typing its username; leagues, students, linked student logins, scores, uploads and payment history are removed with it |
| بکاپ و بازیابی | Owner-only manual GitHub backup, consistent local DB download, remote snapshot list, staged restore with checksum verification and cancel; auto-restores an empty/schema-only DB on boot |
| پیام‌ها | Ticket-like teacher↔student inbox with threads, unread counters, read receipts and polling; both sides can reply from the same shared view |
| پنل پیامک | Per-teacher sms.ir API key + line number in the teacher's own panel (encrypted, write-only), a built-in «راهنمایی راه‌اندازی سامانه پیامکی» guide with annotated screenshots, credit/lines, test and bulk sends, the daily parent report, a free-text «پیام دلخواه به والدین» box for notices such as a student's misbehavior, league-report outbox and admin campaign retry; without credentials everything stays queued instead of being lost |
| دستیار هوش مصنوعی | In the Q&A page, drafts multiple-choice quizzes/questionnaires through Groq (`openai/gpt-oss-20b`), shows a reviewable preview and bulk-saves only the selected questions; supports a server-wide default key plus an encrypted, write-only personal teacher key |
| پرداخت‌ها | Zarinpal v4 request/verify (Rial conversion, sandbox support) and a local `mock` gateway for development before a merchant ID exists |

**Student area** – tabs: میزکار, کارنامه, ارزشیابی, حضور و غیاب, تیم من, تاریخچه, رده‌بندی, لایک, سوال و پاسخ, پیام‌ها, تنظیمات.
The کارنامه tab carries a profile band, subject + date-range filters, one line per
recorded score session (subject, teacher topic, date, points, derived quality) and
the per-subject totals table + chart.
The dashboard greets the student, shows points / rank / championships, and draws a
points-over-time Chart.js line chart built from the append-only score history using
Jalali date labels.

**Operations** – one process, one SQLite file, migrations applied on boot, a first
account bootstrapped into an empty production database, and scheduled off-site
snapshots pushed to a **private GitHub repository**, restored automatically when a
PaaS recreates the container filesystem (`DEPLOY-PARSPACK.md`).

Other properties: multiple leagues per teacher (create, rename, complete → final
ranking + titles, reactivate), per-league countdown timer, Persian-aware search
(`ي`=`ی`, `ك`=`ک`, ZWNJ-insensitive), optional Persian digits, fully responsive
layout from 360 px up (below 700 px the score table pins only the name and the
commit button so the cells get the width, and touch targets grow), keyboard-accessible
dialogs and focus trapping, CSRF protection, bcrypt password hashing, strict
per-endpoint authorization.

---

## Tech stack

| Layer | Choice |
| --- | --- |
| Runtime | Node.js **22+** (tested on 26), ES modules |
| HTTP | Express 5 |
| Database | SQLite via **better-sqlite3** (WAL, `foreign_keys = ON`, transactions) |
| Sessions | `express-session` + a small custom SQLite store |
| Validation | zod on every endpoint |
| Security | helmet (CSP + `frame-ancestors 'none'`), bcryptjs, express-rate-limit, synchronizer-token CSRF |
| Frontend | Vanilla HTML/CSS/ES modules, hash routing, **no build step** |
| Charts / fonts | Chart.js + Vazirmatn woff2 vendored in `public/vendor` |
| Tests | Vitest + supertest (backend) and jsdom (frontend) |

---

## Requirements

* Node.js 22 or newer (`node -v`) — `better-sqlite3` 13 declares `>=22`, and no
  compiler is needed because its prebuilt binary ships inside the npm package
* npm 10+
* No database server, no Docker requirement, no internet access at runtime

---

## Quick start (local)

```bash
# 1. install dependencies
npm install

# 2. create your environment file
cp .env.example .env          # Windows: copy .env.example .env
#    then edit SESSION_SECRET and DATA_DIR (see the table below)

# 3. create the SQLite schema (also runs automatically on boot)
npm run migrate

# 4. optional: insert demo data (22 students, sample history)
npm run seed

# 5. start
npm start                     # http://localhost:3000
```

`npm run dev` starts the same server under nodemon for development.

Open `http://localhost:3000` and sign in with the [default credentials](#default-credentials).

The frontend assets in `public/vendor` are already committed, so `npm run vendor`
is only needed if you upgrade Chart.js or the Vazirmatn font package.

---

## Environment variables

Environment loading order (later sources never overwrite an existing variable):

1. Variables injected by the shell, Docker or the PaaS panel.
2. `ENV_FILE` or `DOTENV_CONFIG_PATH`, when set, selects one explicit file.
3. In production, `production.env` next to `server.js` is read when it exists.
4. Otherwise `.env` is read (local development and legacy deployments).

`production.env` and `.env` are both git-ignored. On a PaaS the panel variables
are safer because the file has to be uploaded separately; on a VPS you can keep
`production.env` beside `server.js` or rename it to `.env`.

| Variable | Default | Notes |
| --- | --- | --- |
| `NODE_ENV` | `development` | Set to `production` on a server (enables secure cookies, hides stack traces) |
| `PORT` | `3000` | Some PaaS providers inject their own value — do not override it there |
| `HOST` | `0.0.0.0` | Bind address |
| `APP_NAME` | `لیگ جامع دانش‌آموزی` | Brand shown in the topbar, page title and `/meta` |
| `APP_BASE_URL` | `http://localhost:$PORT` | Public origin used for payment callbacks and post-payment redirects. **Must match the real public URL in production** |
| `TRIAL_DAYS` | `14` | Free full-access days granted to every self-registered teacher (1–365) |
| `ADMIN_ENABLED` | `true` | Creates/uses the site-owner account from the `ADMIN_*` variables |
| `ADMIN_USERNAME` | `admin` | Site-owner login name |
| `ADMIN_PASSWORD` | `admin1234` in development only | **Required in production** before the admin account is created |
| `ADMIN_NAME` | `مدیر سامانه` | Display name in the owner panel |
| `PAYMENT_PROVIDER` | `mock` in development, `zarinpal` in production | `card` enables manual card-to-card receipts; `mock` renders a local no-money checkout; `zarinpal` calls the official v4 API |
| `ZARINPAL_MERCHANT_ID` | — | Merchant ID from the Zarinpal panel; required for real payments |
| `ZARINPAL_SANDBOX` | `false` | Use `sandbox.zarinpal.com` for testing |
| `ZARINPAL_BASE_URL` | auto | Override `payment.zarinpal.com` / `sandbox.zarinpal.com` |
| `ZARINPAL_TIMEOUT_MS` | `15000` | Timeout of one Zarinpal request |
| `DATA_DIR` | `./data` | **Must be a persistent volume.** Holds the database, `uploads/` and `backups/` |
| `SESSION_SECRET` | — | **Required in production**, at least 16 characters |
| `SECRETS_KEY` | falls back to `SESSION_SECRET` | Stable AES key for teacher-saved sms.ir/Groq keys. Set once; changing it makes restored encrypted keys unreadable |
| `SESSION_COOKIE_NAME` | `scl.sid` | Session cookie name |
| `SESSION_MAX_AGE_MS` | `86400000` | Session lifetime: 24 hours from login (activity does not extend it) |
| `TRUST_PROXY` | `false` | `true` behind a reverse proxy / PaaS load balancer so `secure` cookies and client IPs work |
| `APP_TZ_OFFSET_MINUTES` | `210` | Minutes east of UTC for "today" and Jalali dates (Iran = UTC+03:30) |
| `SEED_ENABLED` | `true` | Allows demo seeding (never runs in production) |
| `SEED_ON_BOOT` | — | `false` disables automatic seeding on an empty dev database |
| `SEED_TEACHER_USER` / `SEED_TEACHER_PASS` | `teacher` / `teacher1234` | Demo teacher created by `npm run seed` |
| `SEED_DEMO_PASS` | `student1234` | Demo student password |
| `BOOTSTRAP_TEACHER` | `true` in production | Creates the first teacher when the database has **no accounts at all** |
| `BOOTSTRAP_TEACHER_USER` | `SEED_TEACHER_USER` or `teacher` | Username of that first account |
| `BOOTSTRAP_TEACHER_PASS` | — | Required for the first account; short or demo-default values are refused |
| `BOOTSTRAP_TEACHER_NAME` | `مدیر` | Display name of that first account |
| `BOOTSTRAP_ALLOW_WEAK` | `false` | Allows a demo-default password (don't) |
| `LOGIN_RATE_LIMIT` | `10` | Failed-login attempts per window per IP |
| `API_RATE_LIMIT` | `1200` | API requests per window per IP |
| `RATE_WINDOW_MS` | `900000` | Rate-limit window (15 minutes) |
| `MAX_UPLOAD_BYTES` | `10485760` | Upload size limit per file (10 MB) |
| `TEACHER_STORAGE_MB` | `70` | Total file storage shared by each teacher across all leagues |
| `MAX_RECEIPT_BYTES` | `5242880` | Card-receipt image limit (5 MB, capped by `MAX_UPLOAD_BYTES`) |
| `LIKES_PER_DAY` | `10` | Likes a student may give per day |
| `BODY_LIMIT` | `512kb` | JSON body limit |
| `LOG_LEVEL` | `debug` | `debug` \| `info` \| `warn` \| `error` |
| `GROQ_API_KEY` | — | Shared default Groq key for the Q&A AI assistant; teachers can override it with an encrypted personal key |
| `GROQ_BASE_URL` | `https://api.groq.com/openai/v1` | Groq-compatible API base URL |
| `GROQ_MODEL` | `openai/gpt-oss-20b` | Model used to draft multiple-choice questions |
| `GROQ_TIMEOUT_MS` | `45000` | Timeout of one generation request |
| `GROQ_MAX_COMPLETION_TOKENS` | `4096` | Upper bound for one generated batch |
| `SMS_ENABLED` | auto | Server-wide fallback for teachers who have not saved their own settings; defaults to `true` only when the key **and** line number are set |
| `SMSIR_API_KEY` | — | Optional fallback sms.ir REST API key (`X-API-KEY` header); teachers normally enter their own in the panel |
| `SMSIR_LINE_NUMBER` | — | Optional fallback sms.ir sender line number used by `POST /v1/send/bulk` |
| `SMSIR_BASE_URL` | `https://api.sms.ir` | Override for a proxy or test server |
| `SMS_TIMEOUT_MS` | `15000` | Timeout of one provider request |
| `BACKUP_DIR` | `$DATA_DIR/backups` | Output directory of `npm run backup` |
| `BACKUP_GITHUB_ENABLED` | `false` | Uploads snapshots to GitHub on an interval |
| `BACKUP_GITHUB_REPO` | — | `owner/name` of a **private** repository that holds the snapshots |
| `BACKUP_GITHUB_TOKEN` | — | Fine-grained token with **Contents: read and write** on that repo |
| `BACKUP_GITHUB_BRANCH` / `BACKUP_GITHUB_DIR` | `main` / `db-backups` | Where snapshots are stored |
| `BACKUP_GITHUB_FILE_PREFIX` | `league` | Snapshot file prefix (`league-<stamp>.db`) |
| `BACKUP_GITHUB_INTERVAL_MINUTES` | `1440` | How often a snapshot is uploaded (minimum 5) |
| `BACKUP_GITHUB_KEEP` | `7` | Delete all but the newest N snapshots (`0` keeps everything) |
| `BACKUP_GITHUB_START_DELAY_MS` | `60000` | Wait after boot before the first upload |
| `BACKUP_GITHUB_MAX_MB` | `50` | Refuse snapshots above this size (GitHub rejects >100 MB) |
| `BACKUP_GITHUB_ALLOW_PUBLIC` | `false` | Permit a public target repo (the snapshot holds student data) |
| `BACKUP_GITHUB_API_URL` | `https://api.github.com` | For tests or GitHub Enterprise |
| `RESTORE_FROM_GITHUB_ON_EMPTY_LOCAL` | `true` | On boot, replace a database with **no users and no leagues** (including a schema-only file) with the newest snapshot |

Generate a secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Commands

| Command | Purpose |
| --- | --- |
| `npm install` | Install dependencies |
| `npm start` | Run the server (`node server.js`) |
| `npm run dev` | Run with nodemon |
| `npm run migrate` | Apply pending migrations and exit |
| `npm run seed` | Insert idempotent demo data and exit (refuses in production) |
| `npm run bootstrap` | Create the first teacher account (or `-- --force` to reset its password) |
| `npm run backup` | Consistent SQLite snapshot into `$DATA_DIR/backups` |
| `npm run backup:github` | Upload a snapshot to the configured GitHub repository right now |
| `npm run backup:status` | Show what is stored remotely (count, newest, checksum) |
| `npm run vendor` | Re-copy Chart.js and the Vazirmatn woff2 files into `public/vendor` |
| `npm test` | Run the full Vitest suite |
| `npm run test:watch` | Vitest in watch mode |
| `npm run lint` | ESLint (flat config) |

Migrations also run automatically on server boot, so `npm start` alone is enough
on a fresh volume.

---

## Project structure

```
├── public/                     # static frontend (served as-is, no build step)
│   ├── css/                    # base.css (layout/RTL), components.css (UI kit)
│   ├── js/
│   │   ├── views/              # teacher + student screens, one module per screen
│   │   │   ├── admin/          # owner panel: dashboard, teachers, plans, payments, SMS
│   │   │   └── student/        # student portal screens
│   │   ├── api.js              # fetch wrapper, CSRF handling, error mapping
│   │   ├── charts.js           # Chart.js helpers (points-over-time line chart)
│   │   ├── dom.js              # XSS-safe element builder + escaping helpers
│   │   ├── format.js           # Persian digits, numbers, dates
│   │   ├── jalali.js           # Jalali (Solar Hijri) conversions, client side
│   │   ├── main.js             # route table, boot, drawer navigation
│   │   ├── normalize.js        # Persian-aware search normalization
│   │   ├── router.js           # tiny hash router
│   │   ├── shell.js            # topbar / drawer / view shell
│   │   ├── store.js            # shared session state
│   │   └── ui.js               # toasts, modals, confirm/form dialogs
│   └── vendor/                 # Chart.js bundle + Vazirmatn woff2 (committed)
├── scripts/                    # migrate / seed / bootstrap / backup / vendor CLIs
├── src/
│   ├── lib/                    # errors, http helpers, jalali, normalize, random, zod schemas, github API client
│   ├── middleware/             # session, auth, ownership, csrf, rateLimit, errorHandler
│   ├── migrations/             # versioned, auto-applied schema migrations
│   ├── repositories/           # data access for users, admins and leagues
│   ├── routes/                 # one Express router per resource (admin, payments, messages…)
│   ├── services/               # scoring, attendance, teams, subscriptions, payments, SMS, off-site backups
│   ├── app.js                  # Express app (helmet, session, routers, SPA fallback)
│   ├── bootstrap.js            # first teacher account for an empty (production) database
│   ├── config.js               # env parsing and lazy config getters
│   ├── db.js                   # better-sqlite3 connection (WAL, foreign keys)
│   ├── logger.js               # structured JSON logger
│   ├── migrate.js              # migration runner
│   ├── seed.js                 # idempotent demo seed
│   └── version.js              # version read from package.json
├── tests/                      # Vitest suites + helpers/fixtures
├── .env.example
├── DEPLOY-PARSPACK.md          # step-by-step PaaS deployment + backup setup
├── Dockerfile                  # node:22-alpine, non-root, prod deps only
├── .dockerignore
├── server.js                   # boot (restore → migrations → bootstrap → listen), graceful shutdown
└── vitest.config.js
```

---

## Data model

Created and upgraded by versioned migrations on boot (`src/migrations/`).

| Table | Purpose |
| --- | --- |
| `users` | Teachers and students; bcrypt hash, role, display name, persian-digits flag, trial/subscription window and plan reference; teachers also hold their encrypted `sms_api_key`, `sms_line_number`, `sms_updated_at`, `groq_api_key` and `groq_updated_at` |
| `admins` | Site-owner accounts stored separately so `/admin/*` can never be reached by a teacher or student session |
| `subscription_plans` | Admin-editable plans: name, days, Toman price, description, active flag, sort order |
| `payments` | Subscription ledger: teacher, plan snapshot, amount/days, status, provider, authority/ref id, timestamps, admin note, card receipt text/image metadata and review fields |
| `payment_settings` | Single row with the admin-published destination card number/holder/bank/instructions |
| `conversations` | One teacher↔student thread (`UNIQUE(teacher_id, student_id)`) with subject and last-message time |
| `messages` | Thread messages with sender role and `read_at` for unread counts |
| `sms_campaigns` | Admin test/bulk SMS rows (queued/sent/failed), kept separately from league-report outbox rows |
| `leagues` | One or more per teacher; status `active`/`completed`, final ranking JSON |
| `students` | League members, optional link to a `users` row for login |
| `columns` | Dynamic score columns per league (name, step, position) |
| `scores` | One row per student × column (current points) |
| `score_history` | Append-only log: student, column, delta, reason, actor, total after |
| `teams`, `team_members` | Teams and their members (a student belongs to at most one team) |
| `team_points_adjustments` | Manual ± adjustments with reason and actor |
| `championships` | Medals/titles; `source` = `manual` or `league_completed` |
| `attendance` | One row per student × day with `present`/`absent`/`late` |
| `homework`, `homework_status` | Assignments and per-student done/not-done |
| `questions`, `answers` | Q&A: teacher questions (optional JSON `options_json` + `correct_index` for multiple-choice, empty for legacy text), student answers (`selected_index` for a chosen option), awarded points |
| `schedule` | Weekly grid slots (day, period, subject, note) |
| `files` | Upload metadata; bytes live in `DATA_DIR/uploads` under random names |
| `raffle_history` | Who was picked, when, and the reason |
| `representative_cycles` | «نماینده کلاس» rounds per league: start/completion timestamps and the next cycle number |
| `representative_history` | One row per student per representative cycle; the student name is kept so deleting a student does not erase history |
| `likes` | Per-day student-to-student likes (quota enforced) |
| `league_settings` | `individualAffectsTeam`, late/absent penalties, `grade` (نام پایه نمایش‌داده‌شده روی کارنامه) and the evaluation scoring keys (`evalPointsEnabled` + four point values) |
| `evaluations` | Course evaluations: subject, exam title, `level` (مقطع), `grade` (پایه), `kind` (`numeric`/`descriptive`), scale, `held_on`, optional link to a score column that receives the mapped points |
| `evaluation_scores` | One row per student × evaluation: `score` (numeric) or `label` (descriptive level), plus `awarded_points` / `awarded_column_id` (what was last added to the league); a cleared mark deletes the row |
| `timers` | League countdown end timestamp |
| `sessions` | Session store (also created by a migration) |

Indexes cover the hot paths (per-league/per-student lookups) and every foreign key
declares an explicit `ON DELETE` rule (`CASCADE` for owned rows, `SET NULL` where a
record must survive).

### Report card sessions and derived quality

The student **کارنامه** is built from two sources. The per-subject totals come from the
`scores` table (one row per student/column). Each line of the term report, called a
*session*, is one row of the append-only `score_history`: its subject, the teacher's
topic (the free-text `reason`, e.g. `هفته ۴` or `روان‌خوانی درس ۳`), the date, the
awarded points and the teacher who recorded it. Because a single commit writes one
history row per column, one class session naturally produces one card per subject.

Quality is **derived**, never stored, from the size of the change relative to the
subject's `step` (its usual point value, default 25):

| Ratio (`delta / step`) | Label | Icon |
| --- | --- | --- |
| `delta < 0` | کسر امتیاز | ⚠️ |
| `2 ≤ ratio` | عالی | 🌟 |
| `1 ≤ ratio < 2` | خیلی خوب | 💎 |
| `0.5 ≤ ratio < 1` | خوب | 👍 |
| `0 < ratio < 0.5` | قابل قبول | 🙂 |

The grade line (پایه) is a league setting (`league_settings.grade`) that the teacher
edits in the league page, so the same report-card layout works for any class.

### Course evaluations and league points

**ارزشیابی دروس** records exam marks separately from the gamified league. A teacher
picks the مقطع (پیش‌دبستانی/ابتدایی/متوسطهٔ اول/متوسطهٔ دوم), the matching پایه, the
subject, an exam title and a date, and chooses the kind:

* **کمی (numeric)** — a mark inside `[scaleMin, scaleMax]`, ۰–۲۰ by default. The mark
  sheet offers «نمرهٔ کامل», «صفر» and «پاک کردن همه» quick-fill buttons.
* **توصیفی (descriptive)** — one of خیلی خوب / خوب / قابل قبول / نیاز به تلاش.

Numeric marks are banded with the usual Iranian convention (ratio to the maximum):
`1` → عالی, `≥0.9` → خیلی خوب, `≥0.75` → خوب, `≥0.5` → قابل قبول, otherwise نیاز به تلاش.
The student's ارزشیابی tab shows only its own mark, the class average and its rank —
never another student.

**Mark → league points (optional).** The «تنظیمات امتیازدهی» card on the same page
maps each qualitative level to a fixed number of league points (defaults: خیلی خوب
۱۰۰، خوب ۲۵، قابل قبول ۲۵−، نیاز به تلاش ۵۰−) and has a small ۰–۲۰ calculator
(۹.۹۹ → ۵۰−). It can be switched off; while off, marks stay out of the league.

When it is on and the subject matches a score column, saving a mark writes the
difference to that column through the same `applyScoreDelta` path as manual
scoring, with a history reason like «ارزشیابی «آزمون فصل ۲»». The applied value is
stored per mark (`evaluation_scores.awarded_points` / `awarded_column_id`), so a
re-save never double-counts and clearing a mark, disabling scoring, changing the
mapping, relinking the subject to another column or deleting the evaluation
reverses the previously awarded points. All of it runs in the same transaction as
the change that triggered it.

---

## API reference

Base URL: `/api/v1` — the only endpoint outside it is `GET /healthz`, which needs
no session. Request and response bodies are JSON; state-changing requests must
send the session's CSRF token in the `x-csrf-token` header.

Errors always use the same shape and an appropriate status code:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "داده ورودی نامعتبر است", "details": [{ "path": "name", "message": "..." }] } }
```

Roles: **public** (no session), **auth** (any signed-in user), **teacher**
(role `teacher`, ownership of the addressed league enforced), **student**
(role `student`, only ever sees its own data).

Pagination: list endpoints accept `?page=1&limit=50` and answer
`{ items, total, page, limit }`.

### Health and metadata

| Method | Path | Role | Body / query | Response |
| --- | --- | --- | --- | --- |
| GET | `/healthz` | public | — | `{ status, app, version, env, database{ ok, integrity }, uptimeSeconds, time }` |
| GET | `/meta` | public | — | `{ appName, version, timezoneOffsetMinutes, likesPerDay, maxUploadBytes, trialDays, paymentProvider }` |

### Authentication

| Method | Path | Role | Body | Response |
| --- | --- | --- | --- | --- |
| GET | `/auth/csrf` | public | — | `{ csrfToken }` |
| GET | `/auth/me` | public | — | `{ user \| null, csrfToken }` |
| POST | `/auth/login` | public | `{ username, password }` | `{ user, csrfToken }` — also accepts the site owner |
| POST | `/auth/register` | public | `{ displayName, username, password }` | `201 { user, csrfToken, trialDays }` — teacher self-signup with a trial |
| POST | `/auth/logout` | auth | — | `{ ok: true }` |
| POST | `/auth/password` | auth | `{ currentPassword, newPassword }` | `{ ok: true }` — works for teachers and the owner |

### Leagues (teacher)

| Method | Path | Body / query | Response |
| --- | --- | --- | --- |
| GET | `/leagues` | — | `{ items: [{ id, name, status, createdAt, completedAt, studentCount, teamCount }] }` |
| POST | `/leagues` | `{ name }` | `201 { league, settings }` |
| GET | `/leagues/:id` | — | `{ league{ ..., finalRanking }, settings, timer, summary, teacher }` |
| PATCH | `/leagues/:id` | `{ name?, status? }` | `{ league }` |
| DELETE | `/leagues/:id` | — | `{ ok: true }` |
| POST | `/leagues/:id/complete` | — | `{ league, ranking: [top 10 with titles] }` |
| POST | `/leagues/:id/reactivate` | — | `{ league }` |
| GET | `/leagues/:id/settings` | — | `{ settings }` |
| PUT | `/leagues/:id/settings` | `{ individualAffectsTeam?, latePenalty?, absentPenalty? }` | `{ settings }` |
| GET | `/leagues/:id/summary` | — | `{ summary{ students, presentToday, absentToday, lateToday, unmarkedToday, averageScore, teamCount, columnCount } }` |
| GET | `/leagues/:id/ranking` | — | `{ items: [{ rank, studentId, name, total, title }], total }` |
| GET | `/leagues/:id/timer` | — | `{ timer{ endsAt, durationSeconds, remainingMs, expired } }` |
| PUT | `/leagues/:id/timer` | `{ days, hours, minutes, seconds }` | `{ timer }` |
| POST | `/leagues/:id/timer/adjust` | `{ days }` (non-zero; needs an existing timer) | `{ timer }` |
| DELETE | `/leagues/:id/timer` | — | `{ timer }` (cleared) |
| GET | `/leagues/:id/live` | — | `{ league, teacher, timer, students[{ rank, studentId, name, total, title }], teams[{ rank, name, label, points, members }], updatedAt }` |

### Students (teacher)

| Method | Path | Body / query | Response |
| --- | --- | --- | --- |
| GET | `/leagues/:id/students` | `?search=` | `{ items, total }` |
| POST | `/leagues/:id/students` | `{ name, username?, password? }` | `201 { student }` |
| GET | `/students/:id` | — | `{ student{ ..., reportCard, championships, history, attendance } }` |
| PATCH | `/students/:id` | `{ name }` | `{ ok, student }` |
| DELETE | `/students/:id` | — | `{ ok: true }` |
| POST | `/students/:id/password` | `{ password }` | `{ ok: true }` |
| POST | `/students/:id/championships` | `{ title, rank }` | `201 { championship, championships }` |
| DELETE | `/students/:id/championships` | — (removes the most recent one) | `{ removed, championships }` |
| GET | `/students/:id/ranking` | — | `{ items, total }` |

### Score columns and scores (teacher)

| Method | Path | Body / query | Response |
| --- | --- | --- | --- |
| GET | `/leagues/:id/columns` | — | `{ items: [columns in order] }` |
| POST | `/leagues/:id/columns` | `{ name, step? }` | `201 { column }` |
| PATCH | `/columns/:id` | `{ name?, step?, position? }` | `{ column }` |
| DELETE | `/columns/:id` | `?mode=keep\|discard` | `{ ok, mode, removedScores }` |
| GET | `/columns/:id` | — | `{ column, stats }` |
| POST | `/columns/:id/reset` | — | `{ ok, changed }` |
| GET | `/leagues/:id/scores` | — | `{ leagueId, status, settings, columns, students: [{ studentId, name, values, total, rank }] }` |
| POST | `/leagues/:id/scores/commit` | `{ studentId, changes: [{ columnId, delta }], reason? }` | `{ studentId, total, applied, student }` |
| POST | `/leagues/:id/scores/record` | `{ studentId, columnId, delta, reason? }` | `{ studentId, total, applied, student }` |
| GET | `/leagues/:id/scores/student/:studentId` | — | `{ student, columns, values, history }` |

`POST /scores/commit` is transactional: all deltas are applied atomically, totals
are recomputed on the server, and one `score_history` row is written per change.

### Teams (teacher)

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| GET | `/leagues/:id/teams` | — | `{ individualAffectsTeam, teams[{ rank, id, name, label, basePoints, individualPoints, memberAverage, memberCount, finalPoints, members }], unassigned, settings }` |
| POST | `/leagues/:id/teams` | `{ name, label? }` | `201 { team, standings }` |
| POST | `/leagues/:id/teams/assign` | `{ teamId, studentId }` | `{ members, standings, unassigned }` |
| DELETE | `/leagues/:id/teams/members/:studentId` | — | `{ standings, unassigned }` |
| PATCH | `/teams/:id` | `{ name?, label? }` | `{ team, standings }` |
| DELETE | `/teams/:id` | — | `{ ok, standings }` |
| POST | `/teams/:id/adjust` | `{ delta, reason? }` | `{ team, standings }` |
| GET | `/teams/:id/history` | — | `{ items }` |
| POST | `/teams/:id/members` | `{ studentId }` | `{ members, standings, unassigned }` |
| DELETE | `/teams/:id/members/:studentId` | — | `{ standings, unassigned }` |

Final team score = team points + (when `individualAffectsTeam` is on) the rounded
average of the members' individual totals.

### Attendance (teacher)

| Method | Path | Body / query | Response |
| --- | --- | --- | --- |
| GET | `/leagues/:id/attendance` | `?date=YYYY-MM-DD` | `{ date, today, labels, settings, counters, items }` |
| POST | `/leagues/:id/attendance` | `{ date, records: [{ studentId, status }] }` | `{ day, applied, counters, items }` |
| POST | `/leagues/:id/attendance/bulk` | `{ date, status }` | `{ day, applied, counters, items }` |
| GET | `/leagues/:id/attendance/history` | `?page=&limit=` | `{ items, total, page, limit }` |
| GET | `/leagues/:id/attendance/summary` | — | `{ today, items: [{ studentId, name, recorded, attended }] }` |

### Classroom tools (teacher)

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| POST | `/leagues/:id/tools/raffle` | `{ excludePrevious?, reason? }` | `{ winner: { studentId, name }, poolSize, remaining, cycled, history }` |
| GET | `/leagues/:id/tools/raffle/history` | — | `{ items, total }` |
| DELETE | `/leagues/:id/tools/raffle/history` | — | `{ ok, items }` |
| GET | `/leagues/:id/tools/representative` | — | `{ cycle, completed, totalStudents, selectedCount, remainingCount, percent, lastSelected, students, history, cycles }` |
| POST | `/leagues/:id/tools/representative/draw` | — | `{ winner: { historyId, studentId, name }, cycle, remaining, completed, state }` |
| POST | `/leagues/:id/tools/representative/cycle` | `{ force? }` | `{ cycle, state }` |
| DELETE | `/leagues/:id/tools/representative/last` | — | `{ removed, state }` |
| DELETE | `/leagues/:id/tools/representative/history` | — | `{ state }` |
| GET | `/leagues/:id/tools/wheel` | — | `{ segments, source }` |
| PUT | `/leagues/:id/tools/wheel` | `{ segments: [{ label }] }` | `{ segments, source }` |
| POST | `/leagues/:id/tools/shuffle` | — | `{ order: [{ studentId, name }] }` |
| GET | `/leagues/:id/tools/timer` | — | `{ timer }` |

Raffle winners are drawn with `crypto.randomInt`, and "exclude previous" cycles the
pool only after everyone has been picked. «نماینده کلاس» uses a stricter cycle:
each student can be picked once, a draw is refused with `CYCLE_COMPLETE` after
everyone has had a turn, and `force: true` is required to skip the rest of a cycle.
`last` undoes only the most recent pick, while `history` resets everything. The
teacher-only projector view at `#/teacher/league/:id/representative/board` polls
this endpoint and shows the current winner, cycle progress and this cycle's picks.

### Homework, Q&A, schedule, files (teacher)

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| GET | `/leagues/:id/homework` | — | `{ items (with done/pending counts) }` |
| POST | `/leagues/:id/homework` | `{ title, description?, dueDate? }` | `201 { homework }` |
| PATCH | `/homework/:id` | `{ title?, description?, dueDate? }` | `{ homework }` |
| DELETE | `/homework/:id` | — | `{ ok: true }` |
| GET | `/homework/:id/status` | — | `{ homework, items: [{ studentId, name, status }] }` |
| POST | `/homework/:id/status` | `{ studentId, status }` | `{ items }` |
| POST | `/homework/:id/status/bulk` | `{ status }` | `{ items }` |
| GET | `/leagues/:id/questions` | — | `{ items }` — every item has `type` (`multiple_choice`/`text`), `options[]` and `isOpen`; `correctIndex` is returned **only** to the owning teacher |
| POST | `/leagues/:id/questions` | `{ body, points?, options[2..10], correctIndex }` | `201 { question }` — multiple-choice; `correctIndex` must point to one of `options` |
| POST | `/leagues/:id/questions/bulk` | `{ questions: [{ body, points?, options[2..10], correctIndex }] }` (1–10) | `201 { items }` — one transaction, used after the AI preview is reviewed |
| DELETE | `/questions/:id` | — | `{ ok: true }` |
| POST | `/questions/:id/close` \| `/open` | — | `{ ok: true }` |
| GET | `/questions/:id/answers` | — | `{ question, items }` — teacher-only; each answer has `selectedIndex` and derived `isCorrect` (or `null` for legacy text questions) |
| POST | `/answers/:id/award` | `{ points }` | `{ answer: { id, awarded, delta } }` |
| GET | `/leagues/:id/schedule` | — | `{ slots }` |
| PUT | `/leagues/:id/schedule` | `{ slots: [{ dayIndex, period, subject, note }] }` | `{ slots }` |
| GET | `/leagues/:id/files` | — | `{ items, total, limits, storage }` — `storage` is the teacher-wide usage (`usedBytes`, `limitBytes`, `remainingBytes`) |
| POST | `/leagues/:id/files` | `multipart/form-data` (`file`, `description?`) | `201 { file, storage }`; over the shared quota returns `413 STORAGE_QUOTA_EXCEEDED` |
| GET | `/files/:id/download` | — | file bytes (`Content-Disposition: attachment`) |
| DELETE | `/files/:id` | — | `{ ok: true, storage }` — frees quota space immediately |

Questions created before the multiple-choice migration have `options: []` and
`type: "text"`; they stay readable and answerable with a free-text `body`.

### Q&A AI assistant (teacher)

The «دستیار هوش مصنوعی» button on the Q&A page drafts a multiple-choice quiz
or questionnaire with Groq. Generation is a **preview only**: nothing is
written until the teacher selects questions and the UI calls the bulk endpoint
above. The assistant uses `GROQ_API_KEY` as a shared default; a teacher can save
an encrypted personal key, which takes precedence. A cleared personal key falls
back to the server key. Keys are never returned by the API.

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| GET | `/ai/settings` | — | `{ config }` — `configured`, `source` (`teacher`/`server`/`none`), `model`, `serverConfigured`, `own{ hasApiKey, updatedAt }`; never contains the key |
| PUT | `/ai/settings` | `{ apiKey?, clearApiKey? }` | `{ config }` — a blank `apiKey` keeps the saved key; `clearApiKey: true` removes it |
| POST | `/leagues/:id/ai/questions` | `{ topic, count?, difficulty?, notes? }` | `{ questions: [{ body, options[], correctIndex, points }], meta }` — preview only, never saved |

`count` is 1–10 (default 5), `difficulty` is `easy`/`medium`/`hard` (default
`medium`), and generated questions are normalized to the normal MCQ shape with
exactly one in-range correct option. Missing keys return
`503 AI_NOT_CONFIGURED`; provider/JSON failures return
`502 AI_PROVIDER_ERROR` or `502 AI_INVALID_RESPONSE`. Tests mock Groq's HTTP
API, so the suite does not spend credits or require a real key.

### Course evaluations (teacher)

| Method | Path | Body / query | Response |
| --- | --- | --- | --- |
| GET | `/leagues/:id/evaluations` | `?subject=&from=&to=&page=&limit=` (Gregorian dates) | `{ league{ id, name, grade }, items[...], total, stats{...}, subjects, titles, columns[], scoring{ enabled, excellent, good, fair, needsWork }, options{ levels, grades, gradesByLevel, kinds, descriptive } }` |
| POST | `/leagues/:id/evaluations` | `{ subject, title, level?, grade?, kind?, scaleMin?, scaleMax?, heldOn, note? }` | `201 { evaluation }` (a subject equal to a score column name is linked for points) |
| PUT | `/leagues/:id/evaluations/scoring` | `{ enabled, excellent, good, fair, needsWork }` | `{ scoring }` — re-applies the points of every existing evaluation |
| GET | `/leagues/:id/evaluations/:evaluationId` | — | `{ evaluation, students[{ studentId, name, score, label, note }], scoring }` |
| PATCH | `/leagues/:id/evaluations/:evaluationId` | any create field | `{ evaluation }` — relinks the column and moves the awarded points |
| DELETE | `/leagues/:id/evaluations/:evaluationId` | — | `{ ok: true }` (marks cascade, awarded points are reversed) |
| PUT | `/leagues/:id/evaluations/:evaluationId/scores` | `{ scores: [{ studentId, score?, label?, note? }] }` | `{ evaluation, students }` — one transaction; an empty score **and** label clears the mark and its points |

Numerical marks must fall inside the evaluation's `[scaleMin, scaleMax]`, descriptive
marks must be one of `excellent`, `good`, `fair`, `needs-work`, and students from
another league are ignored. League points are written only through the scoring
mapping described above (and only when it is enabled).

### Student portal

| Method | Path | Body / query | Response |
| --- | --- | --- | --- |
| GET | `/student/me` | — | `{ user, student{ id, name, leagueId, leagueName, leagueStatus }, settings }` |
| GET | `/student/dashboard` | — | `{ studentId, name, leagueId, leagueName, leagueStatus, points, rank, totalStudents, championships, completedLeagues, title, bestChampionship, medals, team, series{ start, points } }` |
| GET | `/student/report-card` | auth | Optional `columnId`, `from`, `to` (Gregorian `YYYY-MM-DD`), `limit` (≤500, default 200). Returns `{ studentId, name, leagueId, leagueName, grade, items[{ columnId, name, step, value }], total, rank, totalStudents, title, columns[], filters, sessions[{ id, columnId, columnName, topic, delta, actorName, totalAfter, createdAt, quality{ key, label, icon } }], sessionCount }` |
| GET | `/student/attendance` | `?page=&limit=` | `{ items[{ day, status, updatedAt }], total, summary{ recorded, present, late, absent, attended } }` |
| GET | `/student/team` | — | `{ team{ id, name, label, finalPoints, memberAverage, basePoints } \| null, members[{ studentId, name }], rank, totalTeams }` |
| GET | `/student/history` | `?page=&limit=` | `{ items[{ id, columnId, columnName, delta, reason, actorName, totalAfter, createdAt }], total, series }` |
| GET | `/student/ranking` | — | `{ leagueId, total, items: [{ studentId, name, total, rank, isMe, title }] }` (names only — no private data) |
| GET | `/student/medals` | — | `{ total, items[{ id, title, rank, source, createdAt }], currentTitle }` |
| GET | `/student/classmates` | — | `{ items: [{ id, name }] }` |
| GET | `/student/likes` | — | `{ givenToday, remainingToday, given[{ id, toStudentId, toName, achievement, createdAt }], received }` |
| POST | `/student/likes` | `{ toStudentId, achievement? }` | `201 { like, remainingToday }` |
| GET | `/student/homework` | — | `{ items (with the caller's status) }` |
| GET | `/student/evaluations` | — | `{ items[{ id, subject, title, level, grade, kind, scaleMin, scaleMax, heldOn, note, score, label, average, topScore, rank, gradedCount, studentCount, band{ key, label, icon } }], stats{ count, graded, average, bestSubject, subjects[{ subject, average, count }] } }` — only the caller's own marks plus class aggregates (no other student is ever identified) |
| GET | `/student/questions` | — | `{ items (with the caller's answers) }` — `options[]` is present, `correctIndex` is **never** sent to students |
| POST | `/student/questions/:id/answers` | `{ optionIndex }` for multiple-choice, `{ body }` for legacy text | `201 { ok: true }` |
| GET | `/student/schedule` | — | `{ slots, days[{ index, label }] }` |
| GET | `/student/files` | — | `{ items }` |
| PATCH | `/student/settings` | `{ persianDigits }` | `{ ok, persianDigits }` |
| GET | `/student/timeline` | `?page=&limit=` | `{ items, total, series, page, limit }` |

A student only ever reaches its **own** records: the portal is scoped by the
session's student row, and there is no endpoint that accepts another student id.

### Subscriptions and payments (teacher)

All subscription routes require a teacher session. An expired teacher receives
HTTP `402` with code `SUBSCRIPTION_REQUIRED` from the teaching APIs, and the SPA
redirects to `#/teacher/subscription`. The subscription page itself stays
accessible so the teacher can renew.

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| GET | `/subscription/status` | — | `{ subscription{ status, active, daysLeft, endsAt, source }, plans[], payments[], paymentProvider{ provider, configured, label, sandbox, card }, receiptMaxBytes, trialDays }` |
| POST | `/subscription/checkout` | `{ planId }` | `201 { payment, provider, redirectUrl }` — `mock` local page or Zarinpal `StartPay` URL |
| POST | `/subscription/card-checkout` | multipart: `planId`, `receiptText?`, `receipt` image? | `201 { payment, provider, message }` — one pending card receipt per teacher |
| GET | `/subscription/payments/:id` | — | `{ payment }` (only the caller's payment) |
| GET | `/subscription/payments/:id/receipt` | — | the caller's private receipt image (authenticated, `nosniff`) |
| DELETE | `/subscription/payments/:id` | — | cancels the caller's own pending card receipt so a corrected one can be sent |

With `PAYMENT_PROVIDER=card`, the admin publishes the destination card in
«کارت و پرداخت». The teacher transfers the plan price outside the app, submits a
text and/or image receipt, and the payment stays `pending`. The admin payments
tab shows a numeric badge, a receipt preview, and approve/reject actions.
Approval runs in one SQLite transaction: it claims the pending payment, snapshots
the plan duration from the receipt row, extends the teacher's access exactly
once, and records the review. The plan is added to the effective end date, so a
remaining trial is preserved rather than replaced; unlimited accounts cannot
submit a card receipt. Repeating an approval returns `alreadyPaid` without
extending again. Receipt images live under
`DATA_DIR/uploads/payment-receipts/` and are **never** served by the static file
handler.

Public callbacks live **outside** `/api/v1` and do not use CSRF or JSON:

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/payments/zarinpal/callback` | Zarinpal returns `Authority` + `Status`; the server verifies with the v4 API and activates the plan exactly once |
| GET | `/payments/mock/:id` | Local mock checkout page (development only) |
| GET | `/payments/mock/:id/success` \| `/cancel` | Complete or cancel a mock payment |
| GET | `/payments/status` | Diagnostic: active provider, configured flag and callback URL |

Amounts are stored and displayed in **Toman**, but Zarinpal receives Rial
(Toman × 10). Verify success codes are `100` and `101` (already verified).

### Messaging (teacher and student)

The same API is used by both roles; ownership is enforced on every route and
admins are deliberately excluded.

| Method | Path | Body / query | Response |
| --- | --- | --- | --- |
| GET | `/messages/threads` | — | `{ items[{ id, participantName, subject, unread, lastMessage }], unreadTotal }` |
| GET | `/messages/threads/:id` | `?limit=&before=` | `{ thread, messages[], unreadTotal }` — marks incoming messages as read |
| POST | `/messages/threads` | teacher `{ studentId }`, student `{}` | `201 { thread, created }` (existing thread returns `200`) |
| POST | `/messages/threads/:id/messages` | `{ body }` | `201 { message, thread }` |
| POST | `/messages/threads/:id/read` | — | `{ ok, unreadTotal }` |
| GET | `/messages/unread` | — | `{ count }` |
| GET | `/messages/contacts` | — | `{ items, role }` — students with logins for a teacher, or the student's teacher |

Conversations are unique per `(teacher_id, student_id)`. Messages are capped at
4000 characters, store `read_at`, and the inbox polls every 10 seconds while
preserving a typed draft.

### Admin panel (site owner)

A separate `admins` table backs `/admin/*`; these routes never accept a teacher or
student session.

| Method | Path | Body / query | Response |
| --- | --- | --- | --- |
| GET | `/admin/dashboard` | — | teacher counts, revenue, pending payments, leagues/students/messages/SMS health, recent payments |
| GET | `/admin/teachers` | `?search=&status=active\|trial\|expired&page=&limit=` | `{ items, total, counts }` |
| GET | `/admin/teachers/:id` | — | `{ teacher }` |
| POST | `/admin/teachers` | `{ displayName, username, password, trialDays }` | `201 { teacher }` (`trialDays: 0` creates without a trial) |
| POST | `/admin/teachers/:id/subscription` | `{ days, note? }` | `{ subscription, payment, teacher }` — manual paid grant, appended to the ledger |
| GET | `/admin/expired-users` | `?search=&page=&limit=` | `{ items, total, page, limit, pages }` — only teachers with `access.status === "expired"` |
| DELETE | `/admin/teachers/:id` | `{ confirmUsername? }` | `{ ok, deleted }` — permanent cascade; rejects active/trial/unlimited accounts, and a supplied username must match |
| GET | `/admin/plans` | — | `{ items }` (including inactive plans) |
| POST | `/admin/plans` | `{ name, days, price, description?, active?, sortOrder? }` | `201 { item }` |
| PATCH | `/admin/plans/:id` | any plan field | `{ item }` |
| DELETE | `/admin/plans/:id` | — | `{ ok: true }` — soft delete (`active = 0`) |
| GET | `/admin/payments` | `?search=&status=&page=&limit=` | `{ items, total, page, limit, pages, pendingReceipts }` — pending card receipts come first |
| GET | `/admin/payments/pending-count` | — | `{ count }` for the numeric navigation badge |
| GET | `/admin/payment-settings` | — | `{ settings, configured, provider }` |
| PUT | `/admin/payment-settings` | `{ cardNumber, cardHolder, bankName?, instructions? }` | `{ settings, configured, provider }` |
| GET | `/admin/payments/:id/receipt` | — | private receipt image; admin session required |
| POST | `/admin/payments/:id/approve` | `{ note? }` | `{ payment, subscription, alreadyPaid }` — extends access once |
| POST | `/admin/payments/:id/reject` | `{ reason? }` | `{ payment, alreadyReviewed }` — keeps the ledger row as `canceled` |
| GET | `/admin/backup` | — | configured/enabled flags, missing env vars, local DB/uploads sizes, remote snapshots + manifest, scheduler state, pending restore |
| POST | `/admin/backup/run` | — | `201 { backup }` — push a snapshot to GitHub now (manual, works while the schedule is off) |
| GET | `/admin/backup/download` | — | private attachment containing a consistent local SQLite snapshot |
| POST | `/admin/backup/restore` | `{ file? }` | `202 { staged, restartRequired }` — download/verify the newest or named snapshot and stage it for the next boot |
| DELETE | `/admin/backup/restore` | — | `{ canceled }` — discard a staged restore |
| GET | `/admin/backup/status` | — | remote snapshot count/newest/manifest without the local dashboard payload |

### SMS settings (teacher)

Each teacher enters their **own** sms.ir API key and sender line in
«گزارش روزانه ← تنظیمات پیامک من». The settings are scoped to that teacher's
`users` row, so one teacher can never read or change another teacher's
credentials. The key is encrypted with AES-256-GCM using a key derived from
`SECRETS_KEY` (or `SESSION_SECRET` when `SECRETS_KEY` is unset); the API returns
only `hasApiKey: true|false`, never the key. Because the ciphertext lives in the
`users` table, it is included in every database backup; the matching
`SECRETS_KEY` is what makes it readable after a restore.

The card's «راهنمایی راه‌اندازی سامانه پیامکی» button opens a modal with four
steps and the local screenshots in `public/img/sms-help/`: finding
«لیست کلیدهای API», creating a key, copying it and saving, reading the active
line from «شماره‌های من», and entering both values in the teacher panel. The
guide works offline; the API key in the sample screenshot is redacted.

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| GET | `/sms/settings` | — | `{ config }` — `configured`, `source` (`teacher`/`server`/`none`), `lineNumber`, `hasApiKey`, `serverConfigured`, `partialOwnSettings`, `own{ hasApiKey, lineNumber, updatedAt }`; never contains the API key |
| PUT | `/sms/settings` | `{ apiKey?, lineNumber?, clearApiKey? }` | `{ config }` — blank `apiKey` keeps the saved key, `clearApiKey: true` removes it; both fields are required before delivery starts |

If a teacher has saved **either** field, the server account is not used for
that teacher, even when `SMSIR_*` is configured. This avoids silently mixing
one teacher's line with another account's key. The server-wide variables remain
a fallback only for teachers who have not saved anything yet.

Daily reports return `sampleMessage`, the exact text generated by the same
formatter used for real sends:

```text
لیگ نمونه | گزارش روزانه ۱۴۰۵/۰۷/۲۹
علی رضایی: ریاضی +۲، انضباطی -۱، فارسی +۱
جمع تغییرات: +۲
```

The same page also carries a **«پیام دلخواه به والدین»** box. The teacher writes
any text (up to 1000 characters) — for example a note about a student's
misbehavior — picks the students in the table, reviews the confirmation dialog and
sends. The exact text is stored in `sms_messages` with `kind = 'custom'` and goes
through the same provider/queue path as daily reports. Students without a parent
number are returned as `skipped` rather than being silently dropped.

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| GET | `/leagues/:id/reports/daily` | `?date=YYYY-MM-DD` | the day's per-student changes, generated messages, SMS config, recent sends |
| POST | `/leagues/:id/reports/daily/send` | `{ date, studentIds[] }` | `{ results, counts{ sent, queued, failed, skipped }, smsConfigured }` |
| POST | `/leagues/:id/reports/custom/send` | `{ studentIds[], message }` | `{ results, counts{ sent, queued, failed, skipped }, smsConfigured, message }` — a blank message is rejected with `VALIDATION_ERROR` |

### SMS console (site owner)

| Method | Path | Body / query | Response |
| --- | --- | --- | --- |
| GET | `/admin/sms` | `?status=&limit=` | `{ config, counts{ outbox, campaigns }, outbox[], campaigns[] }` |
| GET | `/admin/sms/messages` \| `/campaigns` | `?status=&limit=` | `{ items }` |
| GET | `/admin/sms/credit` | — | `{ ok, credit }` or `{ ok:false, message }` |
| GET | `/admin/sms/lines` | — | `{ ok, lines }` or `{ ok:false, message }` |
| POST | `/admin/sms/test` | `{ mobile, message }` | `201 { item, delivery }` |
| POST | `/admin/sms/bulk` | `{ mobiles[], message }` | `201 { count, status: queued\|sent\|failed, delivery }` |
| POST | `/admin/sms/messages/:id/retry` | — | retry a league-report outbox row |
| POST | `/admin/sms/campaigns/:id/retry` | — | retry an admin test/bulk campaign row |

Bulk numbers are normalized to `09xxxxxxxxx`, duplicates are removed, and at
most 100 numbers are accepted. The admin console uses the server-wide
`SMSIR_*` settings; teachers use the credentials saved in their own panel.
When sms.ir is not configured, rows remain `queued`; nothing is silently
dropped.

---

## Security

* **Authorization** — `requireTeacher` / `requireStudent` plus ownership loaders.
  A teacher can only touch leagues they own; students are blocked from every
  teacher endpoint (covered by tests, e.g. `tests/authorization.test.js`).
* **CSRF** — synchronizer token stored in the session and echoed in the
  `x-csrf-token` header. The browser client refreshes and retries once when the
  session was rotated (logout, expiry), which keeps the UI free of confusing 403s.
* **Passwords** — bcryptjs with per-user salts; login failures are counted per IP.
  An unknown username still pays one bcrypt comparison, so account existence
  cannot be probed by response timing.
* **Sessions** — a SQLite-backed store that only writes a row once something is
  actually stored in the session, so anonymous page views and API probes leave no
  rows behind; expired rows are swept every hour and on boot.
* **Abuse limits** — `express-rate-limit` on the whole API plus a stricter login
  limiter. `TRUST_PROXY` is off by default: a directly exposed server cannot be
  reached through a spoofed `X-Forwarded-For`, so set it only behind a real proxy.
* **SQL** — parameterized statements only, no string-built SQL.
* **Provider secrets** — sms.ir and Groq keys are encrypted with AES-256-GCM
  using a stable key derived from `SECRETS_KEY` (falling back to
  `SESSION_SECRET` for older rows), scoped to the owning teacher and never
  returned by an API. `SECRETS_KEY` is intentionally separate from the session
  secret so rotating sessions does not break restored credentials.
* **XSS** — the frontend builds DOM nodes and inserts user text as `textContent`
  (`public/js/dom.js`); `innerHTML` is never fed with user data.
* **Headers** — helmet with a strict CSP (`script-src 'self'`, no inline scripts,
  no external origins), `frame-ancestors 'none'`, `no-referrer`, and `Secure`
  session cookies whenever `NODE_ENV=production`.
* **Health checks** — `GET /healthz` is public, but its `PRAGMA quick_check`
  integrity scan is cached for five minutes so it cannot be used to burn CPU/disk.
* **Uploads** — extension + MIME + size allow-lists, original filenames sanitized
  (path separators stripped), random UUID names on disk, downloads always sent as
  `attachment` with a sanitized filename, and no path traversal is possible.
* **Errors** — clients never receive stack traces in production; the logger emits
  one structured JSON line per request/error.

---

## Testing

```bash
npm test        # vitest run
npm run lint    # eslint .
```

Latest run on this machine (Windows, Node 26.3.0):

```
 Test Files  39 passed (39)
      Tests  417 passed (417)
```

| Suite | Tests | Covers |
| --- | --- | --- |
| `auth.test.js` | 15 | Login success/failure, wrong password, unknown user, rate limiting, role separation, logout, password change, session lifetime, missing and stale CSRF tokens |
| `authorization.test.js` | 12 | Teacher A cannot read/write teacher B's league; students blocked from teacher endpoints |
| `validation.test.js` | 11 | zod rejections with `VALIDATION_ERROR` + `details`, bad ids, out-of-range values |
| `scores.test.js` | 10 | Transactional commit with several deltas, totals, history rows, zero-delta rejection, matrix shape |
| `columns.test.js` | 7 | Create/rename/step, delete with keep vs discard |
| `teams.test.js` | 8 | Team scoring formula on/off, assignment, unassigned panel, adjustments |
| `attendance.test.js` | 8 | Daily set, bulk "all present", counters, history, summary ratios |
| `ranking.test.js` | 5 | Competition ranking with ties, title thresholds |
| `jalali.test.js` | 16 | Gregorian↔Jalali round-trips, leap years (1399/1403 vs 1400), month lengths, reference dates |
| `uploads.test.js` | 12 | Allowed/blocked extensions, MIME and size checks, filename sanitization, authorization on download, shared per-teacher quota across leagues and space freed by deletion |
| `raffle.test.js` | 11 | Randomness, exclude-previous, pool cycling, history, reset |
| `representative.test.js` | 8 | Fair one-pick-per-student cycles, progress, cycle completion/refusal, forced cycle advance, undo-last, full reset, empty league, teacher isolation |
| `tools.test.js` | 19 | Wheel segments, shuffle, timer, live board, homework, multiple-choice + legacy text Q&A, presentation quiz, schedule, league lifecycle |
| `student.test.js` | 20 | Dashboard series/medals, report card totals + session lines with derived quality and subject/date filters, grade setting, own attendance/history, likes quota, self-like rejection, settings |
| `evaluations.test.js` | 23 | Evaluation CRUD + column reference, numeric/descriptive marks, scale and label validation, clearing a mark, subject/date filters, no transfer into league points, foreign-teacher and student isolation, own-marks student payload |
| `reports.test.js` | 10 | Daily parent report grouping, message trimming, authorization and SMS queue/delivery paths; free-text custom messages store the exact teacher text as `kind = 'custom'`, skip students without a parent number, and reject blank messages |
| `contacts.test.js` | 5 | Parent/student phone normalization, validation, clearing and teacher isolation |
| `seating.test.js` | 6 | Seating plan persistence, random reshuffle, clearing, teacher-only access |
| `platform.test.js` | 10 | Teacher signup + 14-day trial, expired access + admin grant, admin/teacher/student separation, teacher create/search/filter, plan CRUD, mock checkout and renewal, Zarinpal request/verify (Rial, codes 100/101) |
| `cardPayments.test.js` | 14 | Admin card settings/normalization, one pending receipt per teacher, exact-duration approval with idempotent re-approval, remaining-trial preservation, unlimited-account guards, no cross-teacher access, private receipt streaming/signature checks, reject/cancel/retry, missing-receipt and non-card guards |
| `frontendCardPayments.test.js` | 7 | Teacher card details + receipt modal upload, disabled purchase during review, unlimited-account notice, unconfigured-card warning, admin settings form, receipt preview/approve actions, numeric navigation badge |
| `messages.test.js` | 12 | Teacher↔student threads, unread/read receipts, replies, ownership isolation, no-login students, empty body, unique conversations, contacts, admin exclusion |
| `smsAdmin.test.js` | 4 | Admin SMS config, queued test messages without credentials, normalized bulk send, credit, invalid numbers and outbox retry |
| `smsSettings.test.js` | 6 | Per-teacher encrypted sms.ir key/line, write-only API, teacher isolation, teacher credential precedence, incomplete-settings fallback block, validation and sample message |
| `ai.test.js` | 9 | Per-teacher encrypted Groq key and server fallback, write-only settings, mocked Groq call/shape, invalid or failed responses, foreign-league isolation, preview-only generation, reviewed bulk save |
| `aiAssistantFrontend.test.js` | 3 | AI modal key save/clear, disabled generation without a key, preview selection, bulk-save hand-off and reload, topic validation |
| `frontend.test.js` | 61 | jsdom: RTL attributes, no external/CDN assets, XSS-safe rendering, Persian normalization, digit formatting, router, chart config, teacher dashboard (17 tiles), staged score commit, team chip assignment, student dashboard + chart, report card bands/session cards/filters, evaluation vocabulary parity, teacher evaluation form/mark sheet/quick-fill, student evaluation cards, MCQ option editor, student MCQ/text answering, teacher sms.ir settings card + sample, SMS setup guide modal with screenshots, custom parent-message box with confirmation and send, modal focus/footer lifecycle |
| `frontendPlatform.test.js` | 10 | Login inputs remain visible and submit, credits footer, teacher signup and demo notice, subscription storefront/history, admin dashboard and teacher renewal, expired-user deletion section, teacher file storage card, shared inbox thread/composer, admin settings label |
| `frontendApi.test.js` | 4 | Client CSRF lifecycle: token warm-up, single retry after `INVALID_CSRF`, no retry on plain permission errors, network error mapping |
| `moduleLinks.test.js` | 2 | Static link check over `public/js`: every relative named import resolves to a real export (the browser loads these modules natively, so a typo breaks the app — Vite's jsdom transform does not) |
| `githubBackup.test.js` | 26 | Off-site backups against an in-memory GitHub Contents/Blob API: upload + manifest checksum, Blob download above 1 MB, full push→restore round trip, retention/pruning, public-repo refusal, size limit, missing repo and 404 handling, checksum-mismatch safety, schema-only/empty detection, staged restore + cancel, scheduler due-time/retry/state handling |
| `adminExpiredUsers.test.js` | 3 | Expired-only user listing, typed-confirmation hard delete with cascaded leagues/students/files, linked student-login cleanup, uploaded-blob cleanup, session invalidation, and refusal of active accounts or non-admin callers |
| `adminBackup.test.js` | 3 | Admin-only backup status, unconfigured deployment, manual GitHub push, snapshot listing, staged restore/cancel, private local SQLite download |
| `secrets.test.js` | 3 | Stable `SECRETS_KEY` across session rotation, legacy session-secret fallback, tamper rejection |
| `frontendBackup.test.js` | 2 | Backup page renders missing-env guidance, disables manual backup, lists remote snapshots and the local download link |
| `frontendRepresentative.test.js` | 5 | Representative hero/progress/status/history render, animated draw updates the winner, name search filters only the status list, copy-ready announcement, and projector board render |
| `bootstrap.test.js` | 7 | First teacher account: creation, password verification, skip when accounts exist, `--force` reset, refusal of short/demo-default passwords, production-vs-development default |
| `hardening.test.js` | 15 | Anonymous requests create no session row, logout clears the configured cookie, login performs a bcrypt comparison for unknown users, `/healthz` integrity scan is cached, expired sessions are swept, app JS/CSS revalidate after deployment, `TRUST_PROXY` fails closed |

Backend suites use throwaway SQLite databases (`tests/helpers.js`), so `npm test`
never touches your real `DATA_DIR`.

---

## Manual verification checklist

Executed against a live server (`NODE_ENV=development`, fresh `DATA_DIR`, seeded):

| Check | Result |
| --- | --- |
| Clean-DB boot + auto migrations | ✅ `database ready` then `server listening` |
| `GET /healthz` | ✅ `200 {"status":"ok",...,"database":{"ok":true,"integrity":"ok"}}` |
| No external network requests | ✅ every request same-origin to `127.0.0.1` (`/js/**`, `chart.umd.js`, `vazirmatn.css`, fonts) — no CDN, no Google Fonts |
| Browser console | ✅ zero errors/warnings during the whole walk-through |
| Teacher login → dashboard | ✅ 17 tool tiles, stat cards, league switcher |
| Individual league table | ✅ 22 students, 8 default columns (step 25), staged `+25` preview, row commit → server-confirmed total |
| Teams / attendance / raffle / representative / wheel / live board / timer / homework / Q&A / schedule / files / evaluations | ✅ all tool routes render, no console errors |
| Teacher multiple-choice question | ✅ added/removed options, picked the correct one, saved `۲۵` points; the list shows the choices and marks the correct option |
| Presentation mode (MCQ) | ✅ started «حالت پخش», the student's screen showed the three choices with no correct-answer marker |
| Student Q&A | ✅ new «سوال و پاسخ» tab; answered the MCQ (own answer `مشهد`, no `correctIndex` in the API), and submitted a legacy text answer |
| Teacher answer review | ✅ «پاسخ‌ها» showed `پاسخ صحیح: گزینه ۲ — مشهد` and the student's `گزینه ۲: مشهد · پاسخ صحیح` |
| Teacher sms.ir settings | ✅ saved a key + line from the teacher's own card, status switched to «حساب شخصی شما», the sample SMS rendered, then the test values were cleared |
| SMS setup guide | ✅ «راهنمایی راه‌اندازی سامانه پیامکی» opened a modal with a dark backdrop, all three screenshots, four steps and a working «بستن» button |
| Q&A AI assistant | ⏳ key save/clear, preview selection and bulk-save hand-off are covered by automated tests; a live Groq call waits for `GROQ_API_KEY` |
| Attendance bulk "همه حاضر" | ✅ `۰ ثبت‌نشده` → `۲۲ حاضر` |
| Raffle draw | ✅ winner shown, "21 remaining", pool exclusion works |
| Class representative | ✅ progress 0→100%, every student once, undo-last, new cycle keeps history, copy-ready announcement, projector board refreshes automatically |
| Logout → login as another user | ✅ (this flow exposed a stale-CSRF bug that is now fixed and tested) |
| Student login + dashboard | ✅ greeting `👋 سلام علی!`, points/rank/championship cards, Chart.js line chart with 16 points and Jalali labels |
| Course evaluation (numeric) | ✅ form auto-filled مقطع `ابتدایی` / پایه `ششم` from the league setting, saved `ریاضی — آزمون فصل ۲`, linked to the `ریاضی` column as a reference only, mark sheet rendered 22 students, «نمرهٔ کامل» filled all 22 in one click, list row `میانگین ۱۹.۹۱ · ثبت‌شده ۲۲/۲۲`, band chips `🌟 عالی / 👍 خوب / 🙂 قابل قبول` by mark |
| Course evaluation (توصیفی) | ✅ kind switch exposes `خیلی خوب / خوب / قابل قبول / نیاز به تلاش` selects, bulk-fill + save → `📝 توصیفی · میانگین — · ثبت‌شده ۲۲/۲۲` |
| Evaluation filters | ✅ subject filter `هدیه` → 1 row, «پاک کردن» → 2 rows |
| No transfer into league points | ✅ امتیاز کل stayed `۳۳۳` (رتبه `۱۱`) across both evaluations and `score_history` gained no rows |
| Student ارزشیابی tab | ✅ own mark `۱۸` with `💎 خیلی خوب`, `میانگین کلاس ۱۹.۹۱`, `رتبهٔ ۲۲ از ۲۲`; the descriptive row shows `👍 خوب`; class aggregates only, no classmate named |
| All 11 student tabs | ✅ render with no errors and no horizontal scroll |
| Teacher self-signup | ✅ `ثبت‌نام معلم` shows «۱۴ روز استفادهٔ آزمایشی رایگان», creates the account, logs in and opens an empty workbench |
| Admin login | ✅ owner opens `#/admin`; dashboard shows teacher/trial/expired/student/league/message totals and the SMS warning when unconfigured |
| Admin teachers / plans / payments / SMS | ✅ all four views render from the live API with no console errors; plans show the three seeded prices, payments filter and SMS console are usable |
| Mock subscription purchase | ✅ plan card → local gateway → «پرداخت موفق» → banner switches to «اشتراک فعال», 30 days added, `MOCK-1` appears in the history |
| Teacher → student message | ✅ teacher creates a thread, sends a message; student sees unread `۱`, opens it, replies, and the message is stored with the thread |
| Footer credits | ✅ every page shows «تهیه‌کنندگان: محمدجواد ابراهیمی - علی طاهری» and the copyright line with the current Jalali year |
| Privacy probes from a student session | ✅ `/leagues`, `/leagues/1/scores`, `/leagues/1/attendance`, `/leagues/1/evaluations` → `403 FORBIDDEN`; another student's data unreachable |
| Drawer geometry (RTL) | ✅ open = flush to the right edge, closed = fully off-screen (`x ≥ viewport`) |
| Horizontal overflow | ✅ `scrollWidth ≤ clientWidth` on every checked page; wide tables scroll inside their own card; verified at desktop width and at a 340 px column (≈360 px device) |
| Upload hardening | ✅ `.exe` → `400 EXTENSION_BLOCKED`, `trav-../../evil.txt` stored as `evil.txt` with a UUID filename inside `DATA_DIR/uploads`, anonymous download → `401`, upload without CSRF → `403` |
| GitHub backup upload | ✅ `npm run backup:github` against a wire-compatible API on `127.0.0.1` → `backup pushed to GitHub … bytes 417792`, manifest + snapshot stored, `npm run backup:status` reported `snapshots 1` |
| Backup retention | ✅ four uploads with `BACKUP_GITHUB_KEEP=2` → `pruned old snapshot` twice, exactly 2 snapshots left, `latest.json` never deleted |
| Restore on an empty container | ✅ deleted the volume, started with `NODE_ENV=production` → `database restored from GitHub` (sha256 matched the upload) and **no** migration line (the schema came with the snapshot); the restored file had 2 users, 22 students, league «لیگ نمونه», 301 history rows, and its `users` rows were byte-identical to the live database |
| Scheduled backup in-process | ✅ production boot 2 s later → `backup pushed to GitHub` + `scheduled GitHub backup complete`, with a new snapshot pruned at the retention limit |
| GitHub API client against production GitHub | ✅ read-only checks on `api.github.com`: `getRepo` → `private:false, default_branch:main`; `getContents` file → base64 decoded with a matching size; directory listing → array; missing path → `GithubError 404`; the token never appears in an error message |

---

## Deployment

### Docker (recommended)

```bash
docker build -t league:1.0.0 .

docker run -d --name league \
  -p 3000:3000 \
  -e NODE_ENV=production \
  -e SESSION_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")" \
  -e TRUST_PROXY=true \
  -e APP_NAME="لیگ جامع دانش‌آموزی" \
  -v league-data:/data \
  league:1.0.0
```

The image runs as the non-root `node` user, needs nothing but `/data`, forwards
signals through `tini` for graceful shutdown, and has a `HEALTHCHECK` that polls
`/healthz`.

### Plain Node.js / VPS

```bash
git clone <your-repo> /opt/league && cd /opt/league
npm ci --omit=dev
cp .env.example .env      # set NODE_ENV=production, SESSION_SECRET, DATA_DIR, TRUST_PROXY=true
# or upload production.env beside server.js; production mode loads it automatically
npm start                 # or: node server.js
```

Keep it alive with systemd or pm2. A minimal unit file:

```ini
[Unit]
Description=Student Comprehensive League
After=network.target

[Service]
WorkingDirectory=/opt/league
EnvironmentFile=/opt/league/.env
ExecStart=/usr/bin/node server.js
Restart=always
User=league
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

### Iranian PaaS (e.g. ParsPack / لیارا / ابرآروند)

**Full walkthrough: [`DEPLOY-PARSPACK.md`](DEPLOY-PARSPACK.md)** — app creation, build
settings, the `better-sqlite3` note, environment variables, the first login, the
automatic GitHub backup and a troubleshooting table.

The short version: this is **one** app. The same process serves the API and the
frontend, so there is no separate frontend/backend deployment and no build step.

1. **Create the app** and choose a Node.js runtime (**22** — see the
   `better-sqlite3` note below), or deploy the `Dockerfile` if the platform
   supports container builds.
2. **Set environment variables** in the panel:
   `NODE_ENV=production`, `SESSION_SECRET=<long random>`, `DATA_DIR=/data`
   (or the mount path the panel gives you), `TRUST_PROXY=true`,
   `APP_NAME=لیگ جامع دانش‌آموزی`,
   `BOOTSTRAP_TEACHER_PASS=<the first teacher's password>`.
   Leave `PORT` to the platform if it injects one.
3. **Attach a persistent volume** and mount it at `DATA_DIR`. Without it, the
   SQLite database and uploads are lost on every redeploy.
4. **Start command**: `node server.js` (dependencies are installed with
   `npm ci --omit=dev` during the build; `npm start` also works).
5. **Health check path**: `/healthz` (returns 200 when the database is reachable).
6. **HTTPS**: enable the platform's TLS and keep `TRUST_PROXY=true` so session
   cookies are marked `Secure` and client IPs (used by rate limiting) are read
   from `X-Forwarded-For` instead of the proxy address. In production the cookie is
   `Secure`, so logging in over plain `http://` is refused by design (the app answers
   `INVALID_CSRF`) — always test the `https://` address.
7. **Domain / reverse proxy**: the app serves the API and the static frontend from
   the same origin, so a simple proxy pass is enough:

   ```nginx
   location / {
     proxy_pass http://127.0.0.1:3000;
     proxy_http_version 1.1;
     proxy_set_header Host $host;
     proxy_set_header X-Real-IP $remote_addr;
     proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
     proxy_set_header X-Forwarded-Proto $scheme;
     proxy_read_timeout 120s;
   }
   ```

8. **First boot** runs the migrations automatically. On an empty production
   database the first teacher account is created from `BOOTSTRAP_TEACHER_PASS`
   (production never inserts demo data). Change that password in **تنظیمات** after
   the first login, then remove the variable. For a trial dataset use
   `npm run seed` **outside** production only.
9. **Turn on the off-site backup** (step 4 of the guide): a PaaS may recreate the
   container filesystem, and a restored snapshot is the difference between an
   outage and a lost term.

Deploy notes specific to this app:

* `better-sqlite3` 13 is a **Node-API** addon and ships its compiled binary for
  `linux-x64` (glibc) **and** `linuxmusl-x64` (Alpine) inside the npm package, so
  the server install needs no compiler, no `python3`/`make`/`g++` and no network
  download. Its `engines` field requires Node **22+**.
* No build step for the frontend — `public/` is served as committed.
* Everything (`Chart.js`, fonts) is served from your own domain, so the app works
  even where external CDNs are blocked.
* All dates are stored as ISO (`YYYY-MM-DD`) in SQLite and rendered as Jalali in
  the browser using `APP_TZ_OFFSET_MINUTES`.

---

## Backup and restore

### Local snapshot

```bash
npm run backup
# → $DATA_DIR/backups/league-20261018-181500.db
```

`npm run backup` uses the SQLite online backup API, so the snapshot is consistent
even while the server is running. Set `BACKUP_DIR` to write somewhere else (for
example a mounted NAS or an off-site sync folder).

Restore locally:

```bash
# 1. stop the server (so nothing writes to the database)
# 2. keep the old files just in case
mv "$DATA_DIR/league.db" "$DATA_DIR/league.db.broken"

# 3. copy the snapshot back
cp "$DATA_DIR/backups/league-20261018-181500.db" "$DATA_DIR/league.db"

# 4. remove stale WAL/journal files, then start again
rm -f "$DATA_DIR"/league.db-wal "$DATA_DIR"/league.db-shm
npm start
```

### Automatic off-site snapshots on GitHub

On managed PaaS a local snapshot is not enough — the container filesystem can be
recreated on any redeploy. With `BACKUP_GITHUB_ENABLED=true` the server snapshots
itself on an interval, uploads the file to a **private** GitHub repository through
the Contents API (`<dir>/league-<stamp>.db` plus a `latest.json` manifest holding
the size, SHA-256, creation time, app version and schema migration count), and
prunes older snapshots down to `BACKUP_GITHUB_KEEP`. Snapshots above 1 MB are
read back through the Git Blob API, so larger databases remain restorable.

The snapshot contains student data, so the uploader **refuses a public
repository** unless `BACKUP_GITHUB_ALLOW_PUBLIC=true` is set deliberately.

```bash
npm run backup:github        # upload one snapshot now
npm run backup:status        # count, newest snapshot, last checksum

# example output
{"msg":"backup pushed to GitHub","repo":"Asgh24/league-backups","file":"league-20261019T145242Z.db",
 "bytes":417792,"sha256":"da39…0d49","pruned":["league-20261019T145158Z.db"]}
```

Automatic recovery: with `RESTORE_FROM_GITHUB_ON_EMPTY_LOCAL=true` (default) the
server checks at boot whether the local database has **no users and no leagues**.
That covers a fresh volume, a wiped container and a schema-only file left by a
deploy that stopped before bootstrap. The newest snapshot is downloaded,
checksum-verified and put in place **before migrations run**:

```json
{"msg":"database restored from GitHub","file":"league-20261019T145242Z.db","bytes":417792,"sha256":"da39…0d49"}
```

A database that already has users or leagues is never replaced automatically, so
an old snapshot cannot overwrite a live term. A failed download or a checksum
mismatch leaves the local file untouched and only logs the error.

The same features are available in the owner panel at **#/admin/backup**:

* **بکاپ همین حالا** — push a snapshot immediately, even if the schedule is off.
* **دانلود بکاپ محلی** — download a consistent SQLite file for an offline copy.
* **بازیابی آخرین بکاپ** or a specific snapshot — download and verify it, then
  stage it for the **next service restart**. A live SQLite connection is never
  swapped under running statements, so after clicking the button restart the
  service once (systemd, pm2 or the hosting panel). The staged restore is applied
  before any database connection is opened. A pending restore can be canceled.

Teacher-saved sms.ir and Groq keys are stored in `users.sms_api_key` /
`users.groq_api_key` as AES-256-GCM ciphertext, so they are included in every
database snapshot. They decrypt only with the same `SECRETS_KEY` (falling back to
`SESSION_SECRET` for older rows). Set `SECRETS_KEY` once and never change it when
you rely on backups.

Retention and retention state: the newest 7 snapshots are kept by default
(`BACKUP_GITHUB_KEEP`), the interval is `BACKUP_GITHUB_INTERVAL_MINUTES` (default
1440 = once a day, minimum 5), a failed upload is retried after 15 minutes, and
the last successful upload time is stored in `$DATA_DIR/backup-state.json` so a
restart does not upload twice.

### What is not in a snapshot

Uploaded files live in `DATA_DIR/uploads` and are **not** part of the database
snapshot — in local backups or in GitHub snapshots (they are UUID-named, so a plain
file copy is safe). The database, scores, attendance, evaluations and report cards
are fully covered. Copy `uploads/` separately if you need those files after a
container reset.

---

## Default credentials

`npm run seed` (and the automatic dev-mode seed on an empty database) creates:

| Role | Username | Password |
| --- | --- | --- |
| Site owner (admin panel) | `admin` | `admin1234` (development only) |
| Teacher | `teacher` | `teacher1234` |
| Student | `student1` | `student1234` |

A teacher account can also be created from **ثبت‌نام معلم** on the login page.
The admin account lives in a separate table and opens `#/admin`; set
`ADMIN_PASSWORD` before the first production boot.

Only the first demo student gets a login (the seeded class has 22 students; the
other 21 exist as roster entries without credentials). Teachers create logins for
the rest from **لیگ انفرادی → add student** and can reset a password from a
student's row at any time.

In **production** the demo seed never runs. An empty production database gets its
first account from `BOOTSTRAP_TEACHER_USER` / `BOOTSTRAP_TEACHER_PASS` on boot (see
the environment table), or on demand:

```bash
npm run bootstrap                 # create the first teacher if there is none
npm run bootstrap -- --force      # reset that account's password (forgotten login)
```

> **Change these before using the app with a real class.** Sign in as the teacher,
> open **تنظیمات** (Settings) and change the password; student passwords can be
> reset from a student's row in the individual league table. In production the
> demo seed never runs automatically (`SEED_ENABLED=false` is the safest setting),
> and `BOOTSTRAP_TEACHER_PASS` (or `SEED_TEACHER_USER` / `SEED_TEACHER_PASS` for a
> trial) is how the first account is created.

---

## Known limitations

* **Single process, single volume.** SQLite (WAL) handles a classroom of users
  comfortably, but the app is not designed to run as multiple replicas against one
  file. Use one instance, or one volume per instance.
* **Polling, not push.** The live board, the league timer and the message inbox
  refresh on an interval; there is no WebSocket/SSE channel. Each open inbox polls
  every 10 seconds.
* **Payment setup is external.** `mock` works offline, but real Zarinpal payments
  need `ZARINPAL_MERCHANT_ID`, a public HTTPS domain in `APP_BASE_URL`, and a
  merchant account. Sandbox mode is available (`ZARINPAL_SANDBOX=true`).
* **Timer-driven tools are client-side.** The countdown/stopwatch tools use the
  browser clock and `requestAnimationFrame`, so a background tab may show a stale
  value until it is focused again.
* **Jalali dates are date-only.** Point-in-time values (history, logs) are stored
  as UTC ISO timestamps and rendered in the league timezone; seconds-level Jalali
  formatting is out of scope.
* **Likes are simple.** A like is a daily allowance plus a free-text achievement;
  there is no moderation queue or abuse reporting.
* **Uploads are not virus-scanned.** Size, extension and MIME are validated and the
  bytes are never executed, but a scanner is up to your infrastructure.
* **Backup snapshots cover the database, not `uploads/`.** Each snapshot is a full copy of
  the database (including encrypted SMS/Groq keys), so a long retention window fills the
  backup repository over time; Git also keeps every uploaded version in history, so prune
  with `BACKUP_GITHUB_KEEP` rather than expecting space to be freed. Keep `SECRETS_KEY`
  unchanged or restored provider keys cannot be decrypted.
* **No email.** Password recovery is manual (teacher resets student passwords).
* **AI generation needs a Groq key.** The Q&A assistant works only after
  `GROQ_API_KEY` or a teacher's personal key is saved. It is non-streaming,
  limited to 1–10 questions per request, and validates the model's JSON before
  showing a preview. Tests mock the provider; verify a live call after setting a
  real key. Generated content should always be reviewed by the teacher.
* **SMS requires sms.ir credentials.** Daily reports and admin test/bulk messages are
  stored in the outbox first. Each teacher enters their own API key and line number in
  «گزارش روزانه ← تنظیمات پیامک من»; the optional `SMSIR_API_KEY` and
  `SMSIR_LINE_NUMBER` variables are only a fallback for teachers who have saved
  nothing. Without either source the rows stay `queued` instead of failing. There is
  no automatic retry worker — after configuring the provider, use «تلاش دوباره» in
  the admin SMS panel or resend from «گزارش روزانه».
* **The saved sms.ir key is tied to `SESSION_SECRET`.** Rotating that secret makes
  existing encrypted keys unreadable, so each teacher must enter their key again.
  This is intentional: the key is never stored in plaintext.
* **No self-service billing portal beyond subscriptions.** There are no invoices,
  refunds or proration; the owner can grant days manually and the payment ledger keeps
  the audit trail.
* **No i18n framework.** The UI is Persian-only; `APP_NAME` is the single
  configurable brand string.
* **Rate limiting is in-memory per process.** Restarting the server resets the
  counters, and a multi-instance deployment would need a shared store.
* **Accessibility is partial.** Focus management, keyboard navigation and focus
  rings are implemented, but the app has not been audited against WCAG 2.2 AA
  (for example, some emoji-only controls rely on `aria-label`).
