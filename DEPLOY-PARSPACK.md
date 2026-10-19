# Deploying «لیگ جامع دانش‌آموزی» on Parspack PaaS

This is the deployment guide **for this project**. It replaces the earlier draft that
described a two-app setup (a separate Express API and a Next.js frontend) belonging to a
different project — nothing here is split in two.

```
GitHub repo (main)  ──►  ONE Parspack app (Node.js, Express 5)
                          ├── REST API            /api/v1/*
                          ├── static frontend     /  (no build step)
                          └── SQLite file         $DATA_DIR/league.db
                                  ▲
                                  └── automatic snapshot → GitHub (private repo)
```

| Concern | How this project handles it |
| --- | --- |
| Number of apps | **One.** The same process serves the API and the frontend. |
| Frontend build | None. `public/` is committed and served as-is. |
| HTTP port | `PORT` (the platform's value wins), bound to `HOST=0.0.0.0`. |
| Database | SQLite through **better-sqlite3** (native module, WAL). |
| Migrations | Run automatically on boot — no separate migrate step. |
| First account | `BOOTSTRAP_TEACHER_*` (production never inserts demo data). |
| Durability | Snapshots pushed to a **private GitHub repo** on an interval, restored automatically when a redeploy leaves an empty database. |
| CDN / external services | None. Chart.js and the Vazirmatn fonts ship inside `public/vendor`. |

---

## 0. What you need

- A Parspack account with PaaS credit.
- The code on GitHub `main` (`https://github.com/Asgh24/student-league`).
- A domain or subdomain (Parspack also offers a default `*.parspack` domain).
- A **private** GitHub repository for backups (step 4) — optional but strongly recommended.

Decide one value before you start:

| Value | Where it comes from | Example |
| --- | --- | --- |
| `DATA_DIR` | The mount path Parspack gives the persistent disk | `/data` or `/home/app/data` |
| `SESSION_SECRET` | Generate it yourself (see below) | 64 hex characters |
| Node version | Node.js **22** (see the `better-sqlite3` note) | `22` |

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 1. Create the app

1. Dashboard → **ساخت اپلیکیشن** → **زبان‌های برنامه‌نویسی** → **Node.js** → **پیکربندی**.
2. **Source (اتصال کد):** **Git** → GitHub → `https://github.com/Asgh24/student-league.git`,
   Branch `main`.
   (Public repository: nothing to authorize. Private: use **دسترسی به GitHub**.)
3. **تنظیمات اولیه:**

   | Field | Value |
   | --- | --- |
   | App name | `student-league` |
   | Domain | your domain, e.g. `league.example.com` |
   | Application port | the port the panel injects, or `3000` — the app reads `PORT` |

4. **پارامترهای اختیاری:**

   | Field | Value | Why |
   | --- | --- | --- |
   | **Context** | empty (repository root) | `package.json`, `server.js` and `public/` are at the root. The old draft's `backend/` + `frontend/` contexts do not exist here. |
   | **Version (Node)** | `20` or `22` | See the `better-sqlite3` note below. |
   | Install command | `npm ci` (or the default `npm install`) | The committed `package-lock.json` pins `better-sqlite3` 13.x, whose Node-API binary ships in the package — nothing compiles. |
   | Start command | `node server.js` | Equivalent to `npm start`; it applies migrations on boot. |
   | Version (Node) | `22` | `better-sqlite3` 13 declares `>=22`; on Node 20 npm reports `EBADENGINE`. |

5. **تنظیمات منابع:** start with a small plan (512 MB RAM is plenty). **Replicas = 1.**
   SQLite has a single writer and the app assumes one process — do not scale the
   backend horizontally.

### `better-sqlite3` (the only native dependency) — nothing to compile

`better-sqlite3` 13 is a **Node-API** addon: the compiled binary is committed inside
the npm package itself (`prebuilds/linux-x64.node` for glibc,
`prebuilds/linuxmusl-x64.node` for Alpine/musl, plus arm64/macOS/Windows). Node-API is
ABI-stable, so there is **no `node-gyp`, no compiler and no download step** during
`npm ci` on either a Debian-based or an Alpine-based image.

The only constraint is the declared engine: `better-sqlite3` 13 requires **Node 22 or
newer** (`"engines": { "node": ">=22" }`). Pick Node **22** in the panel. On Node 20
npm prints `EBADENGINE` for that dependency — that is the signal to move up, not a
build problem.

If the install log shows `node-gyp` or `g++`, you are installing something else (for
example `better-sqlite3` was resolved to an older major version through a stale
`package-lock.json`) — run `npm ci` from the committed lockfile, which pins 13.x.

### Persistent disk (do not skip)

Attach a persistent volume and mount it at the path you will use for `DATA_DIR`.
Without it, every redeploy or container restart can start from a fresh filesystem.

| Without a persistent disk | With a persistent disk |
| --- | --- |
| `league.db` and `DATA_DIR/uploads` are gone on redeploy | Data survives redeploys |
| Recovery depends entirely on the GitHub snapshots (step 4) | Local file is authoritative, backups are a second copy |

---

## 2. Environment variables

Set these in the panel (**متغیر محیطی**). Use the **Secret** type for every value marked
secret.

```ini
NODE_ENV=production
PORT=3000                      # or the value the panel injects
HOST=0.0.0.0
APP_NAME=لیگ جامع دانش‌آموزی

DATA_DIR=/data                 # the mounted persistent disk
SESSION_SECRET=<64 random hex characters>          # SECRET
TRUST_PROXY=true               # the platform terminates TLS in front of the app
APP_TZ_OFFSET_MINUTES=210      # Iran Standard Time (UTC+03:30)

# First teacher account, created only while the database has no accounts at all
BOOTSTRAP_TEACHER=true
BOOTSTRAP_TEACHER_USER=teacher
BOOTSTRAP_TEACHER_PASS=<a real password, 8+ chars> # SECRET
BOOTSTRAP_TEACHER_NAME=مدیر

# Do NOT enable the demo seed in production (see step 3)
SEED_ENABLED=false

# Automatic off-site backups (step 4)
BACKUP_GITHUB_ENABLED=true
BACKUP_GITHUB_REPO=Asgh24/league-backups           # PRIVATE repository
BACKUP_GITHUB_TOKEN=github_pat_xxx                 # SECRET
BACKUP_GITHUB_BRANCH=main
BACKUP_GITHUB_DIR=db-backups
BACKUP_GITHUB_INTERVAL_MINUTES=1440
BACKUP_GITHUB_KEEP=7
RESTORE_FROM_GITHUB_ON_EMPTY_LOCAL=true

LOG_LEVEL=info
```

Everything else has a sane default; the complete list is in `.env.example` and in the
README's environment table. You can also upload a file named exactly `.env` instead of
typing each variable — `.env` is git-ignored, so it never ends up in the repository.

---

## 3. First boot and first login

Look for these lines in the app log:

```json
{"msg":"database ready","applied":["001_core","002_tools","003_evaluations"]}
{"msg":"bootstrap: created the first teacher \"teacher\" — log in and change the password"}
{"msg":"server listening","port":3000,"host":"0.0.0.0","env":"production","version":"1.0.0"}
```

1. Open `https://<your-domain>/healthz` → `{"status":"ok", ...}`.
2. Open the app, log in with `BOOTSTRAP_TEACHER_USER` / `BOOTSTRAP_TEACHER_PASS`.
3. **Change the password immediately** — teacher drawer → **تنظیمات** → change password
   (`POST /api/v1/auth/password`).
4. Remove `BOOTSTRAP_TEACHER_PASS` from the panel and redeploy. It is only read while the
   database has no accounts, but the secret should not sit there unused.
5. Create your real league, students and score columns. No demo data exists — that is
   intentional.

### Logging in over plain HTTP cannot work (by design)

In production the session cookie is sent with `Secure; HttpOnly; SameSite=Lax`. Verified on a
real production boot:

* Over `http://…` Express does not set the cookie at all, so **every** login answers
  `INVALID_CSRF` («توکن امنیتی نامعتبر است. صفحه را دوباره بارگذاری کنید») even with the right
  password. Do not test with the container's local port — test the `https://` address.
* With the platform proxy in front, `TRUST_PROXY=true` is what makes Express see
  `X-Forwarded-Proto: https`. Keep the certificate enabled *and* `TRUST_PROXY=true`; with both,
  the cookie is set, `/api/v1/auth/login` returns 200 and `/api/v1/auth/me` returns the user.

### Forgotten password

The bootstrap script is the supported recovery path (open the app terminal in the panel):

```bash
npm run bootstrap -- --force      # resets to the current BOOTSTRAP_TEACHER_PASS value
```

It refuses to run without a usable password and refuses the known demo defaults
(`teacher1234`, `student1234`, …) unless `BOOTSTRAP_ALLOW_WEAK=true`.

### Never run `npm run seed` in production

`npm run seed` inserts 22 fake students, teams, attendance and score history. On a real
class database that is noise you would have to delete by hand. The command already
refuses to run when `NODE_ENV=production` unless `SEED_FORCE=true`; leave it that way.

---

## 4. Automatic backups to GitHub

Why this matters: Parspack can recreate the container filesystem at any time (redeploy,
migration to another host, a crashed container). A snapshot stored *inside* that
filesystem is not a backup. With this feature the newest database snapshot lives in a
GitHub repository, and an **empty** local database is replaced by that snapshot on boot.

### 4.1 Create a private backup repository

New repository → name it e.g. `league-backups` → **Private** → create (no README needed).

The snapshot contains student names, marks and attendance, so the app **refuses to
upload to a public repository** unless `BACKUP_GITHUB_ALLOW_PUBLIC=true` is set
explicitly. Keep it private.

### 4.2 Create a token

GitHub → **Settings → Developer settings → Personal access tokens → Fine-grained tokens
→ Generate new token**:

- **Repository access:** Only select repositories → `league-backups`.
- **Permissions → Repository permissions → Contents: Read and write.**
- Expiration: 1 year (calendar a reminder to rotate it).

Copy the token (starts with `github_pat_`) into `BACKUP_GITHUB_TOKEN`.

### 4.3 Configure

```ini
BACKUP_GITHUB_ENABLED=true
BACKUP_GITHUB_REPO=Asgh24/league-backups
BACKUP_GITHUB_TOKEN=github_pat_xxx
BACKUP_GITHUB_BRANCH=main
BACKUP_GITHUB_DIR=db-backups
BACKUP_GITHUB_INTERVAL_MINUTES=1440   # once a day; 60 = hourly, 10080 = weekly
BACKUP_GITHUB_KEEP=7                  # keep the newest 7 snapshots, 0 = keep all
BACKUP_GITHUB_MAX_MB=50               # refuse (and log) oversized snapshots
BACKUP_GITHUB_START_DELAY_MS=60000    # wait a minute after boot before the first upload
RESTORE_FROM_GITHUB_ON_EMPTY_LOCAL=true
```

Apply the variables, then redeploy. On boot you should see:

```json
{"msg":"GitHub backup scheduled","repo":"Asgh24/league-backups","everyMinutes":1440,"nextBackupInMinutes":1}
```

### 4.4 Verify, and take a backup right now

```bash
npm run backup:github            # upload a snapshot immediately
npm run backup:status            # what is stored remotely (count, newest, checksum)
```

Open the backup repository: you should see `db-backups/league-<timestamp>.db` plus
`db-backups/latest.json`. The manifest holds the file name, size, SHA-256, creation time,
app version and the number of applied migrations — that is what a restore trusts.

Log lines to expect:

```json
{"msg":"backup pushed to GitHub","file":"league-20261019T145242Z.db","bytes":417792,"sha256":"…","pruned":[]}
{"msg":"scheduled GitHub backup complete","file":"league-…Z.db"}
```

When more than `BACKUP_GITHUB_KEEP` snapshots exist the oldest are deleted
(`{"msg":"pruned old snapshot","file":"…"}`); `latest.json` is never deleted.

### 4.5 How the restore works

`RESTORE_FROM_GITHUB_ON_EMPTY_LOCAL=true` (default):

- **On boot only**, and **only when the local database has no application tables at all**
  (fresh container, missing file). A database that already has data is never replaced, so
  an old snapshot can never overwrite a real one.
- The snapshot is downloaded, its SHA-256 is checked against the manifest, and only then
  is the local file replaced. A failed download or checksum mismatch leaves the local file
  untouched and the app starts empty with an error in the log.
- Expected log after a wiped container:

  ```json
  {"msg":"database restored from GitHub","file":"league-20261019T145242Z.db","bytes":417792,"sha256":"…"}
  ```

- Restores have no effect while `BACKUP_GITHUB_REPO`/`BACKUP_GITHUB_TOKEN` are unset, so
  the feature is inert until you configure it. Set
  `RESTORE_FROM_GITHUB_ON_EMPTY_LOCAL=false` if you only want uploads.

**Manual restore** (a database that exists but is damaged, or a specific older snapshot):

```bash
# 1. pick the snapshot in the backup repository and download it inside the app terminal
# 2. stop the app from the panel
# 3. replace the database and drop the SQLite sidecars
rm -f  "$DATA_DIR/league.db" "$DATA_DIR/league.db-wal" "$DATA_DIR/league.db-shm"
cp /tmp/league-20261019T145242Z.db "$DATA_DIR/league.db"
# 4. start the app again — migrations run on boot and are no-ops for an up-to-date schema
```

### 4.6 What is not in the snapshot

`DATA_DIR/uploads` (files uploaded with «ارسال فایل») lives outside the database, so it is
**not** in the snapshot — the same limitation as the local `npm run backup`. In practice,
copy that folder to your own storage, or accept re-uploading those files after a container
reset. The rest of the app (leagues, students, scores, attendance, evaluations) is fully
covered.

---

## 5. Health check, HTTPS and the proxy

- **Health-check path:** `/healthz` (200 when SQLite answers; it caches the integrity
  check so it cannot be used to hammer the disk).
- **HTTPS:** enable the platform's certificate and keep `TRUST_PROXY=true`. With it the
  session cookie is marked `Secure` and rate limiting reads the real client IP from
  `X-Forwarded-For` instead of the proxy address.
- The app serves the API and the frontend on the same origin, so the reverse proxy is a
  plain pass-through:

  ```nginx
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 120s;
    client_max_body_size 12m;   # a little above MAX_UPLOAD_BYTES (10 MB)
  }
  ```

---

## 6. Updates and redeploys

1. Push to GitHub `main`.
2. Redeploy in the panel (or let the platform's auto-deploy pick it up).
3. On boot: pending migrations are applied, then the server listens. If the filesystem was
   recreated, the newest snapshot is restored first.

Nothing else is needed: there is no build step, no asset pipeline and no cache to clear.
Browser assets are covered by `helmet`'s CSP and versioned by the app itself, so a hard
refresh is never required for correctness.

---

## 7. Scaling, so you do not lose data

- **1 instance, always.** Two processes writing one SQLite file is not supported.
- Snapshots taken from a running server are consistent (SQLite online backup API), so you
  do not need a maintenance window for backups.
- If you ever need multiple instances or more throughput, that is the moment to move to
  managed PostgreSQL — a code change, not a configuration change.

---

## 8. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Build fails in `better-sqlite3` (`node-gyp`, `g++: not found`) | An older major version was resolved, or a stale lockfile | Use the committed `package-lock.json` (`npm ci`); 13.x needs no compiler |
| Install prints `EBADENGINE … better-sqlite3 … required {"node":">=22"}` | The panel runs Node 20, below the declared floor | Switch the app to Node 22 and redeploy |
| Login appears to succeed but the session does not stick | Cookies marked `Secure` while TLS is terminated at the proxy, or `TRUST_PROXY` is `false` | Enable the certificate and set `TRUST_PROXY=true` |
| Every login fails with `INVALID_CSRF` / «توکن امنیتی نامعتبر است» | The app is being used over plain `http://` in production, so the `Secure` session cookie is never set | Open the `https://` address and keep `TRUST_PROXY=true` |
| `502` right after deploy | The app binds a different port than the panel proxies | Leave `PORT` unset so the injected value is used; keep `HOST=0.0.0.0` |
| Data disappears after a redeploy | `DATA_DIR` is not on the persistent disk | Mount the volume and set `DATA_DIR` to that path |
| `GitHub backup is enabled but not configured` | `BACKUP_GITHUB_REPO` and `BACKUP_GITHUB_TOKEN` are not both set | Set both, or set `BACKUP_GITHUB_ENABLED=false` |
| `refusing to back up to the public repository "…"` | The guard against publishing student data | Point `BACKUP_GITHUB_REPO` at a private repo (or set `BACKUP_GITHUB_ALLOW_PUBLIC=true` deliberately) |
| `GitHub repository "…" was not found` | Wrong `owner/name`, or the token lacks `Contents` access | Check the name and the token's repository selection |
| `GitHub ... failed (401)` | Expired or wrong token | Create a new token, update `BACKUP_GITHUB_TOKEN`, redeploy |
| `snapshot is … MB, above BACKUP_GITHUB_MAX_MB` | The database grew past the configured limit | Raise `BACKUP_GITHUB_MAX_MB` (GitHub rejects files over 100 MB) |
| `checksum mismatch for league-….db` | Truncated/corrupted upload stored in GitHub | Take a fresh `npm run backup:github`, then remove the bad snapshot |
| The app started but the data looks older than expected | A wiped container was restored from the newest snapshot (which was a day old) | Expected behaviour; shorten `BACKUP_GITHUB_INTERVAL_MINUTES` or set `RESTORE_FROM_GITHUB_ON_EMPTY_LOCAL=false` |

---

## 9. Go-live checklist

- [ ] App created from GitHub `main`, Node 22, start command `node server.js`.
- [ ] Persistent disk mounted at `DATA_DIR`.
- [ ] `NODE_ENV=production`, `SESSION_SECRET`, `TRUST_PROXY=true` set (secrets as secret type).
- [ ] `SEED_ENABLED=false`.
- [ ] `https://<domain>/healthz` returns 200.
- [ ] First login with the bootstrapped teacher, password changed in **تنظیمات**.
- [ ] `BOOTSTRAP_TEACHER_PASS` removed from the panel.
- [ ] Backup repository created (**private**) and `BACKUP_GITHUB_*` set.
- [ ] `npm run backup:status` lists a snapshot; the repo shows `db-backups/latest.json`.
- [ ] Restore path exercised once: after the next redeploy the log shows either
      `database ready` (disk survived) or `database restored from GitHub` (fresh disk) —
      never an empty app.
- [ ] Real league and students entered; demo seed never run.
