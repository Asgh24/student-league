/** Class questions with student answers and point awards. */

import { api } from '../api.js';
import { el } from '../dom.js';
import { errorMessage } from '../format.js';
import { renderView, setLeaguePill, setTopbarTitle } from '../shell.js';
import { setLeagueId } from '../store.js';
import { confirmDialog, emptyState, notify, openModal } from '../ui.js';
import { backToWorkbench, button, card, chip, fa, faDateTime, field, grid, iconButton, loadingNode, pageHead } from './common.js';
import { openAiAssistant } from './aiAssistant.js';
import { startQuiz } from './quizStage.js';

/** Modal with a teacher-managed option list and one correct choice. */
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
    const form = el('form.mcq-form', { novalidate: 'true' }, [
      field('متن سؤال', bodyInput),
      optionsField,
      field('امتیاز پاسخ درست', pointsInput),
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
      resolve({ body, points, options: cleaned, correctIndex });
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
  try {
    await api.post(`/leagues/${leagueId}/questions`, {
      body: values.body,
      points: values.points,
      options: values.options,
      correctIndex: values.correctIndex,
    });
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

export async function renderQa({ params }) {
  const leagueId = Number(params.id);
  setLeagueId(leagueId);
  setTopbarTitle('سوال و پاسخ');
  const body = el('div', {}, [loadingNode()]);
  renderView([body]);

  async function load() {
    body.replaceChildren(loadingNode());
    let league;
    let payload;
    try {
      [league, payload] = await Promise.all([
        api.get(`/leagues/${leagueId}`),
        api.get(`/leagues/${leagueId}/questions`),
      ]);
    } catch (error) {
      body.replaceChildren(emptyState({ icon: '⚠️', title: 'دریافت سؤالات ناموفق بود', hint: errorMessage(error) }));
      return;
    }
    setLeaguePill({ name: league.league.name });
    const items = payload.items ?? [];

    const list = el('div');
    if (items.length === 0) {
      list.appendChild(emptyState({ icon: '❓', title: 'سؤالی ثبت نشده است', hint: 'با دکمه «سؤال جدید» یک پرسش کلاسی بسازید.' }));
    }
    for (const question of items) {
      list.appendChild(el('div.timeline-item', {}, [
        el('div', { style: { flex: '1' } }, [
          el('div', {}, [
            el('strong', { text: question.body }),
            chip(question.isOpen ? 'باز' : 'بسته', question.isOpen ? 'ok' : 'muted'),
            chip(question.type === 'multiple_choice' ? 'تستی' : 'تشریحی', question.type === 'multiple_choice' ? 'ok' : 'muted'),
          ]),
          questionPreview(question),
          el('div.row', { style: { gap: '6px', marginTop: '4px' } }, [
            chip(`🎁 ${fa(question.points)} امتیاز`, 'amber'),
            chip(`💬 ${fa(question.answerCount)} پاسخ`, 'muted'),
            chip(faDateTime(question.createdAt), 'muted'),
          ]),
        ]),
        el('span.row', { style: { gap: '3px' } }, [
          iconButton('💬', { label: 'نمایش پاسخ‌ها', kind: 'soft', onClick: () => openAnswers(question, load) }),
          iconButton(question.isOpen ? '🔒' : '🔓', { label: question.isOpen ? 'بستن سؤال' : 'باز کردن سؤال', onClick: () => toggleOpen(question, load) }),
          iconButton('✕', { label: 'حذف سؤال', danger: true, onClick: () => deleteQuestion(question, load) }),
        ]),
      ]));
    }

    const recent = recentCard(payload.recent ?? []);
    body.replaceChildren(...[
      pageHead({
        icon: '❓',
        title: 'سوال و پاسخ',
        subtitle: league.league.name,
        actions: [
          button('حالت پخش', {
            kind: 'soft',
            icon: '▶️',
            disabled: items.length === 0,
            onClick: () => openQuiz(leagueId, items, load),
          }),
          button('دستیار هوش مصنوعی', {
            kind: 'soft',
            icon: '🤖',
            onClick: () => openAiAssistant({ leagueId, leagueName: league.league.name, reload: load }),
          }),
          button('سؤال جدید', { icon: '➕', onClick: () => createQuestion(leagueId, load) }),
          el('a.btn.btn--ghost', { href: `#/teacher/league/${leagueId}`, text: '↩️ لیگ' }),
          backToWorkbench(),
        ],
      }),
      grid('grid--stats', [
        el('div.stat', {}, [el('div.stat__value', { text: fa(items.length) }), el('div.stat__label', { text: '❓ سؤالات' })]),
        el('div.stat', {}, [el('div.stat__value', { text: fa(items.filter((q) => q.isOpen).length) }), el('div.stat__label', { text: '🔓 باز' })]),
        el('div.stat', {}, [
          el('div.stat__value', { text: fa(items.reduce((acc, q) => acc + q.answerCount, 0)) }),
          el('div.stat__label', { text: '💬 پاسخ‌ها' }),
        ]),
      ]),
      card({ title: 'فهرست سؤالات', icon: '📋' }, [list]),
      recent,
    ].filter(Boolean));
  }

  await load();
  return undefined;
}
