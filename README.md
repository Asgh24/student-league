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

**Teacher area** – dashboard «میزکار معلم» with 12 always-unlocked tools:

| Tool | What it does |
| --- | --- |
| لیگ انفرادی | Students, dynamic score columns, staged per-row editing, totals, ranks, championship medals, per-change history. The table pins the rank/name (right) and total/commit (left) columns so the score grid can be filled without hunting for the ✓ button; the remaining per-student actions live in the profile dialog |
| لیگ تیمی | Teams, standings, manual adjustments, "no team" assignment panel, optional member-average scoring |
| حضور و غیاب | Daily present/absent/late sheet, "mark all present", Persian date picker, per-student ratios, history |
| قرعه‌کشی | Cryptographic random picker with "exclude previous", animated draw and history |
| تابلوی زنده | Full-screen polling leaderboard for a projector |
| تایمر و ابزار | Countdown / stopwatch with a WebAudio alert |
| گردونه شانس | Canvas lucky wheel with teacher-editable segments |
| سوال و پاسخ | Teacher questions, student answers, award points |
| تکالیف | Homework with due dates and per-student done/not-done |
| ارزشیابی دروس | Course evaluations: مقطع + پایه, exam title, numeric marks (۰–۲۰) or descriptive levels, per-student mark sheet with quick-fill. Marks are recorded only — they are never converted into league points automatically |
| برنامه هفتگی | Saturday→Friday weekly schedule grid |
| ارسال فایل | Uploaded files shared with the class, downloaded safely |

**Student area** – tabs: میزکار, کارنامه, ارزشیابی, حضور و غیاب, تیم من, تاریخچه, رده‌بندی, لایک, تنظیمات.
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

| Variable | Default | Notes |
| --- | --- | --- |
| `NODE_ENV` | `development` | Set to `production` on a server (enables secure cookies, hides stack traces) |
| `PORT` | `3000` | Some PaaS providers inject their own value — do not override it there |
| `HOST` | `0.0.0.0` | Bind address |
| `APP_NAME` | `لیگ جامع دانش‌آموزی` | Brand shown in the topbar, page title and `/meta` |
| `DATA_DIR` | `./data` | **Must be a persistent volume.** Holds the database, `uploads/` and `backups/` |
| `SESSION_SECRET` | — | **Required in production**, at least 16 characters |
| `SESSION_COOKIE_NAME` | `scl.sid` | Session cookie name |
| `SESSION_MAX_AGE_MS` | `604800000` | Session lifetime (7 days) |
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
| `MAX_UPLOAD_BYTES` | `10485760` | Upload size limit (10 MB) |
| `LIKES_PER_DAY` | `10` | Likes a student may give per day |
| `BODY_LIMIT` | `512kb` | JSON body limit |
| `LOG_LEVEL` | `debug` | `debug` \| `info` \| `warn` \| `error` |
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
| `RESTORE_FROM_GITHUB_ON_EMPTY_LOCAL` | `true` | Replace an **empty** local database with the newest snapshot on boot |

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
│   ├── repositories/           # data access for users and leagues
│   ├── routes/                 # one Express router per resource
│   ├── services/               # scoring, attendance, teams, student portal, off-site backups
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
| `users` | Teachers and students; bcrypt hash, role, display name, persian-digits flag |
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
| `questions`, `answers` | Q&A: teacher questions, student answers, awarded points |
| `schedule` | Weekly grid slots (day, period, subject, note) |
| `files` | Upload metadata; bytes live in `DATA_DIR/uploads` under random names |
| `raffle_history` | Who was picked, when, and the reason |
| `likes` | Per-day student-to-student likes (quota enforced) |
| `league_settings` | `individualAffectsTeam`, late/absent penalties, `grade` (نام پایه نمایش‌داده‌شده روی کارنامه) |
| `evaluations` | Course evaluations: subject, exam title, `level` (مقطع), `grade` (پایه), `kind` (`numeric`/`descriptive`), scale, `held_on`, optional link to a score column (reference only) |
| `evaluation_scores` | One row per student × evaluation: `score` (numeric) or `label` (descriptive level); a cleared mark deletes the row |
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

