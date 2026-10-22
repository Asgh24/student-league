/**
 * Groq (https://groq.com) assistant for creating multiple-choice questions.
 *
 * Teachers can save a personal Groq API key; the server-wide `GROQ_API_KEY` is
 * used only when no personal key exists. Keys are encrypted at rest and are
 * never returned by the API. Generation is a preview: this service does not
 * write questions to the database.
 */

import { config } from '../config.js';
import { AppError } from '../lib/errors.js';
import { isoNow } from '../lib/http.js';
import { decryptSecret, encryptSecret } from '../lib/secrets.js';

export const GROQ_PROVIDER = 'groq';
export const AI_DIFFICULTIES = {
  easy: 'آسان',
  medium: 'متوسط',
  hard: 'سخت',
};

const MAX_OPTIONS = 10;
const MIN_OPTIONS = 2;
const MAX_QUESTION_LENGTH = 500;
const MAX_OPTION_LENGTH = 200;

/** Reads and decrypts the Groq key a teacher saved in their own panel. */
function teacherCredentials(db, teacherId) {
  if (!db || !teacherId) {
    return { apiKey: '', updatedAt: null, hasApiKey: false };
  }
  const row = db.prepare(`
    SELECT groq_api_key AS groqApiKey, groq_updated_at AS groqUpdatedAt
    FROM users WHERE id = ?
  `).get(teacherId);
  const apiKey = decryptSecret(row?.groqApiKey);
  return {
    apiKey,
    updatedAt: row?.groqUpdatedAt ?? null,
    hasApiKey: Boolean(apiKey),
  };
}

/**
 * Public AI status for a teacher. It never contains the key itself, only where
 * the effective key comes from.
 */
export function aiConfigFor(db, { teacherId = null } = {}) {
  const groq = config.groq;
  const own = teacherCredentials(db, teacherId);
  const source = own.hasApiKey ? 'teacher' : (groq.apiKey ? 'server' : 'none');
  return {
    provider: GROQ_PROVIDER,
    configured: source !== 'none',
    source,
    model: groq.model,
    hasApiKey: source !== 'none',
    serverConfigured: Boolean(groq.apiKey),
    own: {
      hasApiKey: own.hasApiKey,
      updatedAt: own.updatedAt,
    },
  };
}

/** Saves (or clears) the teacher-scoped Groq key. */
export function saveTeacherAiSettings(db, teacherId, { apiKey, clearApiKey = false } = {}) {
  if (clearApiKey) {
    db.prepare('UPDATE users SET groq_api_key = ?, groq_updated_at = ? WHERE id = ?')
      .run('', isoNow(), teacherId);
  } else if (apiKey) {
    db.prepare('UPDATE users SET groq_api_key = ?, groq_updated_at = ? WHERE id = ?')
      .run(encryptSecret(apiKey), isoNow(), teacherId);
  }
  return aiConfigFor(db, { teacherId });
}

/** Resolves the effective key without ever exposing it to callers outside this module. */
function resolveCredentials(db, teacherId) {
  const own = teacherCredentials(db, teacherId);
  if (own.hasApiKey) {
    return { ...config.groq, apiKey: own.apiKey, source: 'teacher' };
  }
  if (config.groq.apiKey) {
    return { ...config.groq, source: 'server' };
  }
  return null;
}

function timeoutSignal(timeoutMs) {
  return globalThis.AbortSignal?.timeout?.(timeoutMs);
}

function buildPrompt({ topic, count, difficulty, notes, leagueName }) {
  const difficultyLabel = AI_DIFFICULTIES[difficulty] || AI_DIFFICULTIES.medium;
  return [
    `یک آزمون یا پرسشنامه چندگزینه‌ای فارسی با ${count} سؤال دربارهٔ «${topic}» بساز.`,
    leagueName ? `این سؤال‌ها برای کلاس «${leagueName}» هستند.` : '',
    `سطح سختی: ${difficultyLabel}.`,
    notes ? `توضیحات و محدودهٔ مورد نظر معلم: ${notes}` : '',
    '',
    'قواعد:',
    '- هر سؤال دقیقاً یک پاسخ صحیح داشته باشد.',
    '- هر سؤال بین ۳ تا ۴ گزینه داشته باشد و گزینه‌ها کوتاه و روشن باشند.',
    '- سؤال‌ها با زبان فارسی روان و مناسب دانش‌آموز نوشته شوند.',
    '- گزینه‌های نادرست نزدیک به پاسخ صحیح ولی قطعاً غلط باشند.',
    '- points هر سؤال ۲۵ باشد.',
    '- correctIndex شمارهٔ گزینهٔ صحیح از صفر است (0 برای گزینهٔ اول).',
    '- فقط JSON معتبر برگردان؛ هیچ متن اضافه، توضیح یا بلوک Markdown ننویس.',
    '',
    'ساختار دقیق پاسخ:',
    '{"questions":[{"body":"متن سؤال","options":["گزینه ۱","گزینه ۲","گزینه ۳","گزینه ۴"],"correctIndex":0,"points":25}]}',
  ].filter(Boolean).join('\n');
}

