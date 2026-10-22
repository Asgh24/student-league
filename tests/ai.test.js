import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decryptSecret } from '../src/lib/secrets.js';
import { buildFixture } from './fixtures.js';
import { createClient, createTestDatabase } from './helpers.js';

let ctx;
let fixture;
let teacher;
let student;

beforeEach(async () => {
  delete process.env.GROQ_API_KEY;
  delete process.env.GROQ_MODEL;
  delete process.env.GROQ_BASE_URL;
  ctx = createTestDatabase();
  fixture = buildFixture(ctx.db);
  teacher = createClient(ctx.db);
  student = createClient(ctx.db);
  await teacher.login('teacher-a', 'password-a1');
  await student.login('student-a', 'student-a1');
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GROQ_API_KEY;
  delete process.env.GROQ_MODEL;
  delete process.env.GROQ_BASE_URL;
  ctx.cleanup();
});

function sampleQuestions() {
  return {
    questions: [
      {
        body: 'پایتخت ایران کجاست؟',
        options: ['تهران', 'مشهد', 'شیراز', 'تبریز'],
        correctIndex: 0,
        points: 25,
      },
      {
        body: 'حاصل ۲ + ۳ چند است؟',
        options: ['۴', '۵', '۶'],
        correctIndex: 1,
        points: 25,
      },
    ],
  };
}

function groqResponse(content, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({
      choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }],
    }),
  };
}

async function saveTeacherKey(apiKey = 'gsk_teacher_test_1234567890') {
  return teacher.put('/api/v1/ai/settings', { apiKey });
}

describe('teacher Groq settings', () => {
  it('returns write-only status and falls back from teacher to server to none', async () => {
    const initial = await teacher.get('/api/v1/ai/settings');
    expect(initial.status).toBe(200);
    expect(initial.body.config).toMatchObject({
      provider: 'groq',
      configured: false,
      source: 'none',
      model: 'openai/gpt-oss-20b',
      own: { hasApiKey: false },
    });

    const saved = await saveTeacherKey();
    expect(saved.status).toBe(200);
    expect(saved.body.config).toMatchObject({
      configured: true,
      source: 'teacher',
      hasApiKey: true,
      own: { hasApiKey: true },
    });
    expect(JSON.stringify(saved.body)).not.toContain('gsk_teacher');

    const row = ctx.db.prepare('SELECT groq_api_key AS key FROM users WHERE id = ?').get(fixture.teacherA.id);
    expect(row.key).not.toBe('gsk_teacher_test_1234567890');
    expect(decryptSecret(row.key)).toBe('gsk_teacher_test_1234567890');

    process.env.GROQ_API_KEY = 'gsk_server_default';
    const stillOwn = await teacher.get('/api/v1/ai/settings');
    expect(stillOwn.body.config).toMatchObject({ configured: true, source: 'teacher' });

    const cleared = await teacher.put('/api/v1/ai/settings', { clearApiKey: true });
    expect(cleared.body.config).toMatchObject({ configured: true, source: 'server' });

    const fallback = await teacher.get('/api/v1/ai/settings');
    expect(fallback.body.config).toMatchObject({
      configured: true,
      source: 'server',
      serverConfigured: true,
    });
    expect(JSON.stringify(fallback.body)).not.toContain('gsk_server_default');
  });

  it('rejects an empty settings update and student access', async () => {
    const empty = await teacher.put('/api/v1/ai/settings', {});
    expect(empty.status).toBe(400);

    expect((await student.get('/api/v1/ai/settings')).status).toBe(403);
    expect((await student.put('/api/v1/ai/settings', { apiKey: 'gsk_nope' })).status).toBe(403);
  });
});

