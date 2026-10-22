/**
 * AI assistant modal for the Q&A page.
 *
 * The assistant asks Groq for a multiple-choice quiz, shows every generated
 * question for review and only saves the ones the teacher keeps. The Groq key
 * is write-only: this module can save/clear it but never receives it back.
 */

import { api } from '../api.js';
import { el } from '../dom.js';
import { errorMessage } from '../format.js';
import { notify, openModal } from '../ui.js';
import { button, chip, fa, faDateTime, field, loadingNode } from './common.js';

const SOURCE_LABELS = {
  teacher: ['کلید شخصی شما', 'ok'],
  server: ['کلید پیشفرض سامانه', 'gold'],
  none: ['کلید تنظیم نشده', 'bad'],
};

const DIFFICULTY_LABELS = {
  easy: 'آسان',
  medium: 'متوسط',
  hard: 'سخت',
};

function sourceChip(config) {
  const [label, kind] = SOURCE_LABELS[config?.source] ?? SOURCE_LABELS.none;
  return chip(label, kind);
}

function selectControl(id, options, selectedValue) {
  return el('select', { id }, options.map(([value, label]) => el('option', {
    value,
    selected: value === selectedValue,
  }, [label])));
}

/**
 * Opens the assistant. `reload` is the Q&A list loader, called after a bulk
 * save so the new questions appear immediately.
 */
