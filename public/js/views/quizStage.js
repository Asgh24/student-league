/**
 * «حالت پخش» — a full-screen, PowerPoint-like quiz.
 *
 * Questions are shuffled once and shown one per slide. Every slide has one
 * active student; the teacher can pick the next student randomly from the
 * bottom action bar. The student is snapshotted when the answer is marked, so
 * changing the active student can never move points to the previous student.
 * When the last question is marked, one presentation run is saved per student.
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

/** Picks a random student other than the one who is answering right now. */
function randomOtherStudent(students, current) {
  const pool = students.filter((student) => String(student.id) !== String(current.id));
  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

/** Groups the snapshotted answers by the student who actually answered them. */
function groupAssignments(questions, assignments) {
  const groups = new Map();
  questions.forEach((question, position) => {
    const assignment = assignments[position];
    if (!assignment) return;
    const key = String(assignment.studentId);
    let group = groups.get(key);
    if (!group) {
      group = {
        studentId: assignment.studentId,
        studentName: assignment.studentName,
        items: [],
      };
      groups.set(key, group);
    }
    group.items.push({
      questionId: question.id,
      body: question.body,
      points: Math.max(0, Number(question.points) || 0),
      correct: assignment.correct === true,
    });
  });
  return [...groups.values()];
}

/** Asks for the starting student and the number of questions, then opens the stage. */
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
    description: 'سؤالات به‌صورت تصادفی نمایش داده می‌شوند. در هر سؤال می‌توانید با دکمهٔ «دانش‌آموز تصادفی بعدی» پاسخ‌دهنده را عوض کنید؛ نمره همیشه برای همان دانش‌آموز ثبت می‌شود.',
    submitLabel: 'شروع پخش',
    fields: [
      {
        name: 'studentId',
        label: 'دانش‌آموز شروع',
        type: 'select',
        value: students[0].id,
        options: students.map((student) => ({ value: student.id, label: student.name })),
        hint: 'پاسخ‌دهندهٔ سؤال اول؛ برای سؤال‌های بعد می‌توانید تصادفی انتخاب کنید.',
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
    students,
    questions: shuffle(questions).slice(0, count),
    onFinished,
    onRestart: () => startQuiz({ leagueId, questions, students, onFinished }),
  });
}

