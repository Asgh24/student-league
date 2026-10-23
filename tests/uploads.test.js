import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLeague } from '../src/repositories/leagues.js';
import { buildFixture } from './fixtures.js';
import { createClient, createTestDatabase } from './helpers.js';
import { sanitizeFilename, validateUpload } from '../src/routes/files.js';

let ctx;
let fixture;
let client;

const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');

beforeEach(async () => {
  ctx = createTestDatabase();
  fixture = buildFixture(ctx.db);
  client = createClient(ctx.db);
  await client.login('teacher-a', 'password-a1');
});

afterEach(() => {
  ctx.cleanup();
  delete process.env.MAX_UPLOAD_BYTES;
  delete process.env.TEACHER_STORAGE_MB;
});

describe('file sharing', () => {
  it('uploads an allowed file and lists it', async () => {
    const res = await client.upload(`/api/v1/leagues/${fixture.leagueA.id}/files`, {
      filename: 'تکلیف.pdf',
      buffer: PDF,
      contentType: 'application/pdf',
      fields: { description: 'تکلیف هفته اول' },
    });
    expect(res.status).toBe(201);
    expect(res.body.file.originalName).toBe('تکلیف.pdf');
    expect(res.body.file.size).toBe(PDF.length);

    const list = await client.get(`/api/v1/leagues/${fixture.leagueA.id}/files`);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].description).toBe('تکلیف هفته اول');
  });

  it('rejects an executable extension', async () => {
    const res = await client.upload(`/api/v1/leagues/${fixture.leagueA.id}/files`, {
      filename: 'payload.exe',
      buffer: Buffer.from('MZ'),
      contentType: 'application/octet-stream',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('EXTENSION_BLOCKED');
  });

  it('rejects an extension outside the allowlist', async () => {
    const res = await client.upload(`/api/v1/leagues/${fixture.leagueA.id}/files`, {
      filename: 'notes.xyz',
      buffer: PDF,
      contentType: 'application/pdf',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('EXTENSION_NOT_ALLOWED');
  });

  it('rejects a mime type that contradicts the extension', async () => {
    const res = await client.upload(`/api/v1/leagues/${fixture.leagueA.id}/files`, {
      filename: 'image.pdf',
      buffer: Buffer.from('89504e470d0a1a0a', 'hex'),
      contentType: 'image/png',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MIME_MISMATCH');
  });

  it('rejects a file larger than the configured limit', async () => {
    process.env.MAX_UPLOAD_BYTES = '512';
    const small = createClient(ctx.db);
    await small.login('teacher-a', 'password-a1');
    const res = await small.upload(`/api/v1/leagues/${fixture.leagueA.id}/files`, {
      filename: 'big.pdf',
      buffer: Buffer.alloc(4096, 0x41),
      contentType: 'application/pdf',
    });
    expect(res.status).toBe(413);
  });

  it('requires a file in the multipart body', async () => {
    const res = await client.post(`/api/v1/leagues/${fixture.leagueA.id}/files`, {});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('NO_FILE');
  });

  it('lets the owner download and blocks another teacher', async () => {
    const upload = await client.upload(`/api/v1/leagues/${fixture.leagueA.id}/files`, {
      filename: 'sheet.pdf',
      buffer: PDF,
      contentType: 'application/pdf',
    });
    const fileId = upload.body.file.id;

    const owner = await client.get(`/api/v1/files/${fileId}/download`);
    expect(owner.status).toBe(200);
    expect(owner.headers['content-disposition']).toContain('attachment');
    expect(owner.headers['x-content-type-options']).toBe('nosniff');

    const other = createClient(ctx.db);
    await other.login('teacher-b', 'password-b1');
    const denied = await other.get(`/api/v1/files/${fileId}/download`);
    expect(denied.status).toBe(403);
  });

  it('lets a student of the league download but not an outsider', async () => {
    const upload = await client.upload(`/api/v1/leagues/${fixture.leagueA.id}/files`, {
      filename: 'sheet.pdf',
      buffer: PDF,
      contentType: 'application/pdf',
    });
    const fileId = upload.body.file.id;

    const studentA = createClient(ctx.db);
    await studentA.login('student-a', 'student-a1');
    expect((await studentA.get(`/api/v1/files/${fileId}/download`)).status).toBe(200);

    const studentB = createClient(ctx.db);
    await studentB.login('student-b', 'student-b1');
    expect((await studentB.get(`/api/v1/files/${fileId}/download`)).status).toBe(403);
  });

  it('deletes the file and removes the row', async () => {
    const upload = await client.upload(`/api/v1/leagues/${fixture.leagueA.id}/files`, {
      filename: 'temp.pdf',
      buffer: PDF,
      contentType: 'application/pdf',
    });
    const res = await client.del(`/api/v1/files/${upload.body.file.id}`);
    expect(res.status).toBe(200);
    expect(res.body.storage.usedBytes).toBe(0);
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM files').get().n).toBe(0);
  });

  it('shares one quota across all leagues and frees space after a delete', async () => {
    process.env.TEACHER_STORAGE_MB = '1';
    const secondLeague = createLeague(ctx.db, fixture.teacherA.id, 'لیگ دوم');
    const first = Buffer.alloc(700 * 1024, 0x41);
    const second = Buffer.alloc(400 * 1024, 0x42);

    const uploaded = await client.upload(`/api/v1/leagues/${fixture.leagueA.id}/files`, {
      filename: 'first.pdf',
      buffer: first,
      contentType: 'application/pdf',
    });
    expect(uploaded.status).toBe(201);
    expect(uploaded.body.storage.usedBytes).toBe(first.length);
    expect(uploaded.body.storage.limitBytes).toBe(1024 * 1024);

    const blocked = await client.upload(`/api/v1/leagues/${secondLeague.id}/files`, {
      filename: 'second.pdf',
      buffer: second,
      contentType: 'application/pdf',
    });
    expect(blocked.status).toBe(413);
    expect(blocked.body.error.code).toBe('STORAGE_QUOTA_EXCEEDED');
    expect(blocked.body.error.message).toContain('حذف کنید');

    const list = await client.get(`/api/v1/leagues/${secondLeague.id}/files`);
    expect(list.body.storage.usedBytes).toBe(first.length);
    expect(list.body.storage.remainingBytes).toBe(1024 * 1024 - first.length);

    const removed = await client.del(`/api/v1/files/${uploaded.body.file.id}`);
    expect(removed.status).toBe(200);
    expect(removed.body.storage.usedBytes).toBe(0);

    const retried = await client.upload(`/api/v1/leagues/${secondLeague.id}/files`, {
      filename: 'second.pdf',
      buffer: second,
      contentType: 'application/pdf',
    });
    expect(retried.status).toBe(201);
    expect(retried.body.storage.usedBytes).toBe(second.length);
  });
});

describe('upload helpers', () => {
  it('strips directories and unsafe characters from filenames', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFilename('C:\\windows\\evil.txt')).toBe('evil.txt');
    expect(sanitizeFilename('a\u200fb.txt')).toBe('ab.txt');
    expect(sanitizeFilename('')).toBe('file');
  });

  it('validates extensions directly', () => {
    expect(validateUpload('a.pdf', 'application/pdf', 10)).toBe('.pdf');
    expect(() => validateUpload('a.php', 'application/x-php', 10)).toThrowError(/مجاز نیست/);
  });
});
