/** Exam centre: professional tests plus the legacy class question bank. */

import { api } from '../api.js';
import { el } from '../dom.js';
import { errorMessage } from '../format.js';
import { renderView, setLeaguePill, setTopbarTitle } from '../shell.js';
import { setLeagueId } from '../store.js';
import { confirmDialog, emptyState, notify, openModal } from '../ui.js';
import { backToWorkbench, button, card, chip, fa, faDateTime, field, grid, iconButton, loadingNode, pageHead } from './common.js';
import { openAiAssistant } from './aiAssistant.js';
import { startQuiz } from './quizStage.js';

const DIFFICULTY_LABELS = { easy: 'آسان', medium: 'متوسط', hard: 'سخت' };
const STATUS_LABELS = { draft: 'پیش‌نویس', published: 'منتشرشده', closed: 'بسته' };
const STATUS_KIND = { draft: 'muted', published: 'ok', closed: 'bad' };

function toLocalInput(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function localInputToIso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function statBlock(value, label) {
  return el('div.stat', {}, [
    el('div.stat__value', { text: value }),
    el('div.stat__label', { text: label }),
  ]);
}

/** Modal with a teacher-managed option list, one correct choice and metadata. */
function questionDialog() {
  return new Promise((resolve) => {
    let settled = false;
    let correctIndex = 0;
    const options = ['', '', '', ''];
    const errorBox = el('p.small', { role: 'alert', style: { color: '#dc2626', minHeight: '1.2em' } });
    const optionList = el('div.option-editor');
    const bodyInput = el('textarea', {
      id: 'mcq-body',
      rows: '3',
      maxlength: '500',
      placeholder: 'مثلاً: پایتخت ایران کجاست؟',
    });
    const pointsInput = el('input', {
      id: 'mcq-points',
      type: 'number',
      value: 25,
      min: 0,
      max: 10000,
    });
    const explanationInput = el('textarea', {
      id: 'mcq-explanation',
      rows: '2',
      maxlength: '1000',
      placeholder: 'توضیح پاسخ صحیح (اختیاری)',
    });
    const subjectInput = el('input', {
      id: 'mcq-subject',
      type: 'text',
      maxlength: '60',
      placeholder: 'مثلاً ریاضی',
    });
    const difficultyInput = el('select', { id: 'mcq-difficulty' }, [
      el('option', { value: 'easy', text: 'آسان' }),
      el('option', { value: 'medium', text: 'متوسط', selected: 'selected' }),
      el('option', { value: 'hard', text: 'سخت' }),
    ]);

    function paintCorrect() {
      [...optionList.children].forEach((row, index) => {
        row.classList.toggle('is-correct', index === correctIndex);
      });
    }

    function buildRow(index, value) {
      const radio = el('input', {
        type: 'radio',
        name: 'correctOption',
        value: String(index),
        checked: index === correctIndex,
        'aria-label': `گزینه ${fa(index + 1)} پاسخ صحیح`,
        onchange: () => {
          correctIndex = index;
          paintCorrect();
        },
      });
      const textInput = el('input', {
        type: 'text',
        value,
        maxlength: '200',
        placeholder: `گزینه ${fa(index + 1)}`,
        oninput: (event) => {
          options[index] = event.target.value;
        },
      });
      const remove = iconButton('✕', {
        label: 'حذف گزینه',
        danger: true,
        onClick: () => {
          if (options.length <= 2) return;
          options.splice(index, 1);
          if (correctIndex === index) correctIndex = Math.max(0, index - 1);
          else if (correctIndex > index) correctIndex -= 1;
          renderOptions();
        },
      });
      remove.disabled = options.length <= 2;
      return el('div', { class: `option-row${index === correctIndex ? ' is-correct' : ''}` }, [
        el('label.option-row__pick', { title: 'این گزینه پاسخ صحیح است' }, [
          radio,
          el('span.small', { text: 'صحیح' }),
        ]),
        textInput,
        remove,
      ]);
    }

    function renderOptions() {
      optionList.replaceChildren(...options.map((value, index) => buildRow(index, value)));
    }

    function addOption() {
      if (options.length >= 10) return;
      options.push('');
      renderOptions();
      const last = optionList.lastElementChild?.querySelector('input[type="text"]');
      last?.focus();
    }

    const addButton = button('افزودن گزینه', { kind: 'soft', icon: '➕', onClick: addOption });
    const optionsField = el('div.field', {}, [
      el('div.row', { style: { justifyContent: 'space-between', alignItems: 'center' } }, [
        el('label', { text: 'گزینه‌ها' }),
        addButton,
      ]),
      el('span.muted.small', { text: 'گزینه صحیح را با دکمه رادیویی کنار آن مشخص کنید. حداقل ۲ و حداکثر ۱۰ گزینه.' }),
      optionList,
    ]);
    const metaRow = el('div.grid.grid--2', {}, [
      field('درس', subjectInput),
      field('سطح دشواری', difficultyInput),
    ]);
    const form = el('form.mcq-form', { novalidate: 'true' }, [
      field('متن سؤال', bodyInput),
      optionsField,
      metaRow,
      field('امتیاز پاسخ درست', pointsInput),
      field('توضیح پاسخ', explanationInput),
      errorBox,
    ]);
    form.addEventListener('submit', (event) => event.preventDefault());

    function submit() {
      errorBox.textContent = '';
      const body = bodyInput.value.trim();
      if (!body) {
        errorBox.textContent = 'متن سؤال را وارد کنید';
        bodyInput.focus();
        return;
      }
      const cleaned = options.map((option) => option.trim());
      if (cleaned.length < 2) {
        errorBox.textContent = 'حداقل دو گزینه لازم است';
        return;
      }
      const blank = cleaned.findIndex((option) => !option);
      if (blank !== -1) {
        errorBox.textContent = `متن گزینه ${fa(blank + 1)} را وارد کنید`;
        optionList.children[blank]?.querySelector('input[type="text"]')?.focus();
        return;
      }
      if (correctIndex < 0 || correctIndex >= cleaned.length) {
        errorBox.textContent = 'گزینه صحیح را انتخاب کنید';
        return;
      }
      const points = Number(pointsInput.value);
      if (!Number.isInteger(points) || points < 0 || points > 10000) {
        errorBox.textContent = 'امتیاز باید عددی بین ۰ تا ۱۰۰۰۰ باشد';
        pointsInput.focus();
        return;
      }
      settled = true;
      modal.close();
      resolve({
        body,
        points,
        options: cleaned,
        correctIndex,
        explanation: explanationInput.value.trim(),
        subject: subjectInput.value.trim(),
        difficulty: difficultyInput.value,
      });
    }

    renderOptions();
    const modal = openModal({
      title: 'سؤال جدید',
      body: form,
      actions: [
        {
          label: 'انصراف',
          kind: 'ghost',
          onClick: ({ close }) => {
            settled = true;
            close();
            resolve(null);
          },
        },
        { label: 'ثبت سؤال', onClick: submit },
      ],
      onClose: () => {
        if (!settled) resolve(null);
      },
    });
  });
}

async function createQuestion(leagueId, reload) {
  const values = await questionDialog();
  if (!values) return;
  const payload = {
    body: values.body,
    points: values.points,
    options: values.options,
    correctIndex: values.correctIndex,
  };
  if (values.explanation) payload.explanation = values.explanation;
  if (values.subject) payload.subject = values.subject;
  if (values.difficulty && values.difficulty !== 'medium') payload.difficulty = values.difficulty;
  try {
    await api.post(`/leagues/${leagueId}/questions`, payload);
    notify.ok('سؤال ثبت شد');
    reload();
  } catch (error) {
    notify.error(errorMessage(error));
  }
}

async function deleteQuestion(question, reload) {
  const agreed = await confirmDialog({
    title: 'حذف سؤال',
    message: 'این سؤال و همه پاسخ‌های آن حذف شود؟',
    confirmLabel: 'حذف',
    danger: true,
  });
  if (!agreed) return;
  try {
    await api.del(`/questions/${question.id}`);
    notify.ok('سؤال حذف شد');
    reload();
  } catch (error) {
    notify.error(errorMessage(error));
  }
}

async function toggleOpen(question, reload) {
  try {
    await api.post(`/questions/${question.id}/${question.isOpen ? 'close' : 'open'}`, {});
    notify.ok(question.isOpen ? 'سؤال بسته شد' : 'سؤال باز شد');
    reload();
  } catch (error) {
    notify.error(errorMessage(error));
  }
}

/** Shows the teacher the saved choices and marks the right one. */
function questionPreview(question) {
  if (!question.options?.length) return null;
  return el('div.mcq-preview', {}, question.options.map((option, index) => el(
    `div.mcq-preview__option${index === question.correctIndex ? '.is-correct' : ''}`,
    {},
    [
      el('span.mcq-preview__index', { text: `${fa(index + 1)}.` }),
      el('span', { text: option }),
      index === question.correctIndex ? chip('صحیح', 'ok') : null,
    ],
  )));
}

async function openAnswers(question, reload) {
  const body = el('div', {}, [el('p.small.muted', { text: 'در حال بارگذاری…' })]);
  const modal = openModal({ title: 'پاسخ‌ها', body });

  async function refresh() {
    try {
      const payload = await api.get(`/questions/${question.id}/answers`);
      const list = el('div');
      if (!payload.items.length) list.appendChild(el('p.muted.small', { text: 'هنوز پاسخی ثبت نشده است.' }));
      for (const answer of payload.items) {
        const award = el('input', {
          type: 'number',
          value: answer.awarded,
          min: 0,
          max: 10000,
          style: { width: '90px' },
          'aria-label': `امتیاز ${answer.studentName}`,
        });
        const answerBody = payload.question.type === 'multiple_choice' && answer.selectedIndex !== null
          ? el('div', {}, [
            el('div', { text: `گزینه ${fa(answer.selectedIndex + 1)}: ${answer.body}` }),
            answer.isCorrect ? chip('پاسخ صحیح', 'ok') : chip('پاسخ نادرست', 'bad'),
          ])
          : el('div', { text: answer.body });
        list.appendChild(el('div.timeline-item', {}, [
          el('div', { style: { flex: '1' } }, [
            el('div', {}, [el('strong', { text: answer.studentName }), chip(faDateTime(answer.createdAt), 'muted')]),
            answerBody,
          ]),
          el('div.row', { style: { gap: '4px' } }, [
            award,
            button('ثبت امتیاز', {
              kind: 'soft',
              onClick: async () => {
                try {
                  await api.post(`/answers/${answer.id}/award`, { points: Number(award.value) || 0 });
                  notify.ok(`امتیاز ${answer.studentName} ثبت شد`);
                  await refresh();
                  reload();
                } catch (error) {
                  notify.error(errorMessage(error));
                }
              },
            }),
          ]),
        ]));
      }
      const correctIndex = payload.question.correctIndex;
      const correctOption = payload.question.type === 'multiple_choice' && Number.isInteger(correctIndex)
        ? el('p.small.muted', {
          text: `پاسخ صحیح: گزینه ${fa(correctIndex + 1)} — ${payload.question.options[correctIndex] ?? ''}`,
        })
        : null;
      modal.setContent([
        el('h2.modal__title', { text: `پاسخ‌ها (${fa(payload.items.length)})` }),
        el('p.small.muted', { text: payload.question.body }),
        correctOption,
        el('p.small.muted', { text: `امتیاز پیشنهادی سؤال: ${fa(payload.question.points)}` }),
        list,
      ].filter(Boolean));
    } catch (error) {
      modal.setContent([el('h2.modal__title', { text: 'خطا' }), el('p', { text: errorMessage(error) })]);
    }
  }

  await refresh();
}

/** Last presentation runs, so a finished quiz leaves a visible result. */
function recentCard(sessions) {
  if (sessions.length === 0) return null;
  return card({ title: 'نتایج اخیر حالت پخش', icon: '🏁' }, [
    el('div', {}, sessions.map((session) => el('div.timeline-item', {}, [
      el('div', { style: { flex: '1' } }, [
        el('div', {}, [
          el('strong', { text: session.studentName }),
          chip(`✅ ${fa(session.correct)} از ${fa(session.total)}`, session.percent >= 50 ? 'ok' : 'bad'),
        ]),
        el('div.row', { style: { gap: '6px', marginTop: '4px', flexWrap: 'wrap' } }, [
          chip(`🎁 ${fa(session.awardedPoints)} امتیاز`, 'amber'),
          chip(`${fa(session.percent)}٪`, 'muted'),
          chip(faDateTime(session.createdAt), 'muted'),
        ]),
      ]),
    ]))),
  ]);
}

async function openQuiz(leagueId, questions, reload) {
  try {
    const payload = await api.get(`/leagues/${leagueId}/students`);
    await startQuiz({ leagueId, questions, students: payload.items ?? [], onFinished: reload });
  } catch (error) {
    notify.error(errorMessage(error));
  }
}

/* ------------------------------------------------------------ exam centre */

function examDialog({ questions, exam = null }) {
  return new Promise((resolve) => {
    let settled = false;
    const selected = new Set(exam ? exam.questions.map((question) => question.id) : []);
    const errorBox = el('p.small', { role: 'alert', style: { color: '#dc2626', minHeight: '1.2em' } });

    const titleInput = el('input', { id: 'exam-title', type: 'text', maxlength: '120', value: exam?.title ?? '', placeholder: 'مثلاً آزمون میان‌ترم ریاضی' });
    const subjectInput = el('input', { id: 'exam-subject', type: 'text', maxlength: '60', value: exam?.subject ?? '', placeholder: 'ریاضی' });
    const descriptionInput = el('textarea', { id: 'exam-description', rows: '2', maxlength: '2000', value: exam?.description ?? '', placeholder: 'توضیح کوتاه برای دانش‌آموزان' });
    const durationInput = el('input', { id: 'exam-duration', type: 'number', min: '1', max: '600', value: exam?.durationMinutes ?? 20 });
    const passInput = el('input', { id: 'exam-pass', type: 'number', min: '0', max: '100', value: exam?.passPercent ?? 50 });
    const attemptsInput = el('input', { id: 'exam-attempts', type: 'number', min: '1', max: '20', value: exam?.maxAttempts ?? 1 });
    const rewardInput = el('input', { id: 'exam-reward', type: 'number', min: '0', max: '10000', value: exam?.rewardPoints ?? 0 });
    const opensInput = el('input', { id: 'exam-opens', type: 'datetime-local', value: toLocalInput(exam?.opensAt) });
    const closesInput = el('input', { id: 'exam-closes', type: 'datetime-local', value: toLocalInput(exam?.closesAt) });

    function checkbox(id, label, checked) {
      const input = el('input', { id, type: 'checkbox', ...(checked ? { checked: 'checked' } : {}) });
      return { input, node: el('label.check-inline', {}, [input, el('span', { text: label })]) };
    }

    const shuffleQuestions = checkbox('exam-shuffle-questions', 'جابه‌جایی تصادفی سؤال‌ها', exam?.shuffleQuestions !== false);
    const shuffleOptions = checkbox('exam-shuffle-options', 'جابه‌جایی تصادفی گزینه‌ها', exam?.shuffleOptions !== false);
    const showAnswers = checkbox('exam-show-answers', 'نمایش پاسخ صحیح بعد از ثبت', exam?.showAnswers !== false);

    const searchInput = el('input', { type: 'search', placeholder: 'جست‌وجوی سؤال…' });
    const picker = el('div.exam-picker');
    const counter = el('span.small.muted');

    function paintPicker() {
      const term = searchInput.value.trim();
      picker.replaceChildren();
      const eligible = questions.filter((question) => question.type === 'multiple_choice');
      const visible = eligible.filter((question) => !term || question.body.includes(term) || (question.subject ?? '').includes(term));
      if (visible.length === 0) {
        picker.appendChild(el('p.small.muted', { text: 'سؤال چندگزینه‌ای مطابق جست‌وجو پیدا نشد.' }));
      }
      for (const question of visible) {
        const input = el('input', {
          type: 'checkbox',
          ...(selected.has(question.id) ? { checked: 'checked' } : {}),
          onchange: (event) => {
            if (event.target.checked) selected.add(question.id);
            else selected.delete(question.id);
            paintCounter();
          },
        });
        picker.appendChild(el('label.exam-picker__row', {}, [
          input,
          el('span.exam-picker__body', { text: question.body }),
          chip(`${fa(question.points)} امتیاز`, 'muted'),
          chip(DIFFICULTY_LABELS[question.difficulty] ?? 'متوسط', 'muted'),
        ]));
      }
      paintCounter();
    }

    function paintCounter() {
      counter.textContent = `${fa(selected.size)} سؤال انتخاب شده`;
    }

    const selectAll = button('انتخاب همه', {
      kind: 'ghost',
      onClick: () => {
        questions.filter((question) => question.type === 'multiple_choice').forEach((question) => selected.add(question.id));
        paintPicker();
      },
    });
    const clearAll = button('پاک کردن', {
      kind: 'ghost',
      onClick: () => {
        selected.clear();
        paintPicker();
      },
    });
    searchInput.addEventListener('input', paintPicker);

    const form = el('form.exam-form', { novalidate: 'true' }, [
      field('عنوان آزمون', titleInput),
      field('توضیح', descriptionInput),
      el('div.grid.grid--2', {}, [
        field('درس', subjectInput),
        field('مدت آزمون (دقیقه)', durationInput),
      ]),
      el('div.grid.grid--3', {}, [
        field('حد قبولی (٪)', passInput),
        field('حداکثر تلاش', attemptsInput),
        field('امتیاز لیگ', rewardInput),
      ]),
      el('div.grid.grid--2', {}, [
        field('شروع (اختیاری)', opensInput),
        field('پایان (اختیاری)', closesInput),
      ]),
      el('div.field', {}, [
        el('label', { text: 'تنظیمات آزمون' }),
        el('div.check-row', {}, [shuffleQuestions.node, shuffleOptions.node, showAnswers.node]),
      ]),
      el('div.field', {}, [
        el('div.row', { style: { justifyContent: 'space-between', alignItems: 'center' } }, [
          el('label', { text: 'بانک سؤال آزمون' }),
          el('span.row', {}, [selectAll, clearAll]),
        ]),
        searchInput,
        picker,
        counter,
      ]),
      errorBox,
    ]);
    form.addEventListener('submit', (event) => event.preventDefault());

    function submit() {
      errorBox.textContent = '';
      if (!titleInput.value.trim()) {
        errorBox.textContent = 'عنوان آزمون را وارد کنید';
        titleInput.focus();
        return;
      }
      if (selected.size === 0) {
        errorBox.textContent = 'حداقل یک سؤال انتخاب کنید';
        return;
      }
      const duration = Number(durationInput.value);
      if (!Number.isInteger(duration) || duration < 1 || duration > 600) {
        errorBox.textContent = 'مدت آزمون باید بین ۱ تا ۶۰۰ دقیقه باشد';
        return;
      }
      settled = true;
      modal.close();
      resolve({
        title: titleInput.value.trim(),
        description: descriptionInput.value.trim(),
        subject: subjectInput.value.trim(),
        durationMinutes: duration,
        passPercent: Number(passInput.value) || 0,
        maxAttempts: Number(attemptsInput.value) || 1,
        rewardPoints: Number(rewardInput.value) || 0,
        shuffleQuestions: shuffleQuestions.input.checked,
        shuffleOptions: shuffleOptions.input.checked,
        showAnswers: showAnswers.input.checked,
        opensAt: localInputToIso(opensInput.value),
        closesAt: localInputToIso(closesInput.value),
        questionIds: [...selected],
      });
    }

    const modal = openModal({
      title: exam ? 'ویرایش آزمون' : 'آزمون جدید',
      body: form,
      actions: [
        {
          label: 'انصراف',
          kind: 'ghost',
          onClick: ({ close }) => {
            settled = true;
            close();
            resolve(null);
          },
        },
        { label: exam ? 'ذخیره تغییرات' : 'ساخت آزمون', onClick: submit },
      ],
      onClose: () => {
        if (!settled) resolve(null);
      },
    });
    paintPicker();
  });
}

async function createExam(leagueId, questions, reload) {
  const values = await examDialog({ questions });
  if (!values) return;
  try {
    await api.post(`/leagues/${leagueId}/exams`, values);
    notify.ok('آزمون ساخته شد');
    reload();
  } catch (error) {
    notify.error(errorMessage(error));
  }
}

async function editExam(leagueId, exam, questions, reload) {
  let detail;
  try {
    detail = await api.get(`/leagues/${leagueId}/exams/${exam.id}`);
  } catch (error) {
    notify.error(errorMessage(error));
    return;
  }
  const values = await examDialog({ questions, exam: detail });
  if (!values) return;
  try {
    await api.put(`/leagues/${leagueId}/exams/${exam.id}`, values);
    notify.ok('آزمون ویرایش شد');
    reload();
  } catch (error) {
    notify.error(errorMessage(error));
  }
}

async function changeExamStatus(leagueId, exam, action, reload) {
  try {
    await api.post(`/leagues/${leagueId}/exams/${exam.id}/${action}`, {});
    notify.ok(action === 'publish' ? 'آزمون منتشر شد' : action === 'close' ? 'آزمون بسته شد' : 'آزمون به پیش‌نویس برگشت');
    reload();
  } catch (error) {
    notify.error(errorMessage(error));
  }
}

async function removeExam(leagueId, exam, reload) {
  const agreed = await confirmDialog({
    title: 'حذف آزمون',
    message: `آزمون «${exam.title}» و همه نتایج آن حذف شود؟`,
    confirmLabel: 'حذف',
    danger: true,
  });
  if (!agreed) return;
  try {
    await api.del(`/leagues/${leagueId}/exams/${exam.id}`);
    notify.ok('آزمون حذف شد');
    reload();
  } catch (error) {
    notify.error(errorMessage(error));
  }
}

async function openExamResults(leagueId, exam) {
  const body = el('div', {}, [el('p.small.muted', { text: 'در حال محاسبه نتایج…' })]);
  const modal = openModal({ title: `نتایج ${exam.title}`, body });
  try {
    const payload = await api.get(`/leagues/${leagueId}/exams/${exam.id}/results`);
    const summary = payload.summary;
    const attemptRows = payload.attempts.length
      ? payload.attempts.map((attempt) => el('div.timeline-item', {}, [
        el('div', { style: { flex: '1' } }, [
          el('div', {}, [
            el('strong', { text: attempt.studentName }),
            chip(attempt.passed ? 'قبول' : 'نیازمند تلاش', attempt.passed ? 'ok' : 'bad'),
            chip(`تلاش ${fa(attempt.attemptNo)}`, 'muted'),
          ]),
          el('div.row', { style: { gap: '6px', marginTop: '4px', flexWrap: 'wrap' } }, [
            chip(`${fa(attempt.percent)}٪`, attempt.passed ? 'ok' : 'bad'),
            chip(`${fa(attempt.correctCount)} از ${fa(attempt.totalQuestions)}`, 'muted'),
            chip(`🎁 ${fa(attempt.awardedPoints)} امتیاز`, 'amber'),
            chip(attempt.submittedAt ? faDateTime(attempt.submittedAt) : '—', 'muted'),
          ]),
        ]),
      ]))
      : [el('p.muted.small', { text: 'هنوز تلاشی ثبت نشده است.' })];

    const analytics = payload.analytics.length
      ? payload.analytics.map((item, index) => el('div.exam-analytics__row', {}, [
        el('div.exam-analytics__body', {}, [
          el('span.small.muted', { text: `سؤال ${fa(index + 1)}:` }),
          el('span', { text: item.body }),
        ]),
        el('div.exam-bar', {}, [
          el('span.exam-bar__fill', { style: { width: `${item.percent}%` } }),
        ]),
        el('div.row', { style: { gap: '4px' } }, [
          chip(`${fa(item.percent)}٪ صحیح`, item.percent >= 75 ? 'ok' : item.percent >= 40 ? 'amber' : 'bad'),
          chip(`${fa(item.unanswered)} بی‌پاسخ`, 'muted'),
        ]),
      ]))
      : [el('p.muted.small', { text: 'برای تحلیل سؤال‌ها هنوز داده‌ای وجود ندارد.' })];

    modal.setContent([
      el('h2.modal__title', { text: `نتایج ${exam.title}` }),
      grid('grid--stats', [
        statBlock(fa(summary.attempts), 'تلاش ثبت‌شده'),
        statBlock(`${fa(summary.avgPercent)}٪`, 'میانگین'),
        statBlock(`${fa(summary.passRate)}٪`, 'نرخ قبولی'),
        statBlock(fa(summary.highest), 'بالاترین درصد'),
      ]),
      el('h3', { text: `شرکت‌کنندگان (${fa(summary.students)})` }),
      el('div', {}, attemptRows),
      el('h3', { text: 'تحلیل سؤال‌ها' }),
      el('div', {}, analytics),
    ]);
  } catch (error) {
    modal.setContent([el('h2.modal__title', { text: 'خطا' }), el('p', { text: errorMessage(error) })]);
  }
}

function examCard(leagueId, exam, questions, reload) {
  const stateLabel = exam.state === 'open' ? 'آماده شرکت'
    : exam.state === 'upcoming' ? 'در انتظار شروع'
      : exam.state === 'resume' ? 'در حال انجام'
        : exam.state === 'exhausted' ? 'تلاش تمام‌شده'
          : exam.state === 'closed' ? 'بسته' : '';
  const stateKind = ['open', 'resume'].includes(exam.state) ? 'ok'
    : ['upcoming', 'exhausted'].includes(exam.state) ? 'amber' : 'muted';
  return el('article.exam-card', {}, [
    el('div.exam-card__head', {}, [
      el('div', {}, [
        el('h3.exam-card__title', { text: exam.title }),
        el('p.small.muted', { text: exam.description || 'بدون توضیح' }),
      ]),
      el('div.row', { style: { gap: '4px', flexWrap: 'wrap' } }, [
        chip(STATUS_LABELS[exam.status] ?? exam.status, STATUS_KIND[exam.status] ?? 'muted'),
        exam.subject ? chip(exam.subject, 'muted') : null,
      ]),
    ]),
    el('div.row.exam-card__meta', { style: { gap: '6px', flexWrap: 'wrap' } }, [
      chip(`⏱️ ${fa(exam.durationMinutes)} دقیقه`, 'muted'),
      chip(`❓ ${fa(exam.questionCount)} سؤال`, 'muted'),
      chip(`🎯 قبولی ${fa(exam.passPercent)}٪`, 'muted'),
      chip(`🔁 ${fa(exam.maxAttempts)} تلاش`, 'muted'),
      exam.rewardPoints ? chip(`🎁 ${fa(exam.rewardPoints)} امتیاز`, 'amber') : null,
      exam.status === 'published' ? chip(stateLabel, stateKind) : null,
    ]),
    el('div.row.exam-card__stats', { style: { gap: '6px', flexWrap: 'wrap' } }, [
      chip(`👥 ${fa(exam.studentCount ?? 0)} شرکت‌کننده`, 'muted'),
      chip(`📝 ${fa(exam.attemptCount ?? 0)} تلاش`, 'muted'),
      chip(`📊 میانگین ${fa(exam.avgPercent ?? 0)}٪`, 'muted'),
      chip(`✅ قبولی ${fa(exam.passRate ?? 0)}٪`, 'ok'),
    ]),
    el('div.row.exam-card__actions', {}, [
      button('نتایج', { kind: 'soft', icon: '📊', onClick: () => openExamResults(leagueId, exam) }),
      button('ویرایش', { kind: 'ghost', icon: '✏️', onClick: () => editExam(leagueId, exam, questions, reload) }),
      exam.status === 'published'
        ? button('بستن', { kind: 'ghost', icon: '🔒', onClick: () => changeExamStatus(leagueId, exam, 'close', reload) })
        : button('انتشار', { kind: 'soft', icon: '🚀', onClick: () => changeExamStatus(leagueId, exam, 'publish', reload) }),
      iconButton('✕', { label: 'حذف آزمون', danger: true, onClick: () => removeExam(leagueId, exam, reload) }),
    ]),
  ]);
}

function examsPanel(leagueId, exams, questions, reload, createAction) {
  const node = el('div');
  const header = el('div.row', { style: { justifyContent: 'space-between', marginBottom: '10px' } }, [
    el('p.small.muted', { text: 'آزمون بسازید، منتشر کنید و نتیجه و تحلیل سؤال‌ها را ببینید.' }),
    createAction,
  ]);
  if (exams.length === 0) {
    node.append(
      el('div.card', {}, [
        emptyState({
          icon: '🧪',
          title: 'هنوز آزمونی ساخته نشده است',
          hint: 'با دکمه «آزمون جدید» از بانک سؤال یک آزمون زمان‌دار بسازید.',
        }),
      ]),
    );
  } else {
    node.append(el('div.exam-list', {}, exams.map((exam) => examCard(leagueId, exam, questions, reload))));
  }
  return el('div', {}, [header, node]);
}

/* ------------------------------------------------------------ question bank */

function bankPanel(leagueId, questions, recent, reload, leagueName) {
  const list = el('div');
  if (questions.length === 0) {
    list.appendChild(emptyState({ icon: '❓', title: 'سؤالی ثبت نشده است', hint: 'با دکمه «سؤال جدید» یک پرسش کلاسی بسازید.' }));
  }
  for (const question of questions) {
    list.appendChild(el('div.timeline-item', {}, [
      el('div', { style: { flex: '1' } }, [
        el('div', {}, [
          el('strong', { text: question.body }),
          chip(question.isOpen ? 'باز' : 'بسته', question.isOpen ? 'ok' : 'muted'),
          chip(question.type === 'multiple_choice' ? 'تستی' : 'تشریحی', question.type === 'multiple_choice' ? 'ok' : 'muted'),
          question.difficulty ? chip(DIFFICULTY_LABELS[question.difficulty] ?? question.difficulty, 'muted') : null,
        ]),
        questionPreview(question),
        question.explanation ? el('p.small.muted', { text: `توضیح: ${question.explanation}` }) : null,
        el('div.row', { style: { gap: '6px', marginTop: '4px' } }, [
          chip(`🎁 ${fa(question.points)} امتیاز`, 'amber'),
          chip(`💬 ${fa(question.answerCount)} پاسخ`, 'muted'),
          chip(faDateTime(question.createdAt), 'muted'),
        ]),
      ]),
      el('span.row', { style: { gap: '3px' } }, [
        iconButton('💬', { label: 'نمایش پاسخ‌ها', kind: 'soft', onClick: () => openAnswers(question, reload) }),
        iconButton(question.isOpen ? '🔒' : '🔓', { label: question.isOpen ? 'بستن سؤال' : 'باز کردن سؤال', onClick: () => toggleOpen(question, reload) }),
        iconButton('✕', { label: 'حذف سؤال', danger: true, onClick: () => deleteQuestion(question, reload) }),
      ]),
    ]));
  }

  return el('div', {}, [
    grid('grid--stats', [
      statBlock(fa(questions.length), '❓ سؤالات'),
      statBlock(fa(questions.filter((q) => q.isOpen).length), '🔓 باز'),
      statBlock(fa(questions.reduce((acc, q) => acc + q.answerCount, 0)), '💬 پاسخ‌ها'),
      statBlock(fa(questions.filter((q) => q.type === 'multiple_choice').length), '🧪 آماده آزمون'),
    ]),
    el('div.card', {}, [
      el('h2.card__title', {}, [
        el('span', { text: '📋 فهرست سؤالات' }),
        el('span.spacer'),
        el('span.row', {}, [
          button('حالت پخش', {
            kind: 'soft',
            icon: '▶️',
            disabled: questions.length === 0,
            onClick: () => openQuiz(leagueId, questions, reload),
          }),
          button('دستیار هوش مصنوعی', {
            kind: 'soft',
            icon: '🤖',
            onClick: () => openAiAssistant({ leagueId, leagueName, reload }),
          }),
          button('سؤال جدید', { icon: '➕', onClick: () => createQuestion(leagueId, reload) }),
        ]),
      ]),
      el('div.card__body', {}, [list]),
    ]),
    recentCard(recent),
  ].filter(Boolean));
}

export async function renderQa({ params }) {
  const leagueId = Number(params.id);
  setLeagueId(leagueId);
  setTopbarTitle('آزمون‌ها');
  const body = el('div', {}, [loadingNode()]);
  renderView([body]);

  async function load() {
    body.replaceChildren(loadingNode());
    let league;
    let payload;
    let examsPayload;
    try {
      [league, payload] = await Promise.all([
        api.get(`/leagues/${leagueId}`),
        api.get(`/leagues/${leagueId}/questions`),
      ]);
    } catch (error) {
      body.replaceChildren(emptyState({ icon: '⚠️', title: 'دریافت سؤالات ناموفق بود', hint: errorMessage(error) }));
      return;
    }
    try {
      examsPayload = await api.get(`/leagues/${leagueId}/exams`);
    } catch {
      examsPayload = { items: [], stats: { total: 0, published: 0, drafts: 0, attempts: 0 } };
    }
    setLeaguePill({ name: league.league.name });
    const items = payload.items ?? [];
    const exams = examsPayload.items ?? [];
    const stats = examsPayload.stats ?? { total: 0, published: 0, drafts: 0, attempts: 0 };

    let activeTab = 'exams';
    const examsNode = examsPanel(leagueId, exams, items, load, button('آزمون جدید', {
      icon: '➕',
      onClick: () => createExam(leagueId, items, load),
    }));
    const bankNode = bankPanel(leagueId, items, payload.recent ?? [], load, league.league.name);
    bankNode.hidden = true;

    const tabs = el('div.tabs');
    const examTab = el('button.tab.is-active', { type: 'button', text: `🧪 آزمون‌ها (${fa(exams.length)})` });
    const bankTab = el('button.tab', { type: 'button', text: `📚 بانک سؤال (${fa(items.length)})` });
    function activate(tab) {
      activeTab = tab;
      examTab.classList.toggle('is-active', tab === 'exams');
      bankTab.classList.toggle('is-active', tab === 'bank');
      examsNode.hidden = tab !== 'exams';
      bankNode.hidden = tab !== 'bank';
    }
    examTab.addEventListener('click', () => activate('exams'));
    bankTab.addEventListener('click', () => activate('bank'));
    tabs.append(examTab, bankTab);
    void activeTab;

    body.replaceChildren(...[
      pageHead({
        icon: '🧪',
        title: 'مرکز آزمون',
        subtitle: league.league.name,
        actions: [
          el('a.btn.btn--ghost', { href: `#/teacher/league/${leagueId}`, text: '↩️ لیگ' }),
          backToWorkbench(),
        ],
      }),
      grid('grid--stats', [
        statBlock(fa(stats.total ?? exams.length), '🧪 آزمون‌ها'),
        statBlock(fa(stats.published ?? 0), '🚀 منتشرشده'),
        statBlock(fa(stats.attempts ?? 0), '📝 تلاش‌ها'),
        statBlock(fa(items.length), '📚 بانک سؤال'),
      ]),
      tabs,
      examsNode,
      bankNode,
    ]);
  }

  await load();
  return undefined;
}
