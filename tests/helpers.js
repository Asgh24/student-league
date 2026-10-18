import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { closeDatabase, openDatabase } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';
import { migrations } from '../src/migrations/index.js';

/** Creates an isolated temporary SQLite database with all migrations applied. */
export function createTestDatabase() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scl-test-'));
  process.env.DATA_DIR = dir;
  fs.mkdirSync(path.join(dir, 'uploads'), { recursive: true });
  const db = openDatabase(path.join(dir, 'test.db'));
  runMigrations(db, migrations);
  return {
    db,
    dir,
    uploadsDir: path.join(dir, 'uploads'),
    cleanup() {
      closeDatabase(db);
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

/**
 * A supertest client that keeps the session cookie and remembers the CSRF
 * token, mirroring what the browser frontend does.
 */
export function createClient(db) {
  const app = createApp({ db });
  const agent = request.agent(app);
  let token = null;

  const client = {
    app,
    agent,
    get token() {
      return token;
    },
    async csrf() {
      const res = await agent.get('/api/v1/auth/csrf');
      token = res.body?.csrfToken ?? token;
      return token;
    },
    async login(username, password) {
      await client.csrf();
      const res = await agent.post('/api/v1/auth/login').set('x-csrf-token', token).send({ username, password });
      if (res.body?.csrfToken) token = res.body.csrfToken;
      return res;
    },
    async logout() {
      return agent.post('/api/v1/auth/logout').set('x-csrf-token', token).send({});
    },
    get: (url) => agent.get(url),
    post: (url, body = {}) => agent.post(url).set('x-csrf-token', token).send(body),
    patch: (url, body = {}) => agent.patch(url).set('x-csrf-token', token).send(body),
    put: (url, body = {}) => agent.put(url).set('x-csrf-token', token).send(body),
    del: (url) => agent.delete(url).set('x-csrf-token', token),
    postRaw: (url, body, headers = {}) => agent.post(url).set(headers).send(body),
    upload(url, { filename, buffer, contentType = 'application/octet-stream', fields = {} }) {
      const req = agent.post(url).set('x-csrf-token', token);
      for (const [key, value] of Object.entries(fields)) req.field(key, value);
      return req.attach('file', buffer, { filename, contentType });
    },
  };
  return client;
}
