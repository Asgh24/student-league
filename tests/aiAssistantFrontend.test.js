// @vitest-environment jsdom
/**
 * AI Q&A assistant modal: provider key status, generation preview and the
 * reviewed bulk-save hand-off to the existing Q&A list.
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

function config(overrides = {}) {
  return {
    provider: 'groq',
    configured: true,
    source: 'server',
    model: 'openai/gpt-oss-20b',
    hasApiKey: true,
    serverConfigured: true,
    own: { hasApiKey: false, updatedAt: null },
    ...overrides,
  };
}

function clickButton(label) {
  const node = [...document.querySelectorAll('#modal-root button')]
    .find((button) => button.textContent.includes(label));
  expect(node, `button «${label}» not found`).toBeTruthy();
  node.click();
  return node;
}

beforeEach(() => {
  document.body.innerHTML = '<div id="modal-root"></div><div id="toasts"></div>';
  vi.clearAllMocks();
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('AI Q&A assistant UI', () => {
  it('saves a teacher key, generates a preview and bulk-saves only selected questions', async () => {
    api.get.mockResolvedValueOnce({
      config: config({
        configured: false,
        source: 'none',
        hasApiKey: false,
        serverConfigured: false,
      }),
    });
    api.put.mockResolvedValueOnce({
      config: config({ source: 'teacher', own: { hasApiKey: true, updatedAt: '2026-10-22T08:00:00.000Z' } }),
    });
    api.post.mockImplementation((url) => {
      if (url === '/leagues/1/ai/questions') {
        return Promise.resolve({
          questions,
          meta: { provider: 'groq', model: 'openai/gpt-oss-20b', source: 'teacher', generated: 2 },
        });
      }
      if (url === '/leagues/1/questions/bulk') {
        return Promise.resolve({ items: [questions[0]] });
      }
      return Promise.reject(new Error(`unexpected post ${url}`));
    });
    const reload = vi.fn().mockResolvedValue(undefined);

    await openAiAssistant({ leagueId: 1, leagueName: 'کلاس هفتم', reload });

    expect(document.querySelector('#modal-root').textContent).toContain('دستیار هوش مصنوعی');
    expect(document.querySelector('#modal-root').textContent).toContain('کلید تنظیم نشده');
    expect(document.querySelector('#ai-topic')).not.toBeNull();
    expect(document.querySelector('#ai-groq-key')).not.toBeNull();
    expect(document.querySelector('#ai-count').value).toBe('5');
    expect(document.querySelector('#ai-difficulty').value).toBe('medium');
    expect(clickButton('ساخت سؤال با هوش مصنوعی').disabled).toBe(true);

    document.querySelector('#ai-groq-key').value = 'gsk_frontend_test_key';
    clickButton('ذخیره کلید');
    await vi.waitFor(() => expect(api.put).toHaveBeenCalledWith('/ai/settings', {
      apiKey: 'gsk_frontend_test_key',
    }));
    await vi.waitFor(() => expect(clickButton('ساخت سؤال با هوش مصنوعی').disabled).toBe(false));
    expect(document.querySelector('#modal-root').textContent).toContain('کلید شخصی شما');
    expect(document.querySelector('#modal-root').textContent).not.toContain('gsk_frontend_test_key');

    document.querySelector('#ai-topic').value = 'جغرافیا و ریاضی';
    document.querySelector('#ai-count').value = '3';
    document.querySelector('#ai-difficulty').value = 'easy';
    document.querySelector('#ai-notes').value = 'سؤال‌های کوتاه';
    clickButton('ساخت سؤال با هوش مصنوعی');

    await vi.waitFor(() => expect(api.post).toHaveBeenCalledWith('/leagues/1/ai/questions', {
      topic: 'جغرافیا و ریاضی',
      count: 3,
      difficulty: 'easy',
      notes: 'سؤال‌های کوتاه',
    }));
    await vi.waitFor(() => expect(document.querySelectorAll('.ai-question')).toHaveLength(2));
    expect(document.querySelectorAll('.ai-question .mcq-preview__option.is-correct')).toHaveLength(2);
    expect(document.querySelector('.ai-preview__tools').textContent).toContain('۲ از ۲');
    expect(reload).not.toHaveBeenCalled();

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

  it('uses the server key without asking for one and can clear a personal key', async () => {
    api.get.mockResolvedValueOnce({
      config: config({
        source: 'teacher',
        own: { hasApiKey: true, updatedAt: '2026-10-20T10:00:00.000Z' },
      }),
    });
    api.put.mockResolvedValueOnce({
      config: config({ source: 'server', own: { hasApiKey: false, updatedAt: null } }),
    });

    await openAiAssistant({ leagueId: 2, reload: vi.fn() });

    expect(document.querySelector('#modal-root').textContent).toContain('کلید شخصی شما');
    expect(document.querySelector('#ai-clear-key')).not.toBeNull();
    expect(clickButton('ساخت سؤال با هوش مصنوعی').disabled).toBe(false);

    document.querySelector('#ai-clear-key').click();
    clickButton('ذخیره کلید');
    await vi.waitFor(() => expect(api.put).toHaveBeenCalledWith('/ai/settings', { clearApiKey: true }));
    await vi.waitFor(() => expect(document.querySelector('#modal-root').textContent).toContain('کلید پیشفرض سامانه'));
    expect(document.body.textContent).toContain('کلید شخصی حذف شد');
  });

  it('shows a validation message when the topic is too short and keeps the preview empty', async () => {
    api.get.mockResolvedValueOnce({ config: config() });
    const reload = vi.fn();
    await openAiAssistant({ leagueId: 3, reload });

    document.querySelector('#ai-topic').value = 'ا';
    clickButton('ساخت سؤال با هوش مصنوعی');

    expect(document.querySelector('.ai-generator .ai-status').textContent).toContain('موضوع آزمون');
    expect(api.post).not.toHaveBeenCalled();
    expect(document.querySelectorAll('.ai-question')).toHaveLength(0);
  });
});