function openStage({ leagueId, student, students, questions, onFinished, onRestart }) {
  const assignments = new Array(questions.length).fill(null);
  const savedStudentIds = new Set();
  let activeStudent = student;
  let index = 0;
  let answerToken = 0;
  let closed = false;
  let saved = false;
  let savedAwarded = 0;
  let retryButton = null;

  const progressText = el('span.small.muted');
  const bar = el('span');
  const whoName = el('strong', { text: activeStudent.name });
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
  const nextStudentButton = el('button.btn.btn--soft.quiz-next-student', {
    type: 'button',
    title: students.length < 2
      ? 'برای انتخاب تصادفی، حداقل دو دانش‌آموز لازم است'
      : 'انتخاب تصادفی دانش‌آموز بعدی برای همین سؤال',
    'aria-label': 'انتخاب تصادفی دانش‌آموز بعدی',
    onclick: () => pickNextStudent(),
  }, [el('span', { text: '🎲 انتخاب تصادفی دانش‌آموز بعدی' })]);
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
      el('span.quiz-stage__who', {}, ['🎓 ', whoName]),
      progressText,
      closeButton,
    ]),
    el('div.quiz-stage__bar', {}, [bar]),
    main,
    summary,
  ]);

  main.appendChild(el('div.quiz-question', {}, [questionBody, questionMeta, optionsBox, answerBox]));
  main.appendChild(el('div.quiz-actions', {}, [
    correctButton,
    wrongButton,
    nextStudentButton,
    backButton,
  ]));

  const question = () => questions[index];

  function paintProgress() {
    progressText.textContent = `سؤال ${fa(index + 1)} از ${fa(questions.length)}`;
    bar.style.width = `${((index + 1) / questions.length) * 100}%`;
  }

  /** Loads the answer the active student already submitted, if any. */
  function loadSubmittedAnswer() {
    const current = question();
    const choices = Array.isArray(current.options) ? current.options : [];
    const requestedStudentId = activeStudent.id;
    const requestedStudentName = activeStudent.name;

    answerToken += 1;
    const token = answerToken;
    answerBox.hidden = true;
    answerBox.replaceChildren();
    optionsBox.querySelectorAll('.quiz-option.is-picked')
      .forEach((node) => node.classList.remove('is-picked'));

    api.get(`/questions/${current.id}/answers`)
      .then((payload) => {
        if (closed || token !== answerToken) return;
        // Guard against a late response after the teacher picked another student.
        if (String(activeStudent.id) !== String(requestedStudentId)) return;
        const mine = (payload.items ?? []).find((item) => String(item.studentId) === String(requestedStudentId));
        if (!mine) return;
        if (choices.length >= 2 && Number.isInteger(mine.selectedIndex)) {
          optionsBox.children[mine.selectedIndex]?.classList.add('is-picked');
          answerBox.replaceChildren(
            el('div.small.muted', { text: `💬 گزینهٔ ثبت‌شدهٔ ${requestedStudentName}` }),
            el('p', { text: `گزینه ${fa(mine.selectedIndex + 1)} — ${mine.body}` }),
          );
        } else {
          answerBox.replaceChildren(
            el('div.small.muted', { text: `💬 پاسخ ثبت‌شدهٔ ${requestedStudentName}` }),
            el('p', { text: mine.body }),
          );
        }
        answerBox.hidden = false;
      })
      .catch(() => { /* the question can be graded orally as well */ });
  }

  function render() {
    summary.hidden = true;
    main.hidden = false;
    whoName.textContent = activeStudent.name;
    nextStudentButton.disabled = students.length < 2;
    paintProgress();
    backButton.disabled = index === 0;

    const current = question();
    const answered = assignments.filter((value) => value !== null);
    const correctCount = answered.filter((value) => value.correct).length;
    const wrongCount = answered.filter((value) => !value.correct).length;

    questionBody.textContent = current.body;
    questionMeta.replaceChildren(
      chip(`🎁 ${fa(current.points)} امتیاز`, 'amber'),
      chip(`✅ ${fa(correctCount)} درست تا این‌جا`, 'ok'),
      chip(`❌ ${fa(wrongCount)} غلط`, 'bad'),
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

    loadSubmittedAnswer();
    correctButton.focus();
  }

  /**
   * Freezes the active student into this question before advancing. Everything
   * that is saved later reads this snapshot, never the mutable active student.
   */
  function answer(correct) {
    if (closed || !summary.hidden) return;
    assignments[index] = {
      studentId: activeStudent.id,
      studentName: activeStudent.name,
      correct: correct === true,
    };
    if (index + 1 >= questions.length) {
      void finish();
      return;
    }
    index += 1;
    render();
  }

  function pickNextStudent() {
    if (closed || !summary.hidden || assignments[index]) return;
    const picked = randomOtherStudent(students, activeStudent);
    if (!picked) {
      notify.info('برای انتخاب تصادفی، حداقل دو دانش‌آموز در لیگ لازم است.');
      return;
    }
    activeStudent = picked;
    whoName.textContent = picked.name;
    loadSubmittedAnswer();
    correctButton.focus();
  }

  function back() {
    if (closed || index === 0 || !summary.hidden) return;
    index -= 1;
    assignments[index] = null;
    render();
  }

  async function saveRun(statusNode) {
    const groups = groupAssignments(questions, assignments);
    const pending = groups.filter((group) => !savedStudentIds.has(String(group.studentId)));
    if (pending.length === 0) return;

    statusNode.textContent = pending.length === 1
      ? '⏳ در حال ثبت نمره…'
      : `⏳ در حال ثبت نمرهٔ ${fa(pending.length)} دانش‌آموز…`;

    let failure = null;
    let missingColumn = false;

    for (const group of pending) {
      try {
        const payload = await api.post(`/leagues/${leagueId}/quiz-sessions`, {
          studentId: group.studentId,
          items: group.items.map((item) => ({
            questionId: item.questionId,
            correct: item.correct,
          })),
        });
        savedStudentIds.add(String(group.studentId));
        savedAwarded += Number(payload?.session?.awardedPoints) || 0;
        if (payload?.pointsApplied === false) missingColumn = true;
      } catch (error) {
        failure = error;
        break;
      }
    }

    if (failure) {
      statusNode.textContent = `⚠️ ثبت نشد: ${errorMessage(failure)}`;
      if (!retryButton) {
        retryButton = el('button.btn.btn--soft', {
          type: 'button',
          text: '🔁 تلاش دوباره',
          onclick: () => {
            retryButton?.remove();
            retryButton = null;
            void saveRun(statusNode);
          },
        });
      }
      statusNode.after(retryButton);
      return;
    }

    retryButton?.remove();
    retryButton = null;
    saved = true;

    const allGroupsSaved = groups.every((group) => savedStudentIds.has(String(group.studentId)));
    if (!allGroupsSaved) {
      statusNode.textContent = '⚠️ هنوز همهٔ نمره‌ها ثبت نشده‌اند؛ دوباره تلاش کنید.';
      return;
    }

    if (groups.length === 1) {
      statusNode.textContent = missingColumn
        ? '✅ نمره ثبت شد، اما ستون «انضباطی» پیدا نشد؛ امتیازی به لیگ اضافه نشد.'
        : `✅ ثبت شد — ${fa(savedAwarded)} امتیاز به «${groups[0].studentName}» اضافه شد.`;
    } else {
      statusNode.textContent = missingColumn
        ? `✅ نمرهٔ ${fa(groups.length)} دانش‌آموز ثبت شد، اما ستون «انضباطی» پیدا نشد؛ امتیازی به لیگ اضافه نشد.`
        : `✅ ثبت شد — نمرهٔ ${fa(groups.length)} دانش‌آموز و ${fa(savedAwarded)} امتیاز ثبت شد.`;
    }
    if (typeof onFinished === 'function') onFinished();
  }

  async function finish() {
    main.hidden = true;
    summary.hidden = false;
    bar.style.width = '100%';
    progressText.textContent = `پایان — ${fa(questions.length)} سؤال`;

    const groups = groupAssignments(questions, assignments);
    const allCorrect = assignments.filter((value) => value?.correct).length;
    const statusNode = el('p.quiz-save-status');

    const headline = groups.length === 1
      ? el('div', { style: { textAlign: 'center' } }, [
        el('div.small.muted', { text: `نمرهٔ ${groups[0].studentName}` }),
        el('div.quiz-score', {}, [
          el('span', { text: fa(allCorrect) }),
          el('span', { text: 'از' }),
          el('span', { text: fa(questions.length) }),
        ]),
        el('div.row', { style: { justifyContent: 'center', gap: '6px', flexWrap: 'wrap' } }, [
          chip(`📊 ${fa(Math.round((allCorrect / questions.length) * 100))}٪`, allCorrect * 2 >= questions.length ? 'ok' : 'bad'),
          chip(`🎁 ${fa(groups[0].items.reduce((sum, item) => (item.correct ? sum + item.points : sum), 0))} امتیاز برای پاسخ‌های درست`, 'amber'),
        ]),
      ])
      : el('div', {}, [
        el('div.small.muted', { text: 'نمرهٔ هر دانش‌آموز بر اساس سؤال‌هایی که پاسخ داده است' }),
        el('div.quiz-groups', {}, groups.map((group) => {
          const correct = group.items.filter((item) => item.correct).length;
          const total = group.items.length;
          return el('div.quiz-group', {}, [
            el('span.quiz-group__name', { text: group.studentName }),
            el('span.quiz-group__score', { text: `${fa(correct)} از ${fa(total)}` }),
            chip(`${fa(Math.round((correct / total) * 100))}٪`, correct * 2 >= total ? 'ok' : 'bad'),
          ]);
        })),
      ]);

    summary.replaceChildren(
      headline,
      el('ol.quiz-result-list', {}, questions.map((item, position) => {
        const assignment = assignments[position];
        const correct = assignment?.correct === true;
        return el(`li${correct ? '.is-correct' : '.is-wrong'}`, {}, [
          el('span', { text: correct ? '✅' : '❌' }),
          el('span', {}, [
            el('strong', { text: assignment?.studentName ?? '' }),
            el('span', { text: ` — ${item.body}` }),
          ]),
        ]);
      })),
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
    if (!force && !saved && resultsExist()) {
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

  function resultsExist() {
    return assignments.some((value) => value !== null);
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
