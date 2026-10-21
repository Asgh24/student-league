/**
 * Course evaluations (teacher): create form, headline stats, filters, the list of
 * recorded evaluations and the mark sheet of the selected one.
 */

import { api } from '../api.js';
import { el } from '../dom.js';
import { errorMessage } from '../format.js';
import { todayIso } from '../jalali.js';
import { jalaliDateInput } from '../jalaliDate.js';
import { EVALUATION_KINDS, GRADES, gradesForLevel, DESCRIPTIVE_LEVELS, numericBand, SCHOOL_LEVELS } from '../evaluationMeta.js';
import { renderView, setLeaguePill, setTopbarTitle } from '../shell.js';
import { setLeagueId, state } from '../store.js';
import { confirmDialog, emptyState, formDialog, notify } from '../ui.js';
import { backToWorkbench, button, card, chip, fa, faDate, grid, iconButton, loadingNode, pageHead, statCard } from './common.js';
import { gradingCard } from './evaluationGrading.js';

function today() {
  return todayIso(state.meta?.timezoneOffsetMinutes ?? 210);
}

function optionNodes(values, selected = '') {
  return values.map((value) => el('option', { value, text: value, selected: value === selected }));
}

/** Inline create form (matches the reference layout: one card, one row of fields). */
function formCard({ leagueId, payload, onCreated }) {
  const options = payload.options ?? {};
  const grade = payload.league?.grade ?? '';
  const defaultLevel = SCHOOL_LEVELS.find((level) => gradesForLevel(level).includes(grade)) ?? '';

  const levelInput = el('select', { id: 'ev-level' }, [
    el('option', { value: '', text: 'انتخاب کنید' }),
    ...optionNodes(SCHOOL_LEVELS, defaultLevel),
  ]);
  const gradeInput = el('select', { id: 'ev-grade' });
  const subjectInput = el('input', { id: 'ev-subject', type: 'text', list: 'ev-subject-options', placeholder: 'مثلاً ریاضی', autocomplete: 'off' });
  const titleInput = el('input', { id: 'ev-title', type: 'text', list: 'ev-title-options', placeholder: 'مثلاً آزمون فصل ۲', autocomplete: 'off' });
  const dateInput = jalaliDateInput({
    id: 'ev-date',
    value: today(),
    persianDigits: state.persianDigits,
    tzOffsetMinutes: state.meta?.timezoneOffsetMinutes ?? 210,
  });
  const kindInput = el('select', { id: 'ev-kind' }, (options.kinds ?? EVALUATION_KINDS).map((kind) => el('option', { value: kind.key, text: kind.label })));
  const maxInput = el('input', { id: 'ev-max', type: 'number', min: 1, max: 100, value: 20, 'aria-label': 'حداکثر نمره' });
  const noteInput = el('textarea', { id: 'ev-note', placeholder: 'توضیح اختیاری برای دانش‌آموزان' });
  const linkHint = el('span.muted.small');

  const subjectOptions = [...new Set([...(payload.columns ?? []).map((column) => column.name), ...(payload.subjects ?? [])])];
  const dataLists = el('div', { hidden: 'true' }, [
    el('datalist', { id: 'ev-subject-options' }, subjectOptions.map((value) => el('option', { value }))),
    el('datalist', { id: 'ev-title-options' }, (payload.titles ?? []).map((value) => el('option', { value }))),
  ]);

  function syncGrades() {
    const grades = gradesForLevel(levelInput.value);
    gradeInput.replaceChildren(
      el('option', { value: '', text: grades.length ? 'انتخاب کنید' : 'پایه ندارد' }),
      ...optionNodes(grades, grade),
    );
    gradeInput.disabled = grades.length === 0;
  }

  function syncHint() {
    const name = subjectInput.value.trim();
    const column = (payload.columns ?? []).find((item) => item.name === name);
    if (!column) {
      linkHint.textContent = 'نمره‌ها فقط در کارنامهٔ ارزشیابی ثبت می‌شوند؛ برای انتقال به لیگ، نام درس را با یک ستون لیگ یکسان کنید.';
      return;
    }
    linkHint.textContent = payload.scoring?.enabled === false
      ? `🔗 به ستون «${column.name}» لیگ ارجاع داده می‌شود (امتیازدهی ارزشیابی خاموش است).`
      : `🔗 نمره‌ها طبق «تنظیمات امتیازدهی» به ستون «${column.name}» لیگ اضافه می‌شوند.`;
  }

  levelInput.addEventListener('change', syncGrades);
  subjectInput.addEventListener('input', syncHint);
  syncGrades();
  syncHint();

  async function submit() {
    const payloadBody = {
      subject: subjectInput.value.trim(),
      title: titleInput.value.trim(),
      level: levelInput.value,
      grade: gradeInput.value,
      kind: kindInput.value,
      scaleMin: 0,
      scaleMax: Number(maxInput.value) || 20,
      heldOn: dateInput.value,
      note: noteInput.value.trim(),
    };
    if (!payloadBody.subject || !payloadBody.title || !payloadBody.heldOn) {
      notify.error('نام درس، عنوان ارزشیابی و تاریخ الزامی است');
      return;
    }
    try {
      await api.post(`/leagues/${leagueId}/evaluations`, payloadBody);
      notify.ok('ارزشیابی ثبت شد');
      onCreated();
    } catch (error) {
      notify.error(errorMessage(error));
    }
  }

  return card({ title: 'ثبت ارزشیابی جدید', icon: '➕' }, [
    dataLists,
    el('div.grid', { style: { gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' } }, [
      el('div.field', {}, [el('label', { for: 'ev-level', text: 'مقطع' }), levelInput]),
      el('div.field', {}, [el('label', { for: 'ev-grade', text: 'پایه' }), gradeInput]),
      el('div.field', {}, [el('label', { for: 'ev-subject', text: 'نام درس' }), subjectInput]),
      el('div.field', {}, [el('label', { for: 'ev-title', text: 'عنوان امتحان / ارزشیابی' }), titleInput]),
      el('div.field', {}, [el('label', { for: 'ev-date', text: 'تاریخ (شمسی)' }), dateInput]),
      el('div.field', {}, [el('label', { for: 'ev-kind', text: 'نوع' }), kindInput]),
      el('div.field', {}, [el('label', { for: 'ev-max', text: 'حداکثر نمره' }), maxInput]),
    ]),
    el('div.field', {}, [el('label', { for: 'ev-note', text: 'توضیح (اختیاری)' }), noteInput]),
    el('p', {}, [linkHint]),
    el('div.row', {}, [button('ثبت ارزشیابی', { kind: 'soft', icon: '💾', onClick: submit })]),
  ]);
}

/**
 * «تنظیمات امتیازدهی»: each qualitative level is worth a fixed number of league
 * points; the marks of an evaluation are added to the linked column. The small
 * calculator previews the mapping for a numeric mark (9.99 → -50 by default).
 */
function scoringCard({ leagueId, scoring, reload }) {
  const current = scoring ?? { enabled: true, excellent: 100, good: 25, fair: -25, needsWork: -50 };
  const enabled = el('input', { id: 'ev-points-enabled', type: 'checkbox' });
  enabled.checked = Boolean(current.enabled);

  const inputs = new Map();
  const levelFields = DESCRIPTIVE_LEVELS.map((level) => {
    const settingKey = level.key === 'needs-work' ? 'needsWork' : level.key;
    const input = el('input', {
      id: `ev-points-${level.key}`,
      type: 'number',
      step: 1,
      min: -100000,
      max: 100000,
      value: String(current[settingKey] ?? 0),
      'aria-label': `امتیاز ${level.label}`,
    });
    inputs.set(level.key, input);
    return el('div.field', {}, [
      el('label', { for: `ev-points-${level.key}`, text: `${level.icon} ${level.label}` }),
      input,
    ]);
  });

  const sample = el('input', {
    id: 'ev-points-sample',
    type: 'number',
    min: 0,
    max: 20,
    step: '0.01',
    value: '9.99',
    'aria-label': 'نمونه نمره برای پیش‌نمایش',
  });
  const preview = el('strong', { 'aria-live': 'polite' });

  function pointsFor(bandKey) {
    const input = inputs.get(bandKey === 'very-good' ? 'excellent' : bandKey);
    return Number(input?.value) || 0;
  }

  function syncPreview() {
    const band = sample.value === '' ? null : numericBand(Number(sample.value), 20);
    preview.textContent = band ? `${band.icon} ${band.label} ← ${fa(pointsFor(band.key))} امتیاز لیگ` : '—';
  }

  for (const input of inputs.values()) input.addEventListener('input', syncPreview);
  sample.addEventListener('input', syncPreview);
  syncPreview();

  async function save() {
    const body = {
      enabled: enabled.checked,
      excellent: Number(inputs.get('excellent').value) || 0,
      good: Number(inputs.get('good').value) || 0,
      fair: Number(inputs.get('fair').value) || 0,
      needsWork: Number(inputs.get('needs-work').value) || 0,
    };
    try {
      await api.put(`/leagues/${leagueId}/evaluations/scoring`, body);
      notify.ok(body.enabled ? 'تنظیمات امتیازدهی ذخیره شد' : 'امتیازدهی ارزشیابی خاموش شد');
      reload();
    } catch (error) {
      notify.error(errorMessage(error));
    }
  }

  return card({ title: 'تنظیمات امتیازدهی', icon: '⚙️' }, [
    el('label.checkbox', { for: 'ev-points-enabled' }, [
      enabled,
      el('span', { text: 'نمره‌های هر ارزشیابی به ستون هم‌نام درس در لیگ اضافه شوند' }),
    ]),
    el('p.small.muted', { text: 'هر سطح، مقدار ثابتی امتیاز لیگ می‌گیرد. اگر گزینهٔ بالا خاموش باشد، نمره‌ها فقط در کارنامه می‌مانند.' }),
    el('div.grid', { style: { gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', marginTop: '10px' } }, levelFields),
    el('div.grid', { style: { gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', marginTop: '10px' } }, [
      el('div.field', {}, [
        el('label', { for: 'ev-points-sample', text: 'پیش‌نمایش با نمرهٔ ۰ تا ۲۰' }),
        sample,
      ]),
      el('div.field', {}, [
        el('span.muted.small', { text: 'نتیجهٔ امتیاز' }),
        preview,
      ]),
    ]),
    el('div.row', { style: { marginTop: '10px' } }, [
      button('ذخیره تنظیمات امتیازدهی', { kind: 'soft', icon: '💾', onClick: save }),
    ]),
  ]);
}

function listRows(payload, onGrade, reload) {
  const list = el('div');
  const items = payload.items ?? [];
  if (items.length === 0) {
    return el('div', {}, [emptyState({ icon: '📝', title: 'هنوز ارزشیابی‌ای ثبت نشده است', hint: 'با فرم بالا اولین ارزشیابی را ثبت کنید.' })]);
  }
  for (const item of items) {
    const averageText = item.average === null ? '—' : fa(item.average);
    list.appendChild(el('div.timeline-item', {}, [
      el('div', { style: { flex: '1' } }, [
        el('div', {}, [
          el('strong', { text: `${item.subject} — ${item.title}` }),
          el('span.small.muted', { text: ` · ${faDate(item.heldOn)}` }),
        ]),
        el('div.row', { style: { gap: '6px', flexWrap: 'wrap', marginTop: '4px' } }, [
          item.level ? chip(`🏫 ${item.level}`, 'muted') : null,
          item.grade ? chip(`🎓 پایه ${item.grade}`, 'muted') : null,
          chip(item.kind === 'descriptive' ? '📝 توصیفی' : `⚖️ ${fa(item.scaleMin)} تا ${fa(item.scaleMax)}`),
          chip(`میانگین ${averageText}`, item.average === null ? 'muted' : 'ok'),
          chip(`ثبت‌شده ${fa(item.gradedCount)}/${fa(item.studentCount)}`, item.gradedCount === item.studentCount ? 'ok' : 'amber'),
        ]),
      ]),
      el('span.row', { style: { gap: '3px' } }, [
        iconButton('📝', { label: 'ثبت نمرات', kind: 'soft', onClick: () => onGrade(item.id) }),
        iconButton('✏️', { label: 'ویرایش ارزشیابی', onClick: () => editEvaluation(item, reload) }),
        iconButton('✕', { label: 'حذف ارزشیابی', danger: true, onClick: () => removeEvaluation(item, reload, onGrade) }),
      ]),
    ]));
  }
  return list;
}

async function editEvaluation(item, reload) {
  const values = await formDialog({
    title: 'ویرایش ارزشیابی',
    submitLabel: 'ذخیره',
    fields: [
      { name: 'subject', label: 'نام درس', type: 'text', value: item.subject, required: true },
      { name: 'title', label: 'عنوان', type: 'text', value: item.title, required: true },
      { name: 'level', label: 'مقطع', type: 'select', value: item.level, options: [{ value: '', label: 'انتخاب کنید' }, ...SCHOOL_LEVELS.map((level) => ({ value: level, label: level }))] },
      { name: 'grade', label: 'پایه', type: 'select', value: item.grade, options: [{ value: '', label: 'انتخاب کنید' }, ...GRADES.map((grade) => ({ value: grade, label: grade }))] },
      { name: 'heldOn', label: 'تاریخ (شمسی)', type: 'jalali-date', value: item.heldOn, required: true, persianDigits: state.persianDigits },
      { name: 'scaleMax', label: 'حداکثر نمره', type: 'number', value: item.scaleMax, min: 1, max: 100 },
      { name: 'note', label: 'توضیح', type: 'textarea', value: item.note ?? '' },
    ],
  });
  if (!values) return;
  try {
    await api.patch(`/leagues/${item.leagueId}/evaluations/${item.id}`, {
      subject: values.subject.trim(),
      title: values.title.trim(),
      level: values.level,
      grade: values.grade,
      heldOn: values.heldOn,
      scaleMax: Number(values.scaleMax) || item.scaleMax,
      note: values.note.trim(),
    });
    notify.ok('ارزشیابی ذخیره شد');
    reload();
  } catch (error) {
    notify.error(errorMessage(error));
  }
}

async function removeEvaluation(item, reload, onGrade) {
  const agreed = await confirmDialog({
    title: 'حذف ارزشیابی',
    message: `ارزشیابی «${item.title}» و همهٔ نمره‌های آن حذف شود؟`,
    confirmLabel: 'حذف',
    danger: true,
  });
  if (!agreed) return;
  try {
    await api.del(`/leagues/${item.leagueId}/evaluations/${item.id}`);
    notify.ok('ارزشیابی حذف شد');
    onGrade(null);
    reload();
  } catch (error) {
    notify.error(errorMessage(error));
  }
}

export async function renderEvaluations({ params }) {
  const leagueId = Number(params.id);
  setLeagueId(leagueId);
  setTopbarTitle('ارزشیابی دروس');
  const body = el('div', {}, [loadingNode()]);
  renderView([body]);

  let filters = { subject: '', from: '', to: '' };
  let payload = null;
  let detail = null;

  function query() {
    const search = new URLSearchParams();
    if (filters.subject) search.set('subject', filters.subject);
    if (filters.from) search.set('from', filters.from);
    if (filters.to) search.set('to', filters.to);
    const text = search.toString();
    return text ? `?${text}` : '';
  }

  async function openGrading(evaluationId) {
    if (!evaluationId) {
      detail = null;
      render();
      return;
    }
    try {
      detail = await api.get(`/leagues/${leagueId}/evaluations/${evaluationId}`);
      render();
    } catch (error) {
      notify.error(errorMessage(error));
    }
  }

  function filterBar() {
    const subject = el('select', { id: 'ev-filter-subject' }, [
      el('option', { value: '', text: 'همه دروس' }),
      ...optionNodes(payload.subjects ?? [], filters.subject),
    ]);
    subject.value = filters.subject;
    const from = jalaliDateInput({
      id: 'ev-filter-from',
      value: filters.from,
      allowEmpty: true,
      persianDigits: state.persianDigits,
    });
    const to = jalaliDateInput({
      id: 'ev-filter-to',
      value: filters.to,
      allowEmpty: true,
      persianDigits: state.persianDigits,
    });

    function apply(next) {
      filters = next;
      void load();
    }

    return el('div.filter-bar', {}, [
      el('div.field', {}, [el('label', { for: 'ev-filter-subject', text: 'درس' }), subject]),
      el('div.field', {}, [el('label', { for: 'ev-filter-from', text: 'از تاریخ (شمسی)' }), from]),
      el('div.field', {}, [el('label', { for: 'ev-filter-to', text: 'تا تاریخ (شمسی)' }), to]),
      el('div.field', {}, [
        el('span.muted.small', { text: 'برای بازهٔ باز، یک طرف را خالی بگذارید.' }),
        el('div.row', {}, [
          button('اعمال فیلتر', { icon: '🔎', kind: 'soft', onClick: () => apply({ subject: subject.value, from: from.value, to: to.value }) }),
          button('پاک کردن', { icon: '🧹', kind: 'ghost', onClick: () => apply({ subject: '', from: '', to: '' }) }),
        ]),
      ]),
    ]);
  }

  function render() {
    if (!payload) return;
    setLeaguePill({ name: payload.league?.name ?? '' });
    const stats = payload.stats ?? {};

    const sections = [
      pageHead({
        icon: '📝',
        title: 'ارزشیابی دروس',
        subtitle: payload.league?.name ?? '',
        actions: [
          el('a.btn.btn--ghost', { href: `#/teacher/league/${leagueId}`, text: '↩️ لیگ' }),
          backToWorkbench(),
        ],
      }),
      grid('grid--stats', [
        statCard({ label: 'میانگین', value: stats.average === null || stats.average === undefined ? '—' : fa(stats.average), icon: '📊' }),
        statCard({ label: 'دانش‌آموز', value: fa(stats.studentCount), icon: '🧑‍🎓' }),
        statCard({ label: 'درس', value: fa(stats.subjectCount), icon: '📚' }),
        statCard({ label: 'ارزشیابی', value: fa(stats.count), icon: '📝' }),
      ]),
      formCard({ leagueId, payload, onCreated: () => load() }),
      scoringCard({ leagueId, scoring: payload.scoring, reload: () => load() }),
      card({ title: `ارزشیابی‌های ثبت‌شده (${fa(payload.total ?? 0)})`, icon: '📋' }, [
        filterBar(),
        el('div', { style: { marginTop: '10px' } }, [listRows(payload, openGrading, () => load())]),
      ]),
    ];

    if (detail) {
      sections.push(gradingCard({
        leagueId,
        detail,
        onSaved: (saved) => {
          detail = saved;
          void load();
        },
        onClose: () => {
          detail = null;
          render();
        },
      }));
    }

    body.replaceChildren(...sections);
  }

  async function load() {
    body.replaceChildren(loadingNode());
    try {
      payload = await api.get(`/leagues/${leagueId}/evaluations${query()}`);
    } catch (error) {
      body.replaceChildren(emptyState({ icon: '⚠️', title: 'دریافت ارزشیابی‌ها ناموفق بود', hint: errorMessage(error) }));
      return;
    }
    render();
  }

  await load();
  return undefined;
}