**Marks never touch the league.** The module writes only to `evaluations` and
`evaluation_scores`; awarding league points stays a separate, manual action in
پیگیری امتیازها. When a subject name matches a score column exactly, the evaluation
stores a *reference* to that column so the two views can be correlated, but no
automatic transfer happens (covered by the `never moves marks into league points` test).

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
| GET | `/meta` | public | — | `{ appName, version, timezoneOffsetMinutes, likesPerDay, maxUploadBytes }` |

### Authentication

| Method | Path | Role | Body | Response |
| --- | --- | --- | --- | --- |
| GET | `/auth/csrf` | public | — | `{ csrfToken }` |
| GET | `/auth/me` | public | — | `{ user \| null, csrfToken }` |
| POST | `/auth/login` | public | `{ username, password }` | `{ user, csrfToken }` |
| POST | `/auth/logout` | auth | — | `{ ok: true }` |
| POST | `/auth/password` | auth | `{ currentPassword, newPassword }` | `{ ok: true }` |

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
| GET | `/leagues/:id/tools/wheel` | — | `{ segments, source }` |
| PUT | `/leagues/:id/tools/wheel` | `{ segments: [{ label }] }` | `{ segments, source }` |
| POST | `/leagues/:id/tools/shuffle` | — | `{ order: [{ studentId, name }] }` |
| GET | `/leagues/:id/tools/timer` | — | `{ timer }` |

Raffle winners are drawn with `crypto.randomInt`, and "exclude previous" cycles the
pool only after everyone has been picked.

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
| GET | `/leagues/:id/questions` | — | `{ items }` |
| POST | `/leagues/:id/questions` | `{ body, points? }` | `201 { question }` |
| DELETE | `/questions/:id` | — | `{ ok: true }` |
| POST | `/questions/:id/close` \| `/open` | — | `{ ok: true }` |
| GET | `/questions/:id/answers` | — | `{ question, items }` |
| POST | `/answers/:id/award` | `{ points }` | `{ answer: { id, awarded, delta } }` |
| GET | `/leagues/:id/schedule` | — | `{ slots }` |
| PUT | `/leagues/:id/schedule` | `{ slots: [{ dayIndex, period, subject, note }] }` | `{ slots }` |
| GET | `/leagues/:id/files` | — | `{ items, total, limits }` |
| POST | `/leagues/:id/files` | `multipart/form-data` (`file`, `description?`) | `201 { file }` |
| GET | `/files/:id/download` | — | file bytes (`Content-Disposition: attachment`) |
| DELETE | `/files/:id` | — | `{ ok: true }` |

### Course evaluations (teacher)

| Method | Path | Body / query | Response |
| --- | --- | --- | --- |
| GET | `/leagues/:id/evaluations` | `?subject=&from=&to=&page=&limit=` (Gregorian dates) | `{ league{ id, name, grade }, items[{ id, subject, title, level, grade, kind, scaleMin, scaleMax, heldOn, note, columnId, gradedCount, studentCount, average, minScore, maxScore }], total, stats{ count, subjectCount, studentCount, gradedCount, average }, subjects, titles, columns[], options{ levels, grades, gradesByLevel, kinds, descriptive } }` |
| POST | `/leagues/:id/evaluations` | `{ subject, title, level?, grade?, kind?, scaleMin?, scaleMax?, heldOn, note? }` | `201 { evaluation }` (a subject equal to a score column name is linked as a reference) |
| GET | `/leagues/:id/evaluations/:evaluationId` | — | `{ evaluation, students[{ studentId, name, score, label, note }] }` |
| PATCH | `/leagues/:id/evaluations/:evaluationId` | any create field | `{ evaluation }` |
| DELETE | `/leagues/:id/evaluations/:evaluationId` | — | `{ ok: true }` (marks cascade) |
| PUT | `/leagues/:id/evaluations/:evaluationId/scores` | `{ scores: [{ studentId, score?, label?, note? }] }` | `{ evaluation, students }` — one transaction; an empty score **and** label clears the mark |

