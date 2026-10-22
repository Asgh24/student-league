/**
 * «حالت پخش» — a full-screen, PowerPoint-like quiz for one student.
 *
 * Questions are shuffled once, shown one per slide, and the teacher marks each
 * answer correct or wrong. When the last question is marked, the run is saved
 * and the points of the correct questions are awarded automatically.
 */

import { api } from '../api.js';
import { el } from '../dom.js';
import { errorMessage } from '../format.js';
import { confirmDialog, formDialog, notify } from '../ui.js';
import { chip, fa } from './common.js';

function shuffle(items) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

/** Asks for the student and the number of questions, then opens the stage. */
export async function startQuiz({ leagueId, questions, students, onFinished }) {
  if (questions.length === 0) {
    notify.error('برای شروع، اول یک سؤال ثبت کنید');
    return;
  }
  if (students.length === 0) {
    notify.error('دانش‌آموزی در این لیگ ثبت نشده است');
    return;
  }

  const values = await formDialog({
    title: 'حالت پخش',
    description: 'سؤالات به‌صورت تصادفی نمایش داده می‌شوند. هر پاسخ درست، امتیاز همان سؤال را برای دانش‌آموز ثبت می‌کند.',
    submitLabel: 'شروع پخش',
    fields: [
      {
        name: 'studentId',
        label: 'دانش‌آموز',
        type: 'select',
        value: students[0].id,
        options: students.map((student) => ({ value: student.id, label: student.name })),
      },
      {
        name: 'count',
        label: 'تعداد سؤال',
        type: 'number',
        value: Math.min(10, questions.length),
        min: 1,
        max: questions.length,
        required: true,
        hint: `حداکثر ${fa(questions.length)} سؤال موجود است`,
      },
    ],
  });
  if (!values) return;

  const student = students.find((item) => String(item.id) === String(values.studentId)) ?? students[0];
  const count = Math.max(1, Math.min(questions.length, Number(values.count) || questions.length));
  openStage({
    leagueId,
    student,
    questions: shuffle(questions).slice(0, count),
    onFinished,
    onRestart: () => startQuiz({ leagueId, questions, students, onFinished }),
  });
}

