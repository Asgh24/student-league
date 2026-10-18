/**
 * Course evaluations (teacher): create form, headline stats, filters, the list of
 * recorded evaluations and the mark sheet of the selected one.
 */

import { api } from '../api.js';
import { el } from '../dom.js';
import { errorMessage } from '../format.js';
import { todayIso } from '../jalali.js';
import { EVALUATION_KINDS, GRADES, gradesForLevel, SCHOOL_LEVELS } from '../evaluationMeta.js';
import { renderView, setLeaguePill, setTopbarTitle } from '../shell.js';
import { setLeagueId, state } from '../store.js';
import { confirmDialog, emptyState, formDialog, notify } from '../ui.js';
import { button, card, chip, fa, faDate, grid, iconButton, loadingNode, pageHead, statCard } from './common.js';
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
  const dateInput = el('input', { id: 'ev-date', type: 'date', value: today() });
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
    linkHint.textContent = column
      ? `🔗 به ستون «${column.name}» لیگ ارجاع داده می‌شود (فقط ارجاع، بدون انتقال خودکار امتیاز).`
      : 'نمره‌ها فقط در کارنامهٔ ارزشیابی ثبت می‌شوند؛ بدون انتقال خودکار امتیاز به لیگ.';
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
      el('div.field', {}, [el('label', { for: 'ev-date', text: 'تاریخ (میلادی)' }), dateInput]),
      el('div.field', {}, [el('label', { for: 'ev-kind', text: 'نوع' }), kindInput]),
      el('div.field', {}, [el('label', { for: 'ev-max', text: 'حداکثر نمره' }), maxInput]),
    ]),
    el('div.field', {}, [el('label', { for: 'ev-note', text: 'توضیح (اختیاری)' }), noteInput]),
    el('p', {}, [linkHint]),
    el('div.row', {}, [button('ثبت ارزشیابی', { kind: 'soft', icon: '💾', onClick: submit })]),
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
      { name: 'heldOn', label: 'تاریخ (میلادی)', type: 'date', value: item.heldOn, required: true },
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
    const from = el('input', { id: 'ev-filter-from', type: 'date', value: filters.from });
    const to = el('input', { id: 'ev-filter-to', type: 'date', value: filters.to });

    function apply(next) {
      filters = next;
      void load();
    }

    return el('div.filter-bar', {}, [
      el('div.field', {}, [el('label', { for: 'ev-filter-subject', text: 'درس' }), subject]),
      el('div.field', {}, [el('label', { for: 'ev-filter-from', text: 'از تاریخ' }), from]),
      el('div.field', {}, [el('label', { for: 'ev-filter-to', text: 'تا تاریخ' }), to]),
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
        ],
      }),
      grid('grid--stats', [
        statCard({ label: 'میانگین', value: stats.average === null || stats.average === undefined ? '—' : fa(stats.average), icon: '📊' }),
        statCard({ label: 'دانش‌آموز', value: fa(stats.studentCount), icon: '🧑‍🎓' }),
        statCard({ label: 'درس', value: fa(stats.subjectCount), icon: '📚' }),
        statCard({ label: 'ارزشیابی', value: fa(stats.count), icon: '📝' }),
      ]),
      formCard({ leagueId, payload, onCreated: () => load() }),
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
