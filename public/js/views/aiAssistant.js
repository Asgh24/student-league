/**
 * «ساخت سؤال با هوش مصنوعی» — a provider-free importer.
 *
 * The site never calls an AI provider and stores no API key. The teacher copies a
 * ready-made prompt into any AI chat, appends their questions, then pastes the
 * JSON answer here. The text is parsed locally, previewed, and only the
 * selected questions are saved through the normal bulk endpoint.
 */

import { buildAiQuestionTemplate, parseAiQuestions } from '../aiQuestionFormat.js';
import { api } from '../api.js';
import { el } from '../dom.js';
import { errorMessage } from '../format.js';
import { notify, openModal } from '../ui.js';
import { button, chip, fa, field } from './common.js';

/** Clipboard write with a selection fallback for older browsers. */
async function copyToClipboard(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the textarea fallback */
  }

  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  let copied = false;
  try {
    copied = Boolean(document.execCommand?.('copy'));
  } catch {
    copied = false;
  }
  area.remove();
  return copied;
}

function stepHead(number, title) {
  return el('div.ai-step__head', {}, [
    el('span.ai-step__number', { text: number, 'aria-hidden': 'true' }),
    el('h3.ai-step__title', { text: title }),
  ]);
}

/**
 * Opens the importer. `reload` is the Q&A list loader, called after a bulk save
 * so the new questions appear immediately.
 */
export function openAiAssistant({ leagueId, leagueName = '', reload = async () => {} }) {
  const template = buildAiQuestionTemplate({ leagueName });
  const body = el('div.ai-assistant');
  const modal = openModal({
    title: '✨ ساخت سؤال با هوش مصنوعی',
    body,
    actions: [{ label: 'بستن', kind: 'ghost' }],
  });
  modal.content.classList.add('modal--ai');

  const previewBox = el('div.ai-preview');
  const parseStatus = el('p.small.ai-status', { role: 'status' });
  const templateArea = el('textarea.ai-template', {
    id: 'ai-template',
    rows: '10',
    readonly: 'true',
    'aria-label': 'قالب پیش‌فرض برای هوش مصنوعی',
  });
  templateArea.value = template;

  const pasteArea = el('textarea.ai-paste', {
    id: 'ai-paste',
    rows: '8',
    placeholder: '{\n  "questions": [\n    { "body": "…", "options": ["…"], "correctIndex": 0, "points": 25 }\n  ]\n}',
    'aria-label': 'پاسخ هوش مصنوعی',
  });

  function renderPreview(questions) {
    previewBox.replaceChildren();
    const checks = [];
    const pointInputs = [];
    const selectedLabel = el('span.small.muted');
    const saveStatus = el('p.small.ai-status', { role: 'status' });
    const allCheck = el('input', {
      type: 'checkbox',
      checked: true,
      'aria-label': 'انتخاب همه سؤال‌ها',
    });
    const saveButton = button('ذخیره سؤال‌های انتخاب‌شده', { icon: '💾' });

    function selectedQuestions() {
      return questions
        .map((question, index) => ({
          ...question,
          points: Number(pointInputs[index]?.value ?? question.points),
        }))
        .filter((_, index) => checks[index].checked);
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
      const pointsInput = el('input.ai-question__points', {
        type: 'number',
        min: '0',
        max: '10000',
        step: '1',
        value: String(question.points ?? 0),
        'aria-label': `امتیاز سؤال ${fa(index + 1)}`,
      });
      pointInputs.push(pointsInput);
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
            el('label.ai-question__points-label', {}, [
              el('span.small', { text: '🎁 امتیاز' }),
              pointsInput,
            ]),
            chip(`گزینه صحیح: ${fa(question.correctIndex + 1)}`, 'muted'),
          ]),
        ]),
      ]);
    });

    saveButton.addEventListener('click', async () => {
      const selectedIndexes = questions
        .map((_, index) => index)
        .filter((index) => checks[index].checked);
      const invalidIndex = selectedIndexes.find((index) => {
        const value = Number(pointInputs[index]?.value);
        return !Number.isInteger(value) || value < 0 || value > 10000;
      });
      if (invalidIndex !== undefined) {
        saveStatus.textContent = `امتیاز سؤال ${fa(invalidIndex + 1)} باید عددی بین ۰ تا ۱۰۰۰۰ باشد.`;
        pointInputs[invalidIndex]?.focus();
        return;
      }
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

  function convert() {
    parseStatus.textContent = '';
    try {
      const result = parseAiQuestions(pasteArea.value);
      renderPreview(result.questions);
      parseStatus.textContent = result.skipped
        ? `${fa(result.questions.length)} سؤال آماده شد؛ ${fa(result.skipped)} مورد نامعتبر نادیده گرفته شد.`
        : `${fa(result.questions.length)} سؤال آماده شد. پیش از ذخیره بررسی کنید.`;
    } catch (error) {
      previewBox.replaceChildren();
      parseStatus.textContent = error.message;
    }
  }

  const copyButton = button('کپی قالب', {
    kind: 'soft',
    icon: '📋',
    onClick: async () => {
      const copied = await copyToClipboard(template);
      if (copied) notify.ok('قالب در حافظه کپی شد');
      else notify.error('کپی خودکار ممکن نشد؛ متن را انتخاب و دستی کپی کنید');
      templateArea.focus();
      templateArea.select();
    },
  });

  const convertButton = button('تبدیل به سؤال', {
    kind: 'soft',
    icon: '⚡',
    onClick: convert,
  });

  // Pasting is the main flow: convert automatically when the text arrives.
  pasteArea.addEventListener('paste', () => {
    setTimeout(() => {
      if (pasteArea.value.trim()) convert();
    }, 0);
  });
  pasteArea.addEventListener('change', () => {
    if (pasteArea.value.trim()) convert();
  });

  body.replaceChildren(
    el('p.ai-assistant__intro.small.muted', {
      text: `این بخش به هیچ سرویس هوش مصنوعی متصل نیست و کلید API نمی‌خواهد. قالب پیش‌فرض را کپی کنید، همراه سؤال‌های خود به هر چت هوش مصنوعی بدهید، سپس پاسخ را در کادر دوم بچسبانید${leagueName ? ` تا برای «${leagueName}» به سؤال تبدیل شود` : ''}.`,
    }),
    el('section.ai-step', {}, [
      stepHead('۱', 'قالب را کپی کنید و به هوش مصنوعی بدهید'),
      el('p.small.muted', {
        text: 'این متن را کامل کپی کنید، سؤال‌های چهارگزینه‌ای خود را در انتهای آن جای‌گذاری کنید و برای هوش مصنوعی بفرستید. خروجی باید فقط JSON باشد.',
      }),
      field('قالب پیش‌فرض', templateArea),
      el('div.ai-step__actions', {}, [copyButton]),
    ]),
    el('section.ai-step', {}, [
      stepHead('۲', 'پاسخ هوش مصنوعی را بچسبانید'),
      el('p.small.muted', {
        text: 'پاسخ JSON را همین‌جا بچسبانید؛ سؤال‌ها و گزینه‌ها به‌صورت خودکار جدا می‌شوند. اگر خروجی داخل بلوک ```json بود هم مشکلی نیست.',
      }),
      field('پاسخ هوش مصنوعی', pasteArea),
      el('div.ai-step__actions', {}, [convertButton]),
      parseStatus,
    ]),
    previewBox,
  );
}
