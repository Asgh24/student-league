import { describe, expect, it } from 'vitest';
import {
  AI_QUESTION_TEMPLATE,
  buildAiQuestionTemplate,
  parseAiQuestions,
} from '../public/js/aiQuestionFormat.js';

const sample = {
  questions: [
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
  ],
};

describe('AI question template', () => {
  it('documents the exact JSON shape and rules', () => {
    expect(AI_QUESTION_TEMPLATE).toContain('"questions"');
    expect(AI_QUESTION_TEMPLATE).toContain('"correctIndex"');
    expect(AI_QUESTION_TEMPLATE).toContain('از صفر');
    expect(AI_QUESTION_TEMPLATE).toContain('فقط JSON');
    expect(AI_QUESTION_TEMPLATE).toContain('[سؤال‌های چهارگزینه‌ای خود را اینجا جای‌گذاری کنید.]');
  });

  it('adds the league name only when one is given', () => {
    expect(buildAiQuestionTemplate()).toBe(AI_QUESTION_TEMPLATE);
    expect(buildAiQuestionTemplate({ leagueName: '  ' })).toBe(AI_QUESTION_TEMPLATE);
    const named = buildAiQuestionTemplate({ leagueName: 'هفتم الف' });
    expect(named).toContain('کلاس «هفتم الف»');
    expect(named).toContain('سؤال‌های من:');
  });
});

describe('parseAiQuestions', () => {
  it('parses a plain JSON object', () => {
    const result = parseAiQuestions(JSON.stringify(sample));
    expect(result.questions).toEqual(sample.questions);
    expect(result.total).toBe(2);
    expect(result.skipped).toBe(0);
  });

  it('parses a fenced ```json answer with surrounding prose', () => {
    const text = `حتماً! خروجی: \`\`\`json\n${JSON.stringify(sample)}\n\`\`\`\nموفق باشید.`;
    const result = parseAiQuestions(text);
    expect(result.questions).toHaveLength(2);
  });

  it('accepts a bare array and common field aliases', () => {
    const result = parseAiQuestions(JSON.stringify([
      {
        question: 'آب در چند حالت دیده می‌شود؟',
        choices: ['یک', 'دو', 'سه'],
        correctAnswer: 'گزینه ۲',
        points: '۳۰',
      },
    ]));
    expect(result.questions).toEqual([
      {
        body: 'آب در چند حالت دیده می‌شود؟',
        options: ['یک', 'دو', 'سه'],
        correctIndex: 1,
        points: 30,
      },
    ]);
  });

  it('extracts options from a newline-separated string with Persian digits', () => {
    const result = parseAiQuestions(JSON.stringify({
      questions: [{
        body: 'کدام بزرگ‌تر است؟',
        options: '- ۱۲\n- ۲۱',
        correctAnswer: '۱',
        points: 0,
      }],
    }));
    expect(result.questions[0].options).toEqual(['۱۲', '۲۱']);
    expect(result.questions[0].correctIndex).toBe(0);
  });

  it('treats an index equal to the option count as 1-based', () => {
    const result = parseAiQuestions(JSON.stringify({
      questions: [{
        body: 'سؤال',
        options: ['الف', 'ب', 'ج'],
        correctIndex: 3,
        points: 10,
      }],
    }));
    expect(result.questions[0].correctIndex).toBe(2);
  });

  it('clamps points and defaults them to 25 when missing or invalid', () => {
    const result = parseAiQuestions(JSON.stringify({
      questions: [
        { body: 'یک', options: ['الف', 'ب'], correctIndex: 0, points: -5 },
        { body: 'دو', options: ['الف', 'ب'], correctIndex: 0, points: 99999 },
        { body: 'سه', options: ['الف', 'ب'], correctIndex: 0, points: 'نامعلوم' },
      ],
    }));
    expect(result.questions.map((question) => question.points)).toEqual([0, 10000, 25]);
  });

  it('skips invalid and duplicate entries while reporting how many were ignored', () => {
    const result = parseAiQuestions(JSON.stringify({
      questions: [
        sample.questions[0],
        { body: '', options: ['الف', 'ب'], correctIndex: 0 },
        { body: 'بدون گزینه', options: ['تنها'], correctIndex: 0 },
        { body: 'خارج از بازه', options: ['الف', 'ب'], correctIndex: 7 },
        { body: 'گزینه تکراری', options: ['الف', 'الف'], correctIndex: 0 },
        { ...sample.questions[0] },
      ],
    }));
    expect(result.questions).toHaveLength(1);
    expect(result.total).toBe(6);
    expect(result.skipped).toBe(5);
  });

  it('never returns more than the ten-question limit', () => {
    const many = { questions: Array.from({ length: 14 }, (_, index) => ({
      body: `سؤال ${index + 1}`,
      options: ['الف', 'ب'],
      correctIndex: 0,
      points: 10,
    })) };
    const result = parseAiQuestions(JSON.stringify(many));
    expect(result.questions).toHaveLength(10);
    expect(result.total).toBe(14);
  });

  it('rejects empty text, non-JSON text and a wrong shape', () => {
    expect(() => parseAiQuestions('   ')).toThrow('پاسخ هوش مصنوعی را در کادر پایین بچسبانید');
    expect(() => parseAiQuestions('جوابی ندارم')).toThrow('متنی شبیه JSON پیدا نشد');
    expect(() => parseAiQuestions('{"items":[]}')).toThrow('هیچ سؤالی ندارد');
    expect(() => parseAiQuestions('{"hello":1}')).toThrow('کلید questions');
    expect(() => parseAiQuestions('{"questions":[{"body":"x"}]}')).toThrow('هیچ سؤال معتبری پیدا نشد');
  });
});
