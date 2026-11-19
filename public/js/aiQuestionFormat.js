/**
 * Text format used by the "AI question import" flow.
 *
 * The teacher copies a ready-made prompt into any AI chat, appends their own
 * multiple-choice questions, and pastes the JSON answer back into the site.
 * This module only parses and normalizes that text; it never calls a provider.
 */

export const AI_QUESTION_TEMPLATE = `تو یک دستیار آموزشی فارسی‌زبان و دقیق هستی. من چند سؤال چهارگزینه‌ای دارم و می‌خواهم آن‌ها را بدون تغییر معنا به قالب JSON زیر تبدیل کنی.

قواعد:
- همهٔ سؤال‌هایی که می‌دهم را تبدیل کن و هیچ سؤالی را حذف یا اضافه نکن.
- هر سؤال دقیقاً یک پاسخ صحیح داشته باشد.
- برای هر سؤال ۳ یا ۴ گزینه بنویس؛ متن سؤال و گزینه‌ها کوتاه، روشن و فارسی باشند.
- شمارهٔ گزینهٔ صحیح را از صفر بنویس (گزینهٔ اول = 0، گزینهٔ دوم = 1 و همین‌طور ادامه).
- مقدار points هر سؤال را 25 بگذار.
- فقط JSON معتبر برگردان؛ هیچ توضیح، مقدمه، عذرخواهی یا بلوک Markdown اضافه نکن.
- خروجی باید دقیقاً این ساختار را داشته باشد:
{"questions":[{"body":"متن سؤال","options":["گزینه ۱","گزینه ۲","گزینه ۳","گزینه ۴"],"correctIndex":0,"points":25}]}

سؤال‌های من:
[سؤال‌های چهارگزینه‌ای خود را اینجا جای‌گذاری کنید.]`;

const MAX_QUESTIONS = 10;
const MAX_OPTION_LENGTH = 200;
const MAX_BODY_LENGTH = 500;

/** Adds the class name (when known) to the footer of the template. */
export function buildAiQuestionTemplate({ leagueName = '' } = {}) {
  const name = String(leagueName ?? '').trim();
  if (!name) return AI_QUESTION_TEMPLATE;
  return AI_QUESTION_TEMPLATE.replace(
    'سؤال‌های من:',
    `این سؤال‌ها برای کلاس «${name}» هستند.\n\nسؤال‌های من:`,
  );
}

function asText(value) {
  return String(value ?? '').trim();
}

function parseNumber(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const ascii = text.replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));
  const number = Number(ascii);
  return Number.isFinite(number) ? number : null;
}

function normalizeOptions(raw) {
  const source = raw.options ?? raw.choices ?? raw.answers;
  if (Array.isArray(source)) {
    return source.map((option) => {
      if (option && typeof option === 'object') {
        return asText(option.text ?? option.body ?? option.label ?? option.value ?? option.option);
      }
      return asText(option);
    });
  }
  if (typeof source === 'string') {
    return source
      .split(/\n|\||؛/)
      .map((option) => asText(option).replace(/^[-*•]\s*/, ''))
      .filter(Boolean);
  }
  return [];
}

/** Reads the answer index, accepting 0-based indexes and common 1-based aliases. */
function correctIndexOf(raw) {
  const options = normalizeOptions(raw);
  const direct = raw.correctIndex ?? raw.correct_index ?? raw.correctOptionIndex ?? raw.answerIndex;
  if (direct !== undefined && direct !== null && direct !== '') {
    const number = parseNumber(direct);
    if (number !== null && Number.isInteger(number)) {
      if (number >= 0 && number < options.length) return number;
      if (number >= 1 && number <= options.length) return number - 1;
    }
  }

  const answer = raw.correctAnswer ?? raw.correct_answer ?? raw.answer ?? raw.correct;
  if (answer !== undefined && answer !== null && answer !== '') {
    const wanted = asText(answer).replace(/^گزینه\s*/, '');
    if (!/^[0-9۰-۹٠-٩]+$/.test(wanted)) {
      const index = options.findIndex((option) => option === wanted);
      if (index !== -1) return index;
    }
    const number = parseNumber(wanted);
    if (number !== null && Number.isInteger(number)) {
      if (number >= 1 && number <= options.length) return number - 1;
      if (number === 0) return 0;
    }
  }

  // Some assistants mark the correct option inside the options array itself.
  const source = raw.options;
  if (Array.isArray(source)) {
    const index = source.findIndex((option) => option && typeof option === 'object'
      && (option.correct === true || option.isCorrect === true));
    if (index !== -1) return index;
  }
  return -1;
}

