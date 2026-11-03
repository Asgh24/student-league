/**
 * Teacher «کارنامه دانش‌آموزان»: define the class subjects, pick a student,
 * enter numeric or descriptive marks one by one and see the evaluation
 * achievements / league performance on the same page.
 */

import { api } from '../api.js';
import { el } from '../dom.js';
import { errorMessage } from '../format.js';
import { renderView, setLeaguePill, setTopbarTitle } from '../shell.js';
import { setLeagueId } from '../store.js';
import { confirmDialog, emptyState, formDialog, notify, statCard } from '../ui.js';
import { backToWorkbench, button, card as cardSection, chip, fa, loadingNode, pageHead } from './common.js';
import { renderPerformancePanel, REPORT_CARD_LEVELS } from './reportCardShared.js';

function numericInput(value, onInput) {
  return el('input.report-card-grade', {
    type: 'number',
    min: '0',
    max: '100',
    step: '0.25',
    value: value === null || value === undefined ? '' : String(value),
    placeholder: '۰ تا ۱۰۰',
    'aria-label': 'نمره کمی',
    oninput: onInput,
  });
}

function levelSelect(value, onInput) {
  const select = el('select.report-card-level', { 'aria-label': 'سطح توصیفی', onchange: onInput }, [
    el('option', { value: '', text: '—' }),
    ...REPORT_CARD_LEVELS.map((level) => el('option', {
      value: level.value,
      text: `${level.icon} ${level.label}`,
      selected: level.value === value,
    })),
  ]);
  return select;
}