function openStage({ leagueId, student, questions, onFinished, onRestart }) {
  const results = new Array(questions.length).fill(null);
  let index = 0;
  let answerToken = 0;
  let closed = false;
  let saved = false;

  const progressText = el('span.small.muted');
  const bar = el('span');
  const questionBody = el('h2.quiz-question__body');
  const questionMeta = el('div.row', { style: { gap: '6px', justifyContent: 'center', flexWrap: 'wrap' } });
  const optionsBox = el('div.quiz-options', { hidden: 'true' });
  const answerBox = el('div.quiz-answer', { hidden: 'true' });
  const summary = el('div.quiz-summary', { hidden: 'true' });
  const main = el('div.quiz-stage__main');

  function bigButton(label, tone, onClick) {
    return el(`button.btn.quiz-btn.quiz-btn--${tone}`, { type: 'button', onclick: onClick }, [
      el('span', { text: label }),
    ]);
  }

  const correctButton = bigButton('✅ درست', 'correct', () => answer(true));
  const wrongButton = bigButton('❌ غلط', 'wrong', () => answer(false));
  const backButton = el('button.btn.btn--ghost', {
    type: 'button',
    text: '↩️ سؤال قبلی',
    onclick: () => back(),
  });

  const closeButton = el('button.btn.btn--ghost.quiz-stage__close', {
    type: 'button',
    title: 'بستن حالت پخش',
    'aria-label': 'بستن حالت پخش',
    text: '✖️',
    onclick: () => void close(false),
  });

  const stage = el('section.quiz-stage', {
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': 'حالت پخش سؤال‌ها',
  }, [
    el('div.quiz-stage__head', {}, [
      el('span.quiz-stage__who', {}, ['🎓 ', el('strong', { text: student.name })]),
      progressText,
      closeButton,
    ]),
    el('div.quiz-stage__bar', {}, [bar]),
    main,
    summary,
  ]);

  main.appendChild(el('div.quiz-question', {}, [questionBody, questionMeta, optionsBox, answerBox]));
  main.appendChild(el('div.quiz-actions', {}, [correctButton, wrongButton, backButton]));

  const question = () => questions[index];

  function paintProgress() {
    progressText.textContent = `سؤال ${fa(index + 1)} از ${fa(questions.length)}`;
    bar.style.width = `${((index + 1) / questions.length) * 100}%`;
  }

  function render() {
    summary.hidden = true;
    main.hidden = false;
    paintProgress();
    backButton.disabled = index === 0;

    const current = question();
    questionBody.textContent = current.body;
    questionMeta.replaceChildren(
      chip(`🎁 ${fa(current.points)} امتیاز`, 'amber'),
      chip(`✅ ${fa(results.filter(Boolean).length)} درست تا این‌جا`, 'ok'),
      chip(`❌ ${fa(results.filter((value) => value === false).length)} غلط`, 'bad'),
    );
    const choices = Array.isArray(current.options) ? current.options : [];
    optionsBox.replaceChildren();
    optionsBox.hidden = choices.length < 2;
    if (choices.length >= 2) {
      choices.forEach((choice, position) => {
        optionsBox.appendChild(el('div.quiz-option', {}, [
          el('span.quiz-option__index', { text: fa(position + 1) }),
          el('span', { text: choice }),
        ]));
      });
    }

    answerBox.hidden = true;
    answerBox.replaceChildren();

    // Optionally show what the student already submitted in their portal.
    answerToken += 1;
    const token = answerToken;
    api.get(`/questions/${current.id}/answers`)
      .then((payload) => {
        if (closed || token !== answerToken) return;
        const mine = (payload.items ?? []).find((item) => item.studentId === student.id);
        if (!mine) return;
        if (choices.length >= 2 && Number.isInteger(mine.selectedIndex)) {
          optionsBox.children[mine.selectedIndex]?.classList.add('is-picked');
          answerBox.replaceChildren(
            el('div.small.muted', { text: '💬 گزینهٔ ثبت‌شدهٔ دانش‌آموز' }),
            el('p', { text: `گزینه ${fa(mine.selectedIndex + 1)} — ${mine.body}` }),
          );
        } else {
          answerBox.replaceChildren(
            el('div.small.muted', { text: '💬 پاسخ ثبت‌شدهٔ دانش‌آموز' }),
            el('p', { text: mine.body }),
          );
        }
        answerBox.hidden = false;
      })
      .catch(() => { /* the question can be graded orally as well */ });

    correctButton.focus();
  }

  function answer(correct) {
    if (closed || !summary.hidden) return;
    results[index] = correct;
    if (index + 1 >= questions.length) {
      void finish();
      return;
    }
    index += 1;
    render();
  }

  function back() {
    if (closed || index === 0 || !summary.hidden) return;
    index -= 1;
    results[index] = null;
    render();
  }

  async function saveRun(statusNode) {
    statusNode.textContent = '⏳ در حال ثبت نمره…';
    try {
      const payload = await api.post(`/leagues/${leagueId}/quiz-sessions`, {
        studentId: student.id,
        items: questions.map((item, position) => ({
          questionId: item.id,
          correct: results[position] === true,
        })),
      });
      saved = true;
      statusNode.textContent = payload.pointsApplied
        ? `✅ ثبت شد — ${fa(payload.session.awardedPoints)} امتیاز به «${student.name}» اضافه شد.`
        : '✅ نمره ثبت شد، اما ستون «انضباطی» پیدا نشد؛ امتیازی به لیگ اضافه نشد.';
      if (typeof onFinished === 'function') onFinished();
    } catch (error) {
      statusNode.textContent = `⚠️ ثبت نشد: ${errorMessage(error)}`;
      const retry = el('button.btn.btn--soft', {
        type: 'button',
        text: '🔁 تلاش دوباره',
        onclick: () => {
          retry.remove();
          void saveRun(statusNode);
        },
      });
      statusNode.after(retry);
    }
  }

  async function finish() {
    main.hidden = true;
    summary.hidden = false;
    bar.style.width = '100%';
    progressText.textContent = `پایان — ${fa(questions.length)} سؤال`;

    const correctCount = results.filter(Boolean).length;
    const requested = questions.reduce((sum, item, position) => (results[position] ? sum + (Number(item.points) || 0) : sum), 0);
    const statusNode = el('p.quiz-save-status');

    summary.replaceChildren(
      el('div', { style: { textAlign: 'center' } }, [
        el('div.small.muted', { text: `نمرهٔ ${student.name}` }),
        el('div.quiz-score', {}, [
          el('span', { text: fa(correctCount) }),
          el('span', { text: 'از' }),
          el('span', { text: fa(questions.length) }),
        ]),
        el('div.row', { style: { justifyContent: 'center', gap: '6px', flexWrap: 'wrap' } }, [
          chip(`📊 ${fa(Math.round((correctCount / questions.length) * 100))}٪`, correctCount * 2 >= questions.length ? 'ok' : 'bad'),
          chip(`🎁 ${fa(requested)} امتیاز برای پاسخ‌های درست`, 'amber'),
        ]),
      ]),
      el('ol.quiz-result-list', {}, questions.map((item, position) => el(
        `li${results[position] ? '.is-correct' : '.is-wrong'}`,
        {},
        [el('span', { text: results[position] ? '✅' : '❌' }), el('span', { text: item.body })],
      ))),
      statusNode,
      el('div.quiz-actions', {}, [
        el('button.btn.btn--ghost', {
          type: 'button',
          text: '🔁 پخش دوباره',
          onclick: () => {
            close(true);
            if (typeof onRestart === 'function') onRestart();
          },
        }),
        el('button.btn.btn--soft', {
          type: 'button',
          text: 'بستن',
          onclick: () => close(true),
        }),
      ]),
    );

    await saveRun(statusNode);
  }

  async function close(force) {
    if (closed) return;
    if (!force && !saved && results.some((value) => value !== null)) {
      const agreed = await confirmDialog({
        title: 'پایان حالت پخش',
        message: 'این آزمون نیمه‌کاره است و نمره‌ای ثبت نشده؛ خارج شوید؟',
        confirmLabel: 'خروج',
        danger: true,
      });
      if (!agreed) return;
    }
    closed = true;
    // Invalidate a pending answer fetch so it cannot touch a detached node.
    answerToken += 1;
    document.removeEventListener('keydown', onKey);
    document.body.classList.remove('quiz-open');
    stage.remove();
  }

  function onKey(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      void close(false);
      return;
    }
    if (!summary.hidden) return;
    if (event.key === '1' || event.key === 'ArrowLeft') {
      event.preventDefault();
      answer(true);
    } else if (event.key === '2' || event.key === 'ArrowRight') {
      event.preventDefault();
      answer(false);
    } else if (event.key === 'Backspace') {
      event.preventDefault();
      back();
    }
  }

  document.body.appendChild(stage);
  document.body.classList.add('quiz-open');
  document.addEventListener('keydown', onKey);
  render();
}
