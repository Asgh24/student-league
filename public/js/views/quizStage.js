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
  const playable = questions.filter((item) => (
    Array.isArray(item.options)
    && item.options.length >= 2
    && Number.isInteger(item.correctIndex)
  ));
  if (playable.length === 0) {
    notify.error('برای حالت پخش، حداقل یک سؤال تستی با گزینه و پاسخ صحیح لازم است');
    return;
  }

  const values = await formDialog({
    title: 'حالت پخش',
    description: 'سؤالات به‌صورت تصادفی نمایش داده می‌شوند. گزینه‌ای را که دانش‌آموز انتخاب کرده بزنید تا درستی یا نادرستی خودکار مشخص شود. با دکمهٔ «دانش‌آموز تصادفی بعدی» هم پاسخ‌دهنده را عوض کنید؛ نمره همیشه برای همان دانش‌آموز ثبت می‌شود.',
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
        value: Math.min(10, playable.length),
        min: 1,
        max: playable.length,
        required: true,
        hint: `حداکثر ${fa(playable.length)} سؤال تستی موجود است`,
      },
    ],
  });
  if (!values) return;

  const student = students.find((item) => String(item.id) === String(values.studentId)) ?? students[0];
  const count = Math.max(1, Math.min(playable.length, Number(values.count) || playable.length));
  openStage({
    leagueId,
    student,
    students,
    questions: shuffle(playable).slice(0, count),
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
  const pickHint = el('p.small.muted.quiz-pick-hint', {
    text: 'گزینه‌ای را که دانش‌آموز انتخاب کرده بزنید؛ درستی یا نادرستی خودکار مشخص می‌شود.',
  });
  const optionsBox = el('div.quiz-options', { hidden: 'true' });
  const answerBox = el('div.quiz-answer', { hidden: 'true' });
  const summary = el('div.quiz-summary', { hidden: 'true' });
  const main = el('div.quiz-stage__main');

  const nextQuestionLabel = el('span', { text: 'سؤال بعدی ➡️' });
  const nextQuestionButton = el('button.btn.btn--soft.quiz-next-question', {
    type: 'button',
    hidden: 'true',
    onclick: () => advance(),
  }, [nextQuestionLabel]);
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

  main.appendChild(el('div.quiz-question', {}, [questionBody, questionMeta, pickHint, optionsBox, answerBox]));
  main.appendChild(el('div.quiz-actions', {}, [
    nextQuestionButton,
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

  function isAutoGraded(current) {
    return Array.isArray(current.options)
      && current.options.length >= 2
      && Number.isInteger(current.correctIndex);
  }

  function paintFeedback(current, assignment) {
    const choices = Array.isArray(current.options) ? current.options : [];
    const correctIndex = Number.isInteger(current.correctIndex) ? current.correctIndex : null;

    [...optionsBox.children].forEach((node, position) => {
      if (position === assignment.selectedIndex) {
        node.classList.add(assignment.correct ? 'is-correct' : 'is-wrong');
      } else if (!assignment.correct && correctIndex !== null && position === correctIndex) {
        // Also show the right answer when the selected option was wrong.
        node.classList.add('is-correct');
      }
    });

    const verdict = assignment.correct
      ? `✅ ${assignment.studentName} درست پاسخ داد`
      : `❌ ${assignment.studentName} نادرست پاسخ داد`;
    const parts = [el('div.small.muted', { text: verdict })];
    if (Number.isInteger(assignment.selectedIndex)) {
      const chosen = choices[assignment.selectedIndex] ?? '';
      parts.push(el('p', { text: `گزینه انتخاب‌شده: ${fa(assignment.selectedIndex + 1)} — ${chosen}` }));
      if (!assignment.correct && correctIndex !== null) {
        parts.push(el('p.small.muted', {
          text: `پاسخ صحیح: گزینه ${fa(correctIndex + 1)} — ${choices[correctIndex] ?? ''}`,
        }));
      }
    }
    answerBox.replaceChildren(...parts);
    answerBox.hidden = false;
  }

  function focusAnswerControl() {
    if (assignments[index]) {
      nextQuestionButton.focus();
      return;
    }
    const firstOption = optionsBox.querySelector('button.quiz-option:not(:disabled)');
    if (firstOption) firstOption.focus();
    else nextStudentButton.focus();
  }

  function render() {
    summary.hidden = true;
    main.hidden = false;
    whoName.textContent = activeStudent.name;
    paintProgress();
    backButton.disabled = index === 0;

    const current = question();
    const assignment = assignments[index];
    const answered = assignments.filter((value) => value !== null);
    const correctCount = answered.filter((value) => value.correct).length;
    const wrongCount = answered.filter((value) => !value.correct).length;
    const choices = Array.isArray(current.options) ? current.options : [];
    const autoGraded = isAutoGraded(current);

    questionBody.textContent = current.body;
    questionMeta.replaceChildren(
      chip(`🎁 ${fa(current.points)} امتیاز`, 'amber'),
      chip(`✅ ${fa(correctCount)} درست تا این‌جا`, 'ok'),
      chip(`❌ ${fa(wrongCount)} غلط`, 'bad'),
    );
    pickHint.hidden = !autoGraded || Boolean(assignment);
    optionsBox.replaceChildren();
    optionsBox.hidden = choices.length < 2;
    if (choices.length >= 2) {
      choices.forEach((choice, position) => {
        const option = el('button.quiz-option', { type: 'button' }, [
          el('span.quiz-option__index', { text: fa(position + 1) }),
          el('span', { text: choice }),
        ]);
        if (autoGraded && !assignment) {
          option.addEventListener('click', () => chooseOption(position));
        } else {
          option.disabled = true;
        }
        optionsBox.appendChild(option);
      });
    }

    // Multiple-choice questions are graded only by the selected option.
    nextQuestionButton.hidden = !assignment;
    nextQuestionLabel.textContent = index + 1 >= questions.length
      ? '✅ پایان و ثبت نمره'
      : 'سؤال بعدی ➡️';
    nextStudentButton.disabled = students.length < 2 || Boolean(assignment);

    if (assignment) {
      // A pending portal-answer fetch must not repaint a graded question.
      answerToken += 1;
      paintFeedback(current, assignment);
    } else {
      loadSubmittedAnswer();
    }
    focusAnswerControl();
  }

  /**
   * Freezes the active student and the selected choice into this question.
   * Everything saved later reads this snapshot, never the mutable active student.
   */
  function chooseOption(position) {
    if (closed || !summary.hidden || assignments[index]) return;
    const current = question();
    const choices = Array.isArray(current.options) ? current.options : [];
    if (!isAutoGraded(current) || position < 0 || position >= choices.length) return;
    assignments[index] = {
      studentId: activeStudent.id,
      studentName: activeStudent.name,
      correct: Number(current.correctIndex) === position,
      selectedIndex: position,
    };
    render();
  }

  function advance() {
    if (closed || !summary.hidden || !assignments[index]) return;
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
    focusAnswerControl();
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
    if (event.key === 'Backspace') {
      event.preventDefault();
      back();
      return;
    }
    if (assignments[index]) return;

    const current = question();
    const choices = Array.isArray(current.options) ? current.options : [];
    if (!isAutoGraded(current)) return;
    const position = Number(event.key);
    if (Number.isInteger(position) && position >= 1 && position <= choices.length) {
      event.preventDefault();
      chooseOption(position - 1);
    }
  }

  document.body.appendChild(stage);
  document.body.classList.add('quiz-open');
  document.addEventListener('keydown', onKey);
  render();
}