export async function openAiAssistant({ leagueId, leagueName = '', reload = async () => {} }) {
  const body = el('div.ai-assistant', {}, [loadingNode('در حال بررسی تنظیمات هوش مصنوعی…')]);
  const modal = openModal({
    title: '🤖 دستیار هوش مصنوعی',
    body,
    actions: [{ label: 'بستن', kind: 'ghost' }],
  });
  modal.content.classList.add('modal--ai');

  let config = null;
  let settingsError = null;
  try {
    const payload = await api.get('/ai/settings');
    config = payload?.config ?? null;
  } catch (error) {
    settingsError = error;
  }

  const keyPanel = el('div.ai-settings');
  const previewBox = el('div.ai-preview');
  let generateButton = null;
  let generatorHint = null;

  function updateGeneratorAvailability() {
    if (!generateButton) return;
    const ready = Boolean(config?.configured);
    generateButton.disabled = !ready;
    if (generatorHint) {
      generatorHint.textContent = ready
        ? ''
        : 'برای شروع، ابتدا کلید API Groq را ذخیره کنید.';
    }
  }

  function renderKeyPanel() {
    keyPanel.replaceChildren();
    if (settingsError) {
      keyPanel.appendChild(el('p.small.ai-status', {
        role: 'alert',
        text: errorMessage(settingsError),
      }));
      return;
    }

    const details = el('details.ai-key');
    if (!config?.own?.hasApiKey) details.open = true;
    const summary = el('summary.ai-key__summary', {}, [
      el('span', { text: 'تنظیمات کلید Groq' }),
    ]);
    details.appendChild(summary);

    const keyInput = el('input', {
      id: 'ai-groq-key',
      type: 'password',
      maxlength: '300',
      autocomplete: 'off',
      placeholder: config?.own?.hasApiKey ? 'کلید جدید را وارد کنید (اختیاری)' : 'gsk_...',
    });
    const changeKeyButton = button(config?.own?.hasApiKey ? 'تغییر کلید API' : 'تنظیم کلید API', {
      kind: 'soft',
      icon: '🔑',
      onClick: () => {
        details.open = true;
        keyInput.focus();
      },
    });
    const toolbar = el('div.ai-key__toolbar', {}, [
      el('div.row', { style: { gap: '6px', alignItems: 'center' } }, [
        el('span.small.muted', { text: 'کلید دستیار هوش مصنوعی' }),
        sourceChip(config),
      ]),
      changeKeyButton,
    ]);
    const clearInput = el('input', { id: 'ai-clear-key', type: 'checkbox' });
    const keyStatus = el('p.small.ai-status', { role: 'status' });
    const saveKeyButton = button('ذخیره کلید', {
      kind: 'soft',
      icon: '🔑',
      onClick: saveKey,
    });

    const notes = [];
    if (config?.source === 'teacher') {
      notes.push('کلید ذخیرهشده شما برای ساخت سؤال استفاده میشود.');
    } else if (config?.source === 'server') {
      notes.push('در حال حاضر از کلید پیشفرض سامانه استفاده میشود. میتوانید کلید شخصی خود را هم ذخیره کنید.');
    } else {
      notes.push('هنوز کلیدی تنظیم نشده است. یک کلید از کنسول Groq بسازید و همینجا ذخیره کنید.');
    }
    if (config?.own?.hasApiKey && config?.own?.updatedAt) {
      notes.push(`آخرین بهروزرسانی کلید شخصی: ${faDateTime(config.own.updatedAt)}`);
    }

    async function saveKey() {
      const apiKey = keyInput.value.trim();
      const clearApiKey = clearInput.checked;
      keyStatus.textContent = '';
      if (!apiKey && !clearApiKey) {
        keyStatus.textContent = 'کلید جدید را وارد کنید یا گزینه حذف کلید را انتخاب کنید.';
        keyInput.focus();
        return;
      }
      if (apiKey && clearApiKey) {
        keyStatus.textContent = 'ذخیره کلید جدید و حذف همزمان ممکن نیست؛ یکی را انتخاب کنید.';
        return;
      }
      saveKeyButton.disabled = true;
      try {
        const payload = await api.put('/ai/settings', clearApiKey ? { clearApiKey: true } : { apiKey });
        config = payload?.config ?? config;
        notify.ok(clearApiKey ? 'کلید شخصی حذف شد' : 'کلید Groq ذخیره شد');
        renderKeyPanel();
        updateGeneratorAvailability();
      } catch (error) {
        keyStatus.textContent = errorMessage(error);
      } finally {
        saveKeyButton.disabled = false;
      }
    }

    const children = [
      field(config?.own?.hasApiKey ? 'کلید جدید Groq' : 'کلید API Groq', keyInput),
      el('div.row.ai-key__actions', {}, [saveKeyButton]),
    ];
    if (config?.own?.hasApiKey) {
      children.push(el('label.ai-check', {}, [
        clearInput,
        el('span', { text: 'کلید شخصی حذف شود و از کلید پیشفرض سامانه استفاده شود' }),
      ]));
    }
    children.push(el('div.ai-key__notes', {}, notes.map((note) => el('p.small.muted', { text: note }))));
    children.push(el('p.small.muted', {}, [
      'کلید را از ',
      el('a', {
        href: 'https://console.groq.com/keys',
        target: '_blank',
        rel: 'noopener noreferrer',
        text: 'کنسول Groq',
      }),
      ' بگیرید. کلید فقط رمزنگاری‌شده ذخیره می‌شود و هرگز به مرورگر برنمی‌گردد.',
    ]));
    children.push(keyStatus);
    details.append(...children);
    keyPanel.append(toolbar, details);
  }

  function renderPreview(questions) {
    previewBox.replaceChildren();
    const checks = [];
    const selectedLabel = el('span.small.muted');
    const saveStatus = el('p.small.ai-status', { role: 'status' });
    const allCheck = el('input', {
      type: 'checkbox',
      checked: true,
      'aria-label': 'انتخاب همه سؤال‌ها',
    });
    const saveButton = button('ذخیره سؤال‌های انتخاب‌شده', { icon: '💾' });

    function selectedQuestions() {
      return questions.filter((_, index) => checks[index].checked);
    }

    function updateSelection() {
      const selected = selectedQuestions().length;
      selectedLabel.textContent = `${fa(selected)} از ${fa(questions.length)} سؤال انتخاب شده`;
      allCheck.checked = selected === questions.length;
      allCheck.indeterminate = selected > 0 && selected < questions.length;
      saveButton.disabled = selected === 0;
    }

    allCheck.addEventListener('change', () => {
      for (const check of checks) check.checked = allCheck.checked;
      updateSelection();
    });

    const questionNodes = questions.map((question, index) => {
      const check = el('input', {
        type: 'checkbox',
        checked: true,
        'aria-label': `انتخاب سؤال ${fa(index + 1)}`,
      });
      check.addEventListener('change', updateSelection);
      checks.push(check);
      return el('section.ai-question', {}, [
        el('label.ai-question__pick', {}, [
          check,
          el('span.small', { text: `سؤال ${fa(index + 1)}` }),
        ]),
        el('div.ai-question__content', {}, [
          el('p.ai-question__body', { text: question.body }),
          el('div.mcq-preview', {}, question.options.map((option, optionIndex) => el(
            `div.mcq-preview__option${optionIndex === question.correctIndex ? '.is-correct' : ''}`,
            {},
            [
              el('span.mcq-preview__index', { text: `${fa(optionIndex + 1)}.` }),
              el('span', { text: option }),
              optionIndex === question.correctIndex ? chip('صحیح', 'ok') : null,
            ],
          ))),
          el('div.row.ai-question__meta', {}, [
            chip(`🎁 ${fa(question.points)} امتیاز`, 'amber'),
            chip(`گزینه صحیح: ${fa(question.correctIndex + 1)}`, 'muted'),
          ]),
        ]),
      ]);
    });

    saveButton.addEventListener('click', async () => {
      const selected = selectedQuestions();
      if (selected.length === 0) return;
      saveStatus.textContent = '';
      saveButton.disabled = true;
      try {
        await api.post(`/leagues/${leagueId}/questions/bulk`, { questions: selected });
        notify.ok(`${fa(selected.length)} سؤال به پرسش و پاسخ اضافه شد`);
        modal.close();
        await reload();
      } catch (error) {
        saveStatus.textContent = errorMessage(error);
        saveButton.disabled = false;
      }
    });

    previewBox.append(
      el('div.ai-preview__head', {}, [
        el('div', {}, [
          el('h3.ai-section__title', { text: 'پیش‌نمایش سؤال‌ها' }),
          el('p.small.muted', { text: 'سؤال‌ها و گزینه صحیح را بررسی کنید. هنوز چیزی ذخیره نشده است.' }),
        ]),
        chip(`✨ ${fa(questions.length)} سؤال`, 'ok'),
      ]),
      el('div.ai-preview__tools', {}, [
        el('label.ai-check', {}, [allCheck, el('span', { text: 'انتخاب همه' })]),
        selectedLabel,
      ]),
      el('div.ai-preview__list', {}, questionNodes),
      el('div.ai-preview__actions', {}, [saveButton]),
      saveStatus,
    );
    updateSelection();
  }

  function build() {
    renderKeyPanel();

    const topicInput = el('input', {
      id: 'ai-topic',
      type: 'text',
      maxlength: '300',
      placeholder: 'مثلاً: کسرها و اعشار — ریاضی ششم',
    });
    const countSelect = selectControl('ai-count', [
      ['3', '۳ سؤال'],
      ['5', '۵ سؤال'],
      ['7', '۷ سؤال'],
      ['10', '۱۰ سؤال'],
    ], '5');
    const difficultySelect = selectControl('ai-difficulty', [
      ['easy', DIFFICULTY_LABELS.easy],
      ['medium', DIFFICULTY_LABELS.medium],
      ['hard', DIFFICULTY_LABELS.hard],
    ], 'medium');
    const notesInput = el('textarea', {
      id: 'ai-notes',
      rows: '2',
      maxlength: '1000',
      placeholder: 'اختیاری: فصل، پایه، نکات مهم یا لحن سؤال‌ها',
    });
    const status = el('p.small.ai-status', { role: 'status' });
    generatorHint = el('p.small.muted', { text: '' });
    generateButton = button('ساخت سؤال با هوش مصنوعی', {
      type: 'submit',
      icon: '✨',
    });

    const form = el('form.ai-form', {}, [
      field('موضوع آزمون یا پرسشنامه', topicInput, 'هرچه موضوع دقیق‌تر باشد، سؤال‌ها بهتر می‌شوند.'),
      el('div.ai-form__row', {}, [
        field('تعداد سؤال', countSelect),
        field('سطح سختی', difficultySelect),
      ]),
      field('توضیحات تکمیلی', notesInput),
      generatorHint,
      el('div.row', {}, [generateButton]),
      status,
    ]);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      status.textContent = '';
      const topic = topicInput.value.trim();
      if (topic.length < 3) {
        status.textContent = 'موضوع آزمون را وارد کنید (حداقل ۳ نویسه).';
        topicInput.focus();
        return;
      }
      generateButton.disabled = true;
      status.textContent = '⏳ در حال ساخت سؤال‌ها با Groq…';
      form.setAttribute('aria-busy', 'true');
      try {
        const payload = await api.post(`/leagues/${leagueId}/ai/questions`, {
          topic,
          count: Number(countSelect.value),
          difficulty: difficultySelect.value,
          notes: notesInput.value.trim(),
        });
        const questions = payload?.questions ?? [];
        status.textContent = questions.length
          ? `${fa(questions.length)} سؤال ساخته شد. پیش از ذخیره بررسی کنید.`
          : 'سؤالی ساخته نشد.';
        if (questions.length) renderPreview(questions);
      } catch (error) {
        status.textContent = errorMessage(error);
      } finally {
        form.removeAttribute('aria-busy');
        updateGeneratorAvailability();
      }
    });

    body.replaceChildren(...[
      el('p.ai-assistant__intro.small.muted', {
        text: `با هوش مصنوعی Groq یک آزمون یا پرسشنامه چندگزینه‌ای بسازید${leagueName ? ` برای «${leagueName}»` : ''}. سؤال‌ها ابتدا پیش‌نمایش می‌شوند و فقط پس از تأیید شما ذخیره می‌شوند.`,
      }),
      keyPanel,
      el('section.ai-generator', {}, [
        el('h3.ai-section__title', { text: 'ساخت آزمون' }),
        form,
      ]),
      previewBox,
    ]);
    updateGeneratorAvailability();
  }

  if (settingsError && !config) {
    config = { configured: false, source: 'none', own: { hasApiKey: false } };
  }
  build();
}