Numerical marks must fall inside the evaluation's `[scaleMin, scaleMax]`, descriptive
marks must be one of `excellent`, `good`, `fair`, `needs-work`, and students from
another league are ignored. Nothing in this module writes to `scores` or
`score_history`: **an evaluation never changes league points** (asserted by a test).

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
| GET | `/student/questions` | — | `{ items (with the caller's answers) }` |
| POST | `/student/questions/:id/answers` | `{ body }` | `201 { ok: true }` |
| GET | `/student/schedule` | — | `{ slots, days[{ index, label }] }` |
| GET | `/student/files` | — | `{ items }` |
| PATCH | `/student/settings` | `{ persianDigits }` | `{ ok, persianDigits }` |
| GET | `/student/timeline` | `?page=&limit=` | `{ items, total, series, page, limit }` |

A student only ever reaches its **own** records: the portal is scoped by the
session's student row, and there is no endpoint that accepts another student id.

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
 Test Files  20 passed (20)
      Tests  242 passed (242)
```

| Suite | Tests | Covers |
| --- | --- | --- |
| `auth.test.js` | 12 | Login success/failure, wrong password, unknown user, rate limiting, role separation, logout, password change, missing and stale CSRF tokens |
| `authorization.test.js` | 12 | Teacher A cannot read/write teacher B's league; students blocked from teacher endpoints |
| `validation.test.js` | 11 | zod rejections with `VALIDATION_ERROR` + `details`, bad ids, out-of-range values |
| `scores.test.js` | 10 | Transactional commit with several deltas, totals, history rows, zero-delta rejection, matrix shape |
| `columns.test.js` | 7 | Create/rename/step, delete with keep vs discard |
| `teams.test.js` | 8 | Team scoring formula on/off, assignment, unassigned panel, adjustments |
| `attendance.test.js` | 8 | Daily set, bulk "all present", counters, history, summary ratios |
| `ranking.test.js` | 5 | Competition ranking with ties, title thresholds |
| `jalali.test.js` | 16 | Gregorian↔Jalali round-trips, leap years (1399/1403 vs 1400), month lengths, reference dates |
| `uploads.test.js` | 11 | Allowed/blocked extensions, MIME and size checks, filename sanitization, authorization on download |
| `raffle.test.js` | 11 | Randomness, exclude-previous, pool cycling, history, reset |
| `tools.test.js` | 13 | Wheel segments, shuffle, timer set/adjust/clear, live board payload |
| `student.test.js` | 20 | Dashboard series/medals, report card totals + session lines with derived quality and subject/date filters, grade setting, own attendance/history, likes quota, self-like rejection, settings |
| `evaluations.test.js` | 18 | Evaluation CRUD + column reference, numeric/descriptive marks, scale and label validation, clearing a mark, subject/date filters, no transfer into league points, foreign-teacher and student isolation, own-marks student payload |
| `frontend.test.js` | 33 | jsdom: RTL attributes, no external/CDN assets, XSS-safe rendering, Persian normalization, digit formatting, router, chart config, teacher dashboard (12 tiles), staged score commit, team chip assignment, student dashboard + chart, report card bands/session cards/filters, evaluation vocabulary parity, teacher evaluation form/mark sheet/quick-fill, student evaluation cards, modal focus/footer lifecycle |
| `frontendApi.test.js` | 4 | Client CSRF lifecycle: token warm-up, single retry after `INVALID_CSRF`, no retry on plain permission errors, network error mapping |
| `moduleLinks.test.js` | 2 | Static link check over `public/js`: every relative named import resolves to a real export (the browser loads these modules natively, so a typo breaks the app — Vite's jsdom transform does not) |
| `githubBackup.test.js` | 22 | Off-site backups against an in-memory GitHub Contents API: upload + manifest checksum, full push→restore round trip, retention/pruning, public-repo refusal, size limit, missing repo and 404 handling, checksum-mismatch safety, restore skipped for a non-empty database, scheduler due-time/retry/state handling with the real logger object |
| `bootstrap.test.js` | 7 | First teacher account: creation, password verification, skip when accounts exist, `--force` reset, refusal of short/demo-default passwords, production-vs-development default |
| `hardening.test.js` | 12 | Anonymous requests create no session row, logout clears the configured cookie, login performs a bcrypt comparison for unknown users, `/healthz` integrity scan is cached, expired sessions are swept, `TRUST_PROXY` fails closed |

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
| Teacher login → dashboard | ✅ 12 tool tiles, stat cards, league switcher |
| Individual league table | ✅ 22 students, 8 default columns (step 25), staged `+25` preview, row commit → server-confirmed total |
| Teams / attendance / raffle / wheel / live board / timer / homework / Q&A / schedule / files / evaluations | ✅ all 11 tool routes render, no console errors |
| Attendance bulk "همه حاضر" | ✅ `۰ ثبت‌نشده` → `۲۲ حاضر` |
| Raffle draw | ✅ winner shown, "21 remaining", pool exclusion works |
| Logout → login as another user | ✅ (this flow exposed a stale-CSRF bug that is now fixed and tested) |
| Student login + dashboard | ✅ greeting `👋 سلام علی!`, points/rank/championship cards, Chart.js line chart with 16 points and Jalali labels |
| Course evaluation (numeric) | ✅ form auto-filled مقطع `ابتدایی` / پایه `ششم` from the league setting, saved `ریاضی — آزمون فصل ۲`, linked to the `ریاضی` column as a reference only, mark sheet rendered 22 students, «نمرهٔ کامل» filled all 22 in one click, list row `میانگین ۱۹.۹۱ · ثبت‌شده ۲۲/۲۲`, band chips `🌟 عالی / 👍 خوب / 🙂 قابل قبول` by mark |
| Course evaluation (توصیفی) | ✅ kind switch exposes `خیلی خوب / خوب / قابل قبول / نیاز به تلاش` selects, bulk-fill + save → `📝 توصیفی · میانگین — · ثبت‌شده ۲۲/۲۲` |
| Evaluation filters | ✅ subject filter `هدیه` → 1 row, «پاک کردن» → 2 rows |
| No transfer into league points | ✅ امتیاز کل stayed `۳۳۳` (رتبه `۱۱`) across both evaluations and `score_history` gained no rows |
| Student ارزشیابی tab | ✅ own mark `۱۸` with `💎 خیلی خوب`, `میانگین کلاس ۱۹.۹۱`, `رتبهٔ ۲۲ از ۲۲`; the descriptive row shows `👍 خوب`; class aggregates only, no classmate named |
| All 9 student tabs | ✅ render with no errors and no horizontal scroll |
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
   from `X-Forwarded-For` instead of the proxy address.
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
prunes older snapshots down to `BACKUP_GITHUB_KEEP`.

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
server checks at boot whether the local database has **any** application table. If
it has none — a fresh volume, a wiped container — the newest snapshot is
downloaded, checksum-verified and put in place before the migrations run:

```json
{"msg":"database restored from GitHub","file":"league-20261019T145242Z.db","bytes":417792,"sha256":"da39…0d49"}
```

A database that already has data is never replaced, so an old snapshot cannot
overwrite a live term. A failed download or a checksum mismatch leaves the local
file untouched and only logs the error. To restore a specific older snapshot,
download it from the repository and follow the local restore steps above.

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
| Teacher | `teacher` | `teacher1234` |
| Student | `student1` | `student1234` |

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
* **Polling, not push.** The live board and the league timer refresh on an
  interval; there is no WebSocket/SSE channel.
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
  the database, so a long retention window fills the backup repository over time; Git also
  keeps every uploaded version in history, so prune with `BACKUP_GITHUB_KEEP` rather than
  expecting space to be freed.
* **No email/SMS.** Password recovery is manual (teacher resets student passwords).
* **No i18n framework.** The UI is Persian-only; `APP_NAME` is the single
  configurable brand string.
* **Rate limiting is in-memory per process.** Restarting the server resets the
  counters, and a multi-instance deployment would need a shared store.
* **Accessibility is partial.** Focus management, keyboard navigation and focus
  rings are implemented, but the app has not been audited against WCAG 2.2 AA
  (for example, some emoji-only controls rely on `aria-label`).
