/** Student-facing class questions: answer multiple-choice or legacy text questions. */

import { api } from '../../api.js';
import { el } from '../../dom.js';
import { errorMessage } from '../../format.js';
import { renderView, setTopbarTitle } from '../../shell.js';
import { emptyState, notify } from '../../ui.js';
import { button, card, chip, fa, faDateTime, grid, loadingNode, pageHead, statCard } from '../common.js';
import { studentTabs } from './tabs.js';

function answerSummary(question) {
  if (question.myAnswer === null || question.myAnswer === undefined || question.myAnswer === '') return null;
  const parts = [
    el('span', { text: question.type === 'multiple_choice' ? `پاسخ شما: ${question.myAnswer}` : 'پاسخ شما ثبت شده است.' }),
    question.myOptionIndex !== null && question.myOptionIndex !== undefined
      ? chip(`گزینه ${fa(question.myOptionIndex + 1)}`, 'muted')
      : null,
    question.myAward > 0 ? chip(`+${fa(question.myAward)} امتیاز`, 'ok') : chip('در انتظار بررسی', 'muted'),
  ];
  return el('p.small.question-answer__saved', {}, parts.filter(Boolean));
}

function textAnswerForm(question, reload) {
  const textarea = el('textarea', {
    rows: '3',
    maxlength: '1000',
    placeholder: 'پاسخ خود را بنویسید…',
    'aria-label': `پاسخ به ${question.body}`,
  });
  if (question.myAnswer) textarea.value = question.myAnswer;
  const form = el('form.question-answer', {}, [
    textarea,
    el('div.row', {}, [
      el('span.spacer'),
      button('ثبت پاسخ', { type: 'submit', icon: '📨' }),
    ]),
  ]);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const body = textarea.value.trim();
    if (!body) {
      notify.error('متن پاسخ را بنویسید.');
      textarea.focus();
      return;
    }
    try {
      await api.post(`/student/questions/${question.id}/answers`, { body });
      notify.ok('پاسخ شما ثبت شد');
      await reload();
    } catch (error) {
      notify.error(errorMessage(error));
    }
  });
  return form;
}

function choiceAnswerForm(question, reload) {
  const name = `question-${question.id}`;
  const choices = el('div.question-choices');
  for (const [index, option] of question.options.entries()) {
    const radio = el('input', {
      type: 'radio',
      name,
      value: String(index),
      ...(question.myOptionIndex === index ? { checked: 'checked' } : {}),
    });
    choices.appendChild(el('label.question-choice', {}, [
      radio,
      el('span.question-choice__index', { text: `${fa(index + 1)}.` }),
      el('span', { text: option }),
    ]));
  }
  const form = el('form.question-answer', {}, [
    choices,
    el('div.row', {}, [
      el('span.spacer'),
      button('ثبت پاسخ', { type: 'submit', icon: '📨' }),
    ]),
  ]);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const picked = form.querySelector(`input[name="${name}"]:checked`);
    if (!picked) {
      notify.error('یکی از گزینه‌ها را انتخاب کنید.');
      return;
    }
    try {
      await api.post(`/student/questions/${question.id}/answers`, {
        optionIndex: Number(picked.value),
      });
      notify.ok('پاسخ شما ثبت شد');
      await reload();
    } catch (error) {
      notify.error(errorMessage(error));
    }
  });
  return form;
}

export async function renderStudentQuestions() {
  setTopbarTitle('سوال و پاسخ');
  const body = el('div', {}, [loadingNode()]);
  renderView([body]);

  async function load() {
    body.replaceChildren(loadingNode());
    let data;
    try {
      data = await api.get('/student/questions');
    } catch (error) {
      body.replaceChildren(emptyState({
        icon: '⚠️',
        title: 'دریافت سؤالات ناموفق بود',
        hint: errorMessage(error),
      }));
      return;
    }

    const items = data.items ?? [];
    const answered = items.filter((item) => item.myAnswer !== null && item.myAnswer !== undefined && item.myAnswer !== '');
    const awarded = items.reduce((sum, item) => sum + (Number(item.myAward) || 0), 0);
    const list = el('div.question-list');

    for (const question of items) {
      const closed = !question.isOpen;
      const saved = answerSummary(question);
      list.appendChild(el('article.question-item', {}, [
        el('div.row.question-item__head', {}, [
          el('h3.question-item__body', { text: question.body }),
          el('div.row', {}, [
            chip(closed ? 'بسته' : 'باز', closed ? 'muted' : 'ok'),
            chip(question.type === 'multiple_choice' ? 'چندگزینه‌ای' : 'تشریحی', 'muted'),
            chip(`${fa(question.points)} امتیاز`),
          ]),
        ]),
        el('div.small.muted', { text: faDateTime(question.createdAt) }),
        closed
          ? (saved ?? el('p.small.muted', { text: 'این سؤال بسته شده و پاسخ جدیدی نمی‌پذیرد.' }))
          : el('div', {}, [
            saved,
            question.type === 'multiple_choice'
              ? choiceAnswerForm(question, load)
              : textAnswerForm(question, load),
          ]),
      ]));
    }

    if (items.length === 0) {
      list.appendChild(emptyState({
        icon: '❓',
        title: 'هنوز سؤالی ثبت نشده است',
        hint: 'وقتی معلم سؤال جدیدی بگذارد، همین‌جا نمایش داده می‌شود.',
      }));
    }

    body.replaceChildren(
      pageHead({
        icon: '❓',
        title: 'سوال و پاسخ',
        subtitle: 'به سؤالات کلاس پاسخ بده و امتیاز بگیر',
      }),
      studentTabs('student/questions'),
      grid('grid--stats', [
        statCard({ label: 'سؤالات', value: fa(items.length), icon: '❓' }),
        statCard({ label: 'پاسخ‌داده‌شده', value: fa(answered.length), icon: '💬' }),
        statCard({ label: 'امتیاز پاسخ‌ها', value: fa(awarded), icon: '🎁' }),
      ]),
      card({ title: 'سؤالات کلاس', icon: '📋' }, [list]),
    );
  }

  await load();
  return undefined;
}