describe('AI question generation', () => {
  it('calls Groq with the teacher key and returns a validated preview without saving', async () => {
    await saveTeacherKey();
    const fetchMock = vi.fn().mockResolvedValue(groqResponse(
      ['```json', JSON.stringify({
        questions: [
          ...sampleQuestions().questions,
          {
            body: 'سؤال تکراری؟',
            options: ['یک', 'دو', 'سه'],
            correctIndex: 0,
          },
        ],
      }), '```'].join('\n'),
    ));
    vi.stubGlobal('fetch', fetchMock);

    const res = await teacher.post(`/api/v1/leagues/${fixture.leagueA.id}/ai/questions`, {
      topic: 'جغرافیا و ریاضی پایه',
      count: 2,
      difficulty: 'easy',
      notes: 'فقط دو سؤال کوتاه',
    });

    expect(res.status).toBe(200);
    expect(res.body.questions).toEqual([
      {
        body: 'پایتخت ایران کجاست؟',
        options: ['تهران', 'مشهد', 'شیراز', 'تبریز'],
        correctIndex: 0,
        points: 25,
      },
      {
        body: 'حاصل ۲ + ۳ چند است؟',
        options: ['۴', '۵', '۶'],
        correctIndex: 1,
        points: 25,
      },
    ]);
    expect(res.body.meta).toMatchObject({
      provider: 'groq',
      model: 'openai/gpt-oss-20b',
      source: 'teacher',
      requested: 2,
      generated: 2,
      difficulty: 'easy',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer gsk_teacher_test_1234567890');
    const sent = JSON.parse(init.body);
    expect(sent).toMatchObject({
      model: 'openai/gpt-oss-20b',
      stream: false,
      temperature: 0.7,
      top_p: 1,
      max_completion_tokens: 4096,
      reasoning_effort: 'medium',
    });
    expect(sent.messages[1].content).toContain('جغرافیا و ریاضی پایه');
    expect(sent.messages[1].content).toContain('فقط دو سؤال کوتاه');
    expect(JSON.stringify(res.body)).not.toContain('gsk_teacher');

    const saved = ctx.db.prepare('SELECT COUNT(*) AS count FROM questions WHERE league_id = ?')
      .get(fixture.leagueA.id);
    expect(saved.count).toBe(0);
  });

  it('uses the server key when the teacher has not saved one', async () => {
    process.env.GROQ_API_KEY = 'gsk_server_default';
    const fetchMock = vi.fn().mockResolvedValue(groqResponse(sampleQuestions()));
    vi.stubGlobal('fetch', fetchMock);

    const res = await teacher.post(`/api/v1/leagues/${fixture.leagueA.id}/ai/questions`, {
      topic: 'علوم',
      count: 2,
    });

    expect(res.status).toBe(200);
    expect(res.body.meta.source).toBe('server');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer gsk_server_default');
  });

  it('returns a clear error when no key is configured', async () => {
    const res = await teacher.post(`/api/v1/leagues/${fixture.leagueA.id}/ai/questions`, {
      topic: 'ریاضی',
      count: 3,
    });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('AI_NOT_CONFIGURED');
  });

  it('rejects malformed model output and provider failures', async () => {
    await saveTeacherKey();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(groqResponse('not json at all')));
    const malformed = await teacher.post(`/api/v1/leagues/${fixture.leagueA.id}/ai/questions`, {
      topic: 'ریاضی',
      count: 3,
    });
    expect(malformed.status).toBe(502);
    expect(malformed.body.error.code).toBe('AI_INVALID_RESPONSE');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }));
    const unauthorized = await teacher.post(`/api/v1/leagues/${fixture.leagueA.id}/ai/questions`, {
      topic: 'ریاضی',
      count: 3,
    });
    expect(unauthorized.status).toBe(502);
    expect(unauthorized.body.error.code).toBe('AI_PROVIDER_ERROR');
    expect(JSON.stringify(unauthorized.body)).not.toContain('gsk_teacher');
  });

  it('does not allow another teacher to generate for a foreign league', async () => {
    const other = createClient(ctx.db);
    await other.login('teacher-b', 'password-b1');
    const res = await other.post(`/api/v1/leagues/${fixture.leagueA.id}/ai/questions`, {
      topic: 'ریاضی',
      count: 2,
    });
    expect(res.status).toBe(403);
  });
});

describe('reviewed AI bulk save', () => {
  it('saves selected multiple-choice questions and exposes them to the teacher', async () => {
    const res = await teacher.post(`/api/v1/leagues/${fixture.leagueA.id}/questions/bulk`, {
      questions: sampleQuestions().questions,
    });
    expect(res.status).toBe(201);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items[0]).toMatchObject({
      body: 'پایتخت ایران کجاست؟',
      type: 'multiple_choice',
      correctIndex: 0,
      points: 25,
      answerCount: 0,
    });

    const list = await teacher.get(`/api/v1/leagues/${fixture.leagueA.id}/questions`);
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(2);
    expect(list.body.items.map((question) => question.body)).toContain('حاصل ۲ + ۳ چند است؟');
  });

  it('validates the batch and prevents students from saving questions', async () => {
    const empty = await teacher.post(`/api/v1/leagues/${fixture.leagueA.id}/questions/bulk`, {
      questions: [],
    });
    expect(empty.status).toBe(400);

    const invalid = await teacher.post(`/api/v1/leagues/${fixture.leagueA.id}/questions/bulk`, {
      questions: [{
        body: 'سؤال بد',
        points: 10,
        options: ['یک', 'دو'],
        correctIndex: 2,
      }],
    });
    expect(invalid.status).toBe(400);

    const denied = await student.post(`/api/v1/leagues/${fixture.leagueA.id}/questions/bulk`, {
      questions: sampleQuestions().questions,
    });
    expect(denied.status).toBe(403);
  });
});
