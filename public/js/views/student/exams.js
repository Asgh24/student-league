/** Student exam centre: timed runner, autosave and graded result. */

import { api } from '../../api.js';
import { el } from '../../dom.js';
import { errorMessage } from '../../format.js';
import { renderView, setTopbarTitle } from '../../shell.js';
import { confirmDialog, emptyState, notify } from '../../ui.js';
import { button, card, chip, fa, faDateTime, grid, loadingNode, pageHead, statCard } from '../common.js';
import { studentTabs } from './tabs.js';

const STATE_LABELS = {
  open: 'آماده شرکت',
  resume: 'در حال انجام',
  upcoming: 'در انتظار شروع',
  exhausted: 'تلاش تمام‌شده',
  closed: 'بسته',
  draft: 'پیش‌نویس',
};
const STATE_KIND = {
  open: 'ok',
  resume: 'amber',
  upcoming: 'amber',
  exhausted: 'muted',
  closed: 'bad',
  draft: 'muted',
};

function clock(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const pad = (value) => String(value).padStart(2, '0');
  return hours > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(rest)}` : `${pad(minutes)}:${pad(rest)}`;
}

function resultScreen({ payload, close }) {
  const attempt = payload.attempt;
  const result = payload.result ?? {
    passed: attempt.passed,
    percent: attempt.percent,
    correctCount: attempt.correctCount,
    totalQuestions: attempt.totalQuestions,
    awardedPoints: attempt.awardedPoints,
  };
  const review = payload.questions.map((question, index) => el('div.exam-review__row', {}, [
    el('div.exam-review__head', {}, [
      el('span.small.muted', { text: `سؤال ${fa(index + 1)}` }),
      question.isCorrect === true ? chip('صحیح', 'ok') : question.isCorrect === false ? chip('نادرست', 'bad') : chip('بدون پاسخ', 'muted'),
      chip(`${fa(question.points)} امتیاز`, 'muted'),
    ]),
    el('p.exam-review__body', { text: question.body }),
    el('div.exam-review__options', {}, question.options.map((option, optionIndex) => {
      const picked = question.selectedIndex === optionIndex;
      const correct = question.correctIndex === optionIndex;
      return el(`div.exam-review__option${correct ? '.is-correct' : ''}${picked && !correct ? '.is-wrong' : ''}`, {}, [
        el('span.question-choice__index', { text: `${fa(optionIndex + 1)}.` }),
        el('span', { text: option }),
        picked ? chip('انتخاب شما', correct ? 'ok' : 'bad') : null,
        correct && !picked ? chip('پاسخ صحیح', 'ok') : null,
      ]);
    })),
  ]));

  return el('div.exam-result', {}, [
    el('div.exam-result__hero', {}, [
      el('div', {
        class: `exam-result__score${result.passed ? ' is-passed' : ' is-failed'}`,
        text: `${fa(result.percent)}٪`,
      }),
      el('h2', { text: result.passed ? '🎉 قبول شدی!' : 'این بار قبول نشدی' }),
      el('p.muted', {
        text: `${fa(result.correctCount)} پاسخ صحیح از ${fa(result.totalQuestions)} سؤال`,
      }),
      el('div.row', { style: { justifyContent: 'center', gap: '6px', flexWrap: 'wrap' } }, [
        chip(`🎁 ${fa(result.awardedPoints ?? 0)} امتیاز لیگ`, 'amber'),
        chip(`⏱️ ${fa(payload.exam.durationMinutes)} دقیقه`, 'muted'),
        chip(`🎯 حد قبولی ${fa(payload.exam.passPercent)}٪`, 'muted'),
      ]),
    ]),
    payload.questions.some((question) => question.correctIndex !== undefined)
      ? el('div', {}, [el('h3', { text: 'مرور پاسخ‌ها' }), ...review])
      : el('p.small.muted', { text: 'پاسخ صحیح این آزمون توسط معلم نمایش داده نمی‌شود.' }),
    el('div.row', { style: { justifyContent: 'center', marginTop: '12px' } }, [
      button('بازگشت به فهرست آزمون‌ها', { kind: 'soft', icon: '↩️', onClick: close }),
    ]),
  ]);
}

/** Full-screen timed runner. Answers are saved one by one as they are picked. */
function startRunner(payload, { onClose = null } = {}) {
  let index = 0;
  let remaining = payload.remainingSeconds;
  let submitted = false;
  let timer = null;
  const saved = new Map();
  const pendingSaves = new Set();

  const overlay = el('div.exam-stage', { role: 'dialog', 'aria-modal': 'true' });
  const body = el('div.exam-stage__body');
  overlay.appendChild(body);
  document.body.appendChild(overlay);

  const close = () => {
    if (timer) clearInterval(timer);
    overlay.remove();
    if (onClose) onClose();
  };

  function optionNode(question, option, optionIndex) {
    const selected = (saved.has(question.id) ? saved.get(question.id) : question.selectedIndex) === optionIndex;
    return el(`button.exam-option${selected ? '.is-picked' : ''}`, {
      type: 'button',
      onclick: () => {
        if (submitted) return;
        saved.set(question.id, optionIndex);
        paint();
        const pending = api.put(`/student/exams/attempts/${payload.attempt.id}/answers/${question.id}`, {
          optionIndex,
        }).catch((error) => notify.error(errorMessage(error)))
          .finally(() => pendingSaves.delete(pending));
        pendingSaves.add(pending);
      },
    }, [
      el('span.question-choice__index', { text: `${fa(optionIndex + 1)}.` }),
      el('span', { text: option }),
    ]);
  }

  function paint() {
    const question = payload.questions[index];
    const selected = saved.has(question.id) ? saved.get(question.id) : question.selectedIndex;
    const answered = payload.questions.filter((item) => {
      const pick = saved.has(item.id) ? saved.get(item.id) : item.selectedIndex;
      return pick !== null && pick !== undefined;
    }).length;

    body.replaceChildren(
      el('header.exam-stage__head', {}, [
        el('div', {}, [
          el('h2.exam-stage__title', { text: payload.exam.title }),
          el('p.small.muted', { text: `سؤال ${fa(index + 1)} از ${fa(payload.questions.length)} — ${fa(answered)} پاسخ ثبت‌شده` }),
        ]),
        el('div.exam-stage__timer', {}, [
          el('span.small.muted', { text: 'زمان باقی‌مانده' }),
          el('strong#exam-clock', { text: clock(remaining) }),
        ]),
      ]),
      el('div.exam-progress', {}, [
        el('div.exam-progress__fill', {
          style: { width: `${payload.questions.length ? ((index + 1) / payload.questions.length) * 100 : 0}%` },
        }),
      ]),
      el('article.exam-stage__question', {}, [
        el('div.row', { style: { gap: '6px', flexWrap: 'wrap' } }, [
          chip(`سؤال ${fa(index + 1)}`, 'muted'),
          chip(`🎁 ${fa(question.points)} امتیاز`, 'amber'),
        ]),
        el('h3', { text: question.body }),
        el('div.exam-options', {}, question.options.map((option, optionIndex) => optionNode(question, option, optionIndex))),
      ]),
      el('div.exam-stage__nav', {}, [
        button('قبلی', {
          kind: 'ghost',
          icon: '→',
          disabled: index === 0,
          onClick: () => {
            index = Math.max(0, index - 1);
            paint();
          },
        }),
        el('span.spacer'),
        selected !== null && selected !== undefined ? el('span.small.muted', { text: 'پاسخ این سؤال ثبت شده است.' }) : el('span.small.muted', { text: 'یک گزینه انتخاب کنید.' }),
        el('span.spacer'),
        index < payload.questions.length - 1
          ? button('بعدی', {
            kind: 'soft',
            icon: '←',
            onClick: () => {
              index = Math.min(payload.questions.length - 1, index + 1);
              paint();
            },
          })
          : button('پایان و ثبت نمره', { kind: 'ok', icon: '✅', onClick: () => submit(false) }),
      ]),
      el('div.row', { style: { justifyContent: 'space-between', marginTop: '10px', flexWrap: 'wrap', gap: '6px' } }, [
        el('span.small.muted', { text: 'پاسخ‌ها به‌صورت خودکار ذخیره می‌شوند.' }),
        button('ثبت نهایی', { kind: 'soft', icon: '📨', disabled: submitted, onClick: () => submit(false) }),
      ]),
    );
  }

  async function submit(auto) {
    if (submitted) return;
    if (!auto) {
      const unanswered = payload.questions.filter((item) => {
        const pick = saved.has(item.id) ? saved.get(item.id) : item.selectedIndex;
        return pick === null || pick === undefined;
      }).length;
      const agreed = await confirmDialog({
        title: 'ثبت نهایی آزمون',
        message: unanswered
          ? `${fa(unanswered)} سؤال بی‌پاسخ است. با این حال آزمون ثبت شود؟`
          : 'پاسخ‌ها ثبت و نمره محاسبه شود؟',
        confirmLabel: 'ثبت نمره',
      });
      if (!agreed) return;
    }
    if (submitted) return;
    submitted = true;
    if (timer) clearInterval(timer);
    body.replaceChildren(el('div.empty', {}, [el('p', { text: 'در حال محاسبه نمره…' })]));
    await Promise.allSettled([...pendingSaves]);
    try {
      const result = await api.post(`/student/exams/attempts/${payload.attempt.id}/submit`, {});
      body.replaceChildren(resultScreen({ payload: result, close }));
    } catch (error) {
      submitted = false;
      body.replaceChildren(el('div.empty', {}, [
        el('p', { text: errorMessage(error) }),
        button('تلاش دوباره', { onClick: () => submit(true) }),
      ]));
    }
  }

  paint();
  timer = setInterval(() => {
    remaining -= 1;
    const node = document.querySelector('#exam-clock');
    if (node) node.textContent = clock(remaining);
    if (remaining <= 0) {
      clearInterval(timer);
      timer = null;
      void submit(true);
    }
  }, 1000);

  return { close, overlay };
}

async function beginExam(exam, onDone) {
  const agreed = await confirmDialog({
    title: exam.inProgressAttemptId ? 'ادامه آزمون' : 'شروع آزمون',
    message: exam.inProgressAttemptId
      ? 'آزمون قبلی شما در حال انجام است و از همان زمان باقی‌مانده ادامه می‌یابد.'
      : `آزمون «${exam.title}» با مدت ${fa(exam.durationMinutes)} دقیقه آغاز شود؟`,
    confirmLabel: exam.inProgressAttemptId ? 'ادامه' : 'شروع',
  });
  if (!agreed) return;
  try {
    const payload = await api.post(`/student/exams/${exam.id}/start`, {});
    startRunner(payload, { onClose: onDone });
  } catch (error) {
    notify.error(errorMessage(error));
  }
}

function examCard(exam, reload) {
  const state = exam.state ?? (exam.available ? 'open' : 'closed');
  const attempts = `${fa(exam.attemptsUsed)} از ${fa(exam.maxAttempts)} تلاش`;
  return el('article.exam-card.exam-card--student', {}, [
    el('div.exam-card__head', {}, [
      el('div', {}, [
        el('h3.exam-card__title', { text: exam.title }),
        el('p.small.muted', { text: exam.description || 'بدون توضیح' }),
      ]),
      chip(STATE_LABELS[state] ?? state, STATE_KIND[state] ?? 'muted'),
    ]),
    el('div.row.exam-card__meta', { style: { gap: '6px', flexWrap: 'wrap' } }, [
      exam.subject ? chip(exam.subject, 'muted') : null,
      chip(`⏱️ ${fa(exam.durationMinutes)} دقیقه`, 'muted'),
      chip(`❓ ${fa(exam.questionCount)} سؤال`, 'muted'),
      chip(`🎯 قبولی ${fa(exam.passPercent)}٪`, 'muted'),
      chip(`🔁 ${attempts}`, 'muted'),
      exam.rewardPoints ? chip(`🎁 ${fa(exam.rewardPoints)} امتیاز`, 'amber') : null,
      exam.opensAt ? chip(`شروع: ${faDateTime(exam.opensAt)}`, 'muted') : null,
      exam.closesAt ? chip(`پایان: ${faDateTime(exam.closesAt)}`, 'muted') : null,
    ]),
    el('div.row.exam-card__stats', { style: { gap: '6px', flexWrap: 'wrap' } }, [
      exam.bestPercent !== null && exam.bestPercent !== undefined
        ? chip(`🏆 بهترین: ${fa(exam.bestPercent)}٪`, exam.bestPassed ? 'ok' : 'bad')
        : chip('هنوز شرکت نکرده‌اید', 'muted'),
      exam.lastAttempt?.submittedAt ? chip(faDateTime(exam.lastAttempt.submittedAt), 'muted') : null,
    ]),
    el('div.row.exam-card__actions', {}, [
      exam.available
        ? button(exam.inProgressAttemptId ? 'ادامه آزمون' : 'شروع آزمون', {
          kind: 'ok',
          icon: exam.inProgressAttemptId ? '▶️' : '🚀',
          onClick: () => beginExam(exam, reload),
        })
        : el('span.small.muted', {
          text: state === 'exhausted'
            ? 'سهمیه تلاش شما تکمیل شده است.'
            : state === 'upcoming'
              ? 'این آزمون هنوز باز نشده است.'
              : 'این آزمون در حال حاضر قابل شرکت نیست.',
        }),
    ]),
  ]);
}

export async function renderStudentExams() {
  setTopbarTitle('آزمون‌ها');
  const body = el('div', {}, [loadingNode()]);
  renderView([body]);

  async function load() {
    body.replaceChildren(loadingNode());
    let data;
    try {
      data = await api.get('/student/exams');
    } catch (error) {
      body.replaceChildren(emptyState({
        icon: '⚠️',
        title: 'دریافت آزمون‌ها ناموفق بود',
        hint: errorMessage(error),
      }));
      return;
    }
    const items = data.items ?? [];
    const openCount = items.filter((item) => item.available).length;
    const done = items.filter((item) => item.bestPercent !== null && item.bestPercent !== undefined).length;
    const passed = items.filter((item) => item.bestPassed).length;
    const list = el('div.exam-list');
    if (items.length === 0) {
      list.appendChild(emptyState({
        icon: '🧪',
        title: 'هنوز آزمونی برای شما منتشر نشده است',
        hint: 'وقتی معلم آزمونی منتشر کند، همین‌جا نمایش داده می‌شود.',
      }));
    }
    for (const exam of items) list.appendChild(examCard(exam, load));

    body.replaceChildren(
      pageHead({
        icon: '🧪',
        title: 'مرکز آزمون',
        subtitle: 'آزمون زمان‌دار با ذخیره خودکار پاسخ و نمره‌دهی فوری',
      }),
      studentTabs('student/exams'),
      grid('grid--stats', [
        statCard({ label: 'آزمون‌های فعال', value: fa(openCount), icon: '🚀' }),
        statCard({ label: 'شرکت‌کرده', value: fa(done), icon: '📝' }),
        statCard({ label: 'قبول‌شده', value: fa(passed), icon: '🏆' }),
      ]),
      card({ title: 'آزمون‌های من', icon: '📋' }, [list]),
    );
  }

  await load();
  return undefined;
}