function normalizeQuestion(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const body = asText(raw.body ?? raw.question ?? raw.text ?? raw.title);
  if (!body || body.length > MAX_BODY_LENGTH) return null;

  const options = normalizeOptions(raw);
  if (options.length < 2 || options.length > 10) return null;
  if (options.some((option) => !option || option.length > MAX_OPTION_LENGTH)) return null;
  if (new Set(options).size !== options.length) return null;

  const correctIndex = correctIndexOf(raw);
  if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= options.length) return null;

  const rawPoints = parseNumber(raw.points);
  const points = rawPoints === null
    ? 25
    : Math.max(0, Math.min(10000, Math.trunc(rawPoints)));

  return { body, options, correctIndex, points };
}

function extractJson(text) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : trimmed).trim();

  const attempts = [candidate];
  const objectStart = candidate.indexOf('{');
  const objectEnd = candidate.lastIndexOf('}');
  if (objectStart !== -1 && objectEnd > objectStart) attempts.push(candidate.slice(objectStart, objectEnd + 1));
  const arrayStart = candidate.indexOf('[');
  const arrayEnd = candidate.lastIndexOf(']');
  if (arrayStart !== -1 && arrayEnd > arrayStart) attempts.push(candidate.slice(arrayStart, arrayEnd + 1));

  for (const attempt of attempts) {
    try {
      return JSON.parse(attempt);
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

/**
 * Parses the AI answer. Returns valid questions (up to `limit`) and how many
 * entries were ignored, or throws a Persian error that the UI can show as-is.
 */
export function parseAiQuestions(input, { limit = MAX_QUESTIONS } = {}) {
  const text = String(input ?? '').trim();
  if (!text) throw new Error('پاسخ هوش مصنوعی را در کادر پایین بچسبانید.');

  const payload = extractJson(text);
  if (payload === null) {
    throw new Error('متنی شبیه JSON پیدا نشد. خروجی هوش مصنوعی را کامل و بدون تغییر بچسبانید.');
  }

  const list = Array.isArray(payload)
    ? payload
    : (Array.isArray(payload?.questions) ? payload.questions : (Array.isArray(payload?.items) ? payload.items : null));
  if (!list) throw new Error('ساختار پاسخ درست نیست؛ کلید questions و آرایهٔ سؤال‌ها پیدا نشد.');
  if (!list.length) throw new Error('پاسخ هوش مصنوعی هیچ سؤالی ندارد.');

  const max = Math.max(1, Math.min(MAX_QUESTIONS, Number(limit) || MAX_QUESTIONS));
  const seen = new Set();
  const questions = [];
  for (const raw of list) {
    const question = normalizeQuestion(raw);
    if (!question) continue;
    const key = question.body.replace(/\s+/g, ' ');
    if (seen.has(key)) continue;
    seen.add(key);
    questions.push(question);
    if (questions.length >= max) break;
  }

  if (!questions.length) {
    throw new Error('هیچ سؤال معتبری پیدا نشد. متن سؤال، گزینه‌ها و شمارهٔ گزینهٔ صحیح (از صفر) را بررسی کنید.');
  }

  return {
    questions,
    total: list.length,
    skipped: Math.max(0, list.length - questions.length),
  };
}
