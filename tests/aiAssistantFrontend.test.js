// @vitest-environment jsdom
/**
 * Provider-free AI question importer: template copy step, pasted-JSON parsing,
 * preview selection and the reviewed bulk-save hand-off to the Q&A list.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  return { api, ApiError: class ApiError extends Error {} };
});

const { api } = await import('../public/js/api.js');
const { openAiAssistant } = await import('../public/js/views/aiAssistant.js');

const questions = [
  {
    body: 'پایتخت ایران کجاست؟',
    options: ['تهران', 'مشهد', 'شیراز'],
    correctIndex: 0,
    points: 25,
  },
  {
    body: 'حاصل ۲ + ۳ چند است؟',
    options: ['۴', '۵', '۶'],
    correctIndex: 1,
    points: 25,
  },
];

function answerText() {
  return JSON.stringify({ questions }, null, 2);
}

function clickButton(label) {
  const node = [...document.querySelectorAll('#modal-root button')]
    .find((button) => button.textContent.includes(label));
  expect(node, `button «${label}» not found`).toBeTruthy();
  node.click();
  return node;
}

/** The importer converts on paste/change; setting the value plus change is enough. */
function pasteAnswer(text) {
  const area = document.querySelector('#ai-paste');
  expect(area).not.toBeNull();
  area.value = text;
  area.dispatchEvent(new Event('change'));
}

beforeEach(() => {
  document.body.innerHTML = '<div id="modal-root"></div><div id="toasts"></div>';
  vi.clearAllMocks();
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('AI question importer UI', () => {
  it('shows a copyable template and never asks for an API key', async () => {
    await openAiAssistant({ leagueId: 1, leagueName: 'کلاس هفتم', reload: vi.fn() });

    const text = document.querySelector('#modal-root').textContent;
    expect(text).toContain('ساخت سؤال با هوش مصنوعی');
    expect(text).toContain('کلید API نمی‌خواهد');

    const template = document.querySelector('#ai-template');
    expect(template).not.toBeNull();
    expect(template.value).toContain('"questions"');
    expect(template.value).toContain('"correctIndex"');
    expect(template.value).toContain('کلاس «کلاس هفتم»');
    expect(document.body.textContent).not.toContain('Groq');
    expect(document.querySelector('#ai-groq-key')).toBeNull();

    expect(clickButton('کپی قالب')).toBeTruthy();
    expect(document.querySelector('#ai-paste')).not.toBeNull();
    expect(api.get).not.toHaveBeenCalled();
    expect(api.put).not.toHaveBeenCalled();
  });

  it('parses a pasted fenced answer and bulk-saves only the selected questions', async () => {
    api.post.mockResolvedValue({ items: [questions[0]] });
    const reload = vi.fn().mockResolvedValue(undefined);

    await openAiAssistant({ leagueId: 1, leagueName: 'کلاس هفتم', reload });
    pasteAnswer(`\`\`\`json\n${answerText()}\n\`\`\``);

    expect(document.querySelectorAll('.ai-question')).toHaveLength(2);
    expect(document.querySelectorAll('.ai-question .mcq-preview__option.is-correct')).toHaveLength(2);
    expect(document.querySelector('.ai-question .mcq-preview__option.is-correct').textContent).toContain('تهران');
    expect(document.querySelector('.ai-preview__tools').textContent).toContain('۲ از ۲');
    expect(document.querySelector('.ai-status').textContent).toContain('۲ سؤال آماده شد');
    expect(api.post).not.toHaveBeenCalled();

    const checks = [...document.querySelectorAll('.ai-question input[type="checkbox"]')];
    checks[1].click();
    expect(document.querySelector('.ai-preview__tools').textContent).toContain('۱ از ۲');

    clickButton('ذخیره سؤال‌های انتخاب‌شده');
    await vi.waitFor(() => expect(api.post).toHaveBeenCalledWith('/leagues/1/questions/bulk', {
      questions: [questions[0]],
    }));
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(document.querySelector('.modal-backdrop')).toBeNull();
  });

  it('accepts a bare array with common aliases and Persian digits', async () => {
    await openAiAssistant({ leagueId: 2, reload: vi.fn() });
    pasteAnswer(JSON.stringify([
      { question: 'آب چیست؟', choices: ['مایع', 'گاز'], correctAnswer: 'گزینه ۱', points: '۳۰' },
    ]));

    expect(document.querySelectorAll('.ai-question')).toHaveLength(1);
    expect(document.querySelector('.ai-question__body').textContent).toBe('آب چیست؟');
    expect(document.querySelector('.ai-question__points').value).toBe('30');
    expect(document.querySelector('.ai-question .mcq-preview__option.is-correct').textContent).toContain('مایع');
  });

  it('shows a clear error and no preview when the pasted text has no JSON', async () => {
    await openAiAssistant({ leagueId: 3, reload: vi.fn() });
    pasteAnswer('متأسفم، نمی‌توانم این کار را انجام دهم.');

    expect(document.querySelectorAll('.ai-question')).toHaveLength(0);
    expect(document.querySelector('.ai-status').textContent).toContain('JSON');
    expect(api.post).not.toHaveBeenCalled();
  });

  it('rejects an answer whose correct option index is out of range', async () => {
    await openAiAssistant({ leagueId: 3, reload: vi.fn() });
    pasteAnswer(JSON.stringify({ questions: [
      { body: 'سؤال نامعتبر', options: ['یک', 'دو'], correctIndex: 5 },
      questions[0],
    ] }));

    expect(document.querySelectorAll('.ai-question')).toHaveLength(1);
    expect(document.querySelector('.ai-status').textContent).toContain('۱ مورد نامعتبر');
  });
});

describe('AI question importer points', () => {
  it('lets the teacher change each question points before bulk saving', async () => {
    api.post.mockResolvedValue({ items: [] });
    const reload = vi.fn().mockResolvedValue(undefined);

    await openAiAssistant({ leagueId: 1, reload });
    pasteAnswer(answerText());

    const pointInputs = [...document.querySelectorAll('.ai-question__points')];
    expect(pointInputs).toHaveLength(2);
    expect(pointInputs[0].value).toBe('25');
    pointInputs[0].value = '40';
    pointInputs[1].value = '5';

    clickButton('ذخیره سؤال‌های انتخاب‌شده');
    await vi.waitFor(() => expect(api.post).toHaveBeenCalledWith('/leagues/1/questions/bulk', {
      questions: [
        { ...questions[0], points: 40 },
        { ...questions[1], points: 5 },
      ],
    }));
  });

  it('refuses to save an invalid per-question points value', async () => {
    await openAiAssistant({ leagueId: 1, reload: vi.fn() });
    pasteAnswer(answerText());

    document.querySelectorAll('.ai-question__points')[0].value = '20000';
    clickButton('ذخیره سؤال‌های انتخاب‌شده');

    expect(document.querySelector('.ai-preview .ai-status').textContent).toContain('بین ۰ تا ۱۰۰۰۰');
    expect(api.post).not.toHaveBeenCalledWith('/leagues/1/questions/bulk', expect.anything());
  });
});