/** Extracts the first JSON object from a model response, including fenced JSON. */
function parseJsonContent(content) {
  const text = String(content ?? '').trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** Normalizes and validates model output before it reaches the teacher preview. */
export function normalizeGeneratedQuestions(payload, { count = 10 } = {}) {
  const list = Array.isArray(payload?.questions)
    ? payload.questions
    : (Array.isArray(payload) ? payload : []);
  const limit = Math.max(1, Math.min(10, Number(count) || 10));
  const seen = new Set();
  const questions = [];

  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const body = String(raw.body ?? '').trim();
    if (!body || body.length > MAX_QUESTION_LENGTH) continue;
    const dedupeKey = body.replace(/\s+/g, ' ');
    if (seen.has(dedupeKey)) continue;

    const options = Array.isArray(raw.options)
      ? raw.options.map((option) => String(option ?? '').trim())
      : [];
    if (options.length < MIN_OPTIONS || options.length > MAX_OPTIONS) continue;
    if (options.some((option) => !option || option.length > MAX_OPTION_LENGTH)) continue;
    if (new Set(options).size !== options.length) continue;

    const correctIndex = Number(raw.correctIndex);
    if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= options.length) continue;

    const rawPoints = Number(raw.points);
    const points = Number.isFinite(rawPoints)
      ? Math.max(0, Math.min(10000, Math.trunc(rawPoints)))
      : 25;

    seen.add(dedupeKey);
    questions.push({ body, options, correctIndex, points });
    if (questions.length >= limit) break;
  }

  return questions;
}

/**
 * Calls Groq's non-streaming chat completions endpoint and returns a validated
 * preview. Throws AppError with a Persian message on provider/configuration
 * failures; the API key is never included in errors.
 */
export async function generateQuestions(db, teacherId, {
  topic,
  count = 5,
  difficulty = 'medium',
  notes = '',
  leagueName = '',
  fetchImpl = globalThis.fetch,
} = {}) {
  const credentials = resolveCredentials(db, teacherId);
  if (!credentials) {
    throw new AppError(
      503,
      'AI_NOT_CONFIGURED',
      'کلید API هوش مصنوعی تنظیم نشده است. لطفاً کلید Groq خود را در همین بخش ذخیره کنید.',
    );
  }

  const requestedCount = Math.max(1, Math.min(10, Number(count) || 5));
  const body = {
    model: credentials.model,
    messages: [
      {
        role: 'system',
        content: 'تو یک دستیار آموزشی فارسی‌زبان و دقیق هستی. فقط JSON معتبر و بدون متن اضافه تولید می‌کنی.',
      },
      {
        role: 'user',
        content: buildPrompt({
          topic,
          count: requestedCount,
          difficulty,
          notes,
          leagueName,
        }),
      },
    ],
    temperature: 0.7,
    top_p: 1,
    max_completion_tokens: credentials.maxCompletionTokens,
    reasoning_effort: 'medium',
    stream: false,
  };

  let response;
  try {
    response = await fetchImpl(`${credentials.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${credentials.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal: timeoutSignal(credentials.timeoutMs),
    });
  } catch (error) {
    const timeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    throw new AppError(
      502,
      'AI_PROVIDER_UNAVAILABLE',
      timeout
        ? 'پاسخ هوش مصنوعی بیش از حد طول کشید. لطفاً دوباره تلاش کنید.'
        : 'ارتباط با سرویس هوش مصنوعی برقرار نشد. لطفاً دوباره تلاش کنید.',
    );
  }

  if (!response.ok) {
    throw new AppError(
      502,
      'AI_PROVIDER_ERROR',
      `سرویس هوش مصنوعی خطا برگرداند (کد ${response.status}). کلید API و محدودیت حساب Groq را بررسی کنید.`,
    );
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new AppError(502, 'AI_INVALID_RESPONSE', 'پاسخ هوش مصنوعی قابل خواندن نبود. لطفاً دوباره تلاش کنید.');
  }

  const content = payload?.choices?.[0]?.message?.content;
  const parsed = parseJsonContent(content);
  const questions = normalizeGeneratedQuestions(parsed, { count: requestedCount });
  if (!questions.length) {
    throw new AppError(502, 'AI_INVALID_RESPONSE', 'سؤال معتبری ساخته نشد. لطفاً موضوع را دقیق‌تر وارد کنید و دوباره تلاش کنید.');
  }

  return {
    questions,
    meta: {
      provider: GROQ_PROVIDER,
      model: credentials.model,
      source: credentials.source,
      requested: requestedCount,
      generated: questions.length,
      difficulty,
    },
  };
}