export async function renderReportCards({ params }) {
  const leagueId = Number(params?.id);
  if (!Number.isFinite(leagueId)) return;

  setTopbarTitle('کارنامه دانش‌آموزان');
  setLeagueId(leagueId);

  const body = el('div.report-card-page', {}, [loadingNode()]);
  renderView([
    pageHead({
      icon: '📊',
      title: 'کارنامه دانش‌آموزان',
      subtitle: 'درس‌های کلاس را یک بار تعریف کنید، سپس نمره هر دانش‌آموز را جداگانه ثبت کنید.',
      actions: [backToWorkbench()],
    }),
    body,
  ]);

  let subjects = [];
  let students = [];
  let cards = [];
  let card = null;
  let selectedStudentId = '';
  let semester = 'نوبت اول';
  let saving = false;

  async function loadMeta() {
    const [subjectsRes, studentsRes, cardsRes, leagueRes] = await Promise.all([
      api.get(`/leagues/${leagueId}/report-cards/subjects`),
      api.get(`/leagues/${leagueId}/students`),
      api.get(`/leagues/${leagueId}/report-cards`),
      api.get(`/leagues/${leagueId}`),
    ]);
    subjects = subjectsRes.items ?? [];
    students = studentsRes.items ?? [];
    cards = cardsRes.items ?? [];
    setLeaguePill({ name: leagueRes.league?.name ?? '' });
  }

  async function reloadMeta() {
    try {
      await loadMeta();
      paint();
    } catch (error) {
      notify.error(errorMessage(error));
    }
  }

  async function openCard(studentId = selectedStudentId) {
    const id = Number(studentId);
    if (!Number.isFinite(id) || id <= 0) {
      notify.error('ابتدا یک دانش‌آموز انتخاب کنید');
      return;
    }
    selectedStudentId = String(id);
    try {
      const res = await api.get(`/leagues/${leagueId}/report-cards/students/${id}?semester=${encodeURIComponent(semester)}`);
      if (res.card) {
        card = res.card;
      } else if (subjects.length === 0) {
        card = null;
        notify.error('ابتدا درس‌های کارنامه این کلاس را تعریف کنید');
      } else {
        const created = await api.post(`/leagues/${leagueId}/report-cards/students/${id}`, {
          studentId: id,
          semester,
        });
        card = created.card;
        cards = [card, ...cards];
        notify.ok('کارنامه جدید ساخته شد');
      }
      paint();
    } catch (error) {
      notify.error(errorMessage(error));
    }
  }

  async function addSubject() {
    const nameInput = document.getElementById('new-subject-name');
    const colorInput = document.getElementById('new-subject-color');
    const name = nameInput?.value.trim() ?? '';
    if (!name) {
      notify.error('نام درس را وارد کنید');
      return;
    }
    try {
      await api.post(`/leagues/${leagueId}/report-cards/subjects`, {
        name,
        color: colorInput?.value || '#6366f1',
      });
      notify.ok('درس اضافه شد');
      await reloadMeta();
    } catch (error) {
      notify.error(errorMessage(error));
    }
  }

  async function editSubject(subject) {
    const values = await formDialog({
      title: 'ویرایش درس',
      submitLabel: 'ذخیره',
      fields: [
        { name: 'name', label: 'نام درس', value: subject.name, required: true },
        { name: 'color', label: 'رنگ', type: 'color', value: subject.color || '#6366f1' },
      ],
    });
    if (!values) return;
    try {
      await api.patch(`/leagues/${leagueId}/report-cards/subjects/${subject.id}`, {
        name: values.name,
        color: values.color,
      });
      notify.ok('درس ویرایش شد');
      await reloadMeta();
    } catch (error) {
      notify.error(errorMessage(error));
    }
  }

  async function removeSubject(subject) {
    const agreed = await confirmDialog({
      title: 'حذف درس',
      message: `درس «${subject.name}» از فهرست کارنامه حذف شود؟`,
      confirmLabel: 'حذف',
      danger: true,
    });
    if (!agreed) return;
    try {
      await api.del(`/leagues/${leagueId}/report-cards/subjects/${subject.id}`);
      notify.ok('درس حذف شد');
      if (card) {
        const refreshed = await api.get(`/leagues/${leagueId}/report-cards/cards/${card.id}`);
        card = refreshed.card;
      }
      await reloadMeta();
    } catch (error) {
      notify.error(errorMessage(error));
    }
  }

  /** Reads the visible editor without repainting, so typed marks are never lost. */
  function readEditor() {
    return {
      semester,
      notes: document.querySelector('#report-card-notes')?.value ?? '',
      grades: [...document.querySelectorAll('tr[data-subject-id]')].map((row) => ({
        subjectId: Number(row.dataset.subjectId),
        numeric: row.querySelector('.report-card-grade')?.value ?? '',
        descriptive: row.querySelector('.report-card-level')?.value ?? '',
        notes: row.querySelector('.report-card-notes')?.value ?? '',
      })),
    };
  }

  async function saveCard() {
    if (!card || saving) return;
    // Read the form *before* any repaint; a repaint rebuilds the inputs from the
    // last saved card and would silently discard what the teacher just typed.
    const payload = readEditor();
    saving = true;
    try {
      const res = await api.put(`/leagues/${leagueId}/report-cards/cards/${card.id}`, payload);
      card = res.card;
      notify.ok('کارنامه ذخیره شد');
      await loadMeta();
    } catch (error) {
      notify.error(errorMessage(error));
    } finally {
      saving = false;
      paint();
    }
  }

  async function togglePublish() {
    if (!card || saving) return;
    // Publishing also saves the visible marks, so a teacher can fill the card and
    // publish it in one step without losing the last entries.
    const payload = { ...readEditor(), isPublished: !card.isPublished };
    saving = true;
    try {
      const res = await api.put(`/leagues/${leagueId}/report-cards/cards/${card.id}`, payload);
      card = res.card;
      notify.ok(card.isPublished ? 'کارنامه برای دانش‌آموز منتشر شد' : 'انتشار کارنامه لغو شد');
      await loadMeta();
    } catch (error) {
      notify.error(errorMessage(error));
    } finally {
      saving = false;
      paint();
    }
  }

  async function removeCard() {
    if (!card) return;
    const agreed = await confirmDialog({
      title: 'حذف کارنامه',
      message: `کارنامه «${card.studentName}» برای ${card.semester} حذف شود؟`,
      confirmLabel: 'حذف',
      danger: true,
    });
    if (!agreed) return;
    try {
      await api.del(`/leagues/${leagueId}/report-cards/cards/${card.id}`);
      card = null;
      notify.ok('کارنامه حذف شد');
      await reloadMeta();
    } catch (error) {
      notify.error(errorMessage(error));
    }
  }

  function subjectCard() {
    const nameInput = el('input', {
      id: 'new-subject-name',
      type: 'text',
      placeholder: 'نام درس جدید، مثلاً ریاضی',
      'aria-label': 'نام درس جدید',
    });
    const colorInput = el('input', {
      id: 'new-subject-color',
      type: 'color',
      value: '#6366f1',
      'aria-label': 'رنگ درس',
    });
    return cardSection({ title: 'درس‌های کارنامه این کلاس', icon: '📚' }, [
      subjects.length
        ? el('div.report-card-subjects', {}, subjects.map((subject) => el('div.report-card-subject', {}, [
          el('span.report-card-subject__dot', { style: { background: subject.color || '#6366f1' } }),
          el('strong', { text: subject.name }),
          el('span.spacer'),
          button('ویرایش', { kind: 'ghost', onClick: () => editSubject(subject) }),
          button('حذف', { kind: 'danger', onClick: () => removeSubject(subject) }),
        ])))
        : emptyState({
          icon: '📚',
          title: 'هنوز درسی تعریف نشده',
          hint: 'اول درس‌های مشترک کلاس را اینجا اضافه کنید؛ بعد کارنامه هر دانش‌آموز ساخته می‌شود.',
        }),
      el('div.row.report-card-add-subject', {}, [nameInput, colorInput, button('افزودن درس', { kind: 'primary', onClick: addSubject })]),
    ]);
  }

  function gradesTable() {
    if (!card) return null;
    const bySubject = new Map((card.grades ?? []).map((grade) => [grade.subjectId, grade]));
    const rows = subjects.map((subject) => {
      const grade = bySubject.get(subject.id) ?? {
        numeric: null,
        descriptive: null,
        notes: '',
      };
      return el('tr', { 'data-subject-id': String(subject.id) }, [
        el('td', {}, [
          el('span.report-card-subject__dot', { style: { background: subject.color || '#6366f1' } }),
          el('strong', { text: subject.name }),
        ]),
        el('td', {}, [numericInput(grade.numeric)]),
        el('td', {}, [levelSelect(grade.descriptive)]),
        el('td', {}, [
          el('input.report-card-notes', {
            type: 'text',
            value: grade.notes ?? '',
            placeholder: 'توضیح اختیاری',
            'aria-label': `توضیح ${subject.name}`,
          }),
        ]),
      ]);
    });

    return el('div.table-wrap', {}, [
      el('table.grid-table.report-card-grades', {}, [
        el('thead', {}, [
          el('tr', {}, [
            el('th', { text: 'درس' }),
            el('th', { text: 'نمره کمی (۰ تا ۱۰۰)' }),
            el('th', { text: 'سطح توصیفی' }),
            el('th', { text: 'توضیح معلم' }),
          ]),
        ]),
        el('tbody', {}, rows),
      ]),
    ]);
  }

  function builderCard() {
    const studentSelect = el('select', {
      id: 'report-card-student',
      'aria-label': 'انتخاب دانش‌آموز',
      onchange: (event) => {
        selectedStudentId = event.target.value;
        card = null;
        if (selectedStudentId) void openCard(selectedStudentId);
        else paint();
      },
    }, [
      el('option', { value: '', text: 'انتخاب دانش‌آموز…' }),
      ...students.map((student) => el('option', {
        value: String(student.id),
        text: student.name,
        selected: String(student.id) === String(selectedStudentId),
      })),
    ]);
    const semesterInput = el('input', {
      id: 'report-card-semester',
      type: 'text',
      value: semester,
      placeholder: 'مثلاً نوبت اول',
      oninput: (event) => { semester = event.target.value; },
    });
    const notes = card ? el('textarea#report-card-notes', { placeholder: 'توضیح کلی کارنامه (اختیاری)' }, []) : null;
    if (notes) notes.value = card.notes ?? '';

    return cardSection({ title: 'ثبت نمره دانش‌آموز', icon: '✍️' }, [
      el('div.row.report-card-picker', {}, [
        el('div.field', {}, [el('label', { for: 'report-card-student', text: 'دانش‌آموز' }), studentSelect]),
        el('div.field', {}, [el('label', { for: 'report-card-semester', text: 'نوبت / ترم' }), semesterInput]),
        button('باز کردن کارنامه', { kind: 'ghost', onClick: () => openCard() }),
      ]),
      card
        ? el('div.report-card-editor', {}, [
          el('div.row.report-card-editor__head', {}, [
            el('div', {}, [
              el('strong', { text: card.studentName }),
              el('span.small.muted', { text: ` · ${card.semester}` }),
            ]),
            chip(card.isPublished ? 'منتشر شده' : 'پیش‌نویس', card.isPublished ? 'ok' : 'muted'),
            el('span.spacer'),
            card.level ? chip(`${card.level.icon} ${card.level.label} · ${fa(card.totalPercent)}٪`, 'muted') : null,
          ]),
          gradesTable(),
          notes,
          el('div.row.report-card-editor__actions', {}, [
            button(saving ? 'در حال ذخیره…' : 'ذخیره نمرات', {
              kind: 'primary',
              disabled: saving,
              onClick: saveCard,
            }),
            button(card.isPublished ? 'لغو انتشار' : 'انتشار برای دانش‌آموز', {
              kind: card.isPublished ? 'ghost' : 'success',
              disabled: saving,
              onClick: togglePublish,
            }),
            el('span.spacer'),
            button('حذف کارنامه', { kind: 'danger', disabled: saving, onClick: removeCard }),
          ]),
        ])
        : emptyState({
          icon: '👤',
          title: 'یک دانش‌آموز را انتخاب کنید',
          hint: 'با انتخاب دانش‌آموز، کارنامه همان نوبت باز می‌شود یا به‌صورت خودکار ساخته می‌شود.',
        }),
    ]);
  }

  function paint() {
    const published = cards.filter((item) => item.isPublished).length;
    body.replaceChildren(
      el('div.grid.grid--stats', {}, [
        statCard({ label: 'درس‌های تعریف‌شده', value: fa(subjects.length), icon: '📚' }),
        statCard({ label: 'دانش‌آموزان کلاس', value: fa(students.length), icon: '👨‍🎓' }),
        statCard({ label: 'کارنامه‌ها', value: fa(cards.length), icon: '📄' }),
        statCard({ label: 'منتشرشده', value: fa(published), icon: '✅' }),
      ]),
      subjectCard(),
      builderCard(),
      card ? el('h2.report-card-section-title', { text: 'عملکرد دانش‌آموز' }) : null,
      card ? renderPerformancePanel(card.performance) : null,
    );
  }

  try {
    await loadMeta();
    paint();
  } catch (error) {
    body.replaceChildren(emptyState({
      icon: '⚠️',
      title: 'بارگذاری کارنامه‌ها ناموفق بود',
      hint: errorMessage(error),
    }));
  }
}
