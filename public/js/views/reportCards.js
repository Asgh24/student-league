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
import { backToWorkbench, button, card as cardSection, chip, fa, faDateTime, loadingNode, pageHead } from './common.js';
import { renderPerformancePanel, REPORT_CARD_LEVELS } from './reportCardShared.js';

const LEVEL_BULK_BUTTONS = REPORT_CARD_LEVELS.map((level) => ({
  value: level.value,
  label: `${level.icon} ${level.label}`,
}));

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
      subtitle: 'درس‌های کلاس را یک بار تعریف کنید، سپس برای هر دانش‌آموز کارنامه بسازید و نمرات را وارد کنید.',
      actions: [backToWorkbench()],
    }),
    body,
  ]);

  let subjects = [];
  let students = [];
  let cards = [];
  let history = [];
  let card = null;
  let selectedStudentId = '';
  let semester = 'نوبت اول';
  let saving = false;
  let loadingCard = false;

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

  function setEditorBusy(disabled) {
    document.querySelectorAll('.report-card-editor__actions button').forEach((node) => {
      node.disabled = disabled;
    });
  }

  async function loadHistory(studentId) {
    try {
      const res = await api.get(`/leagues/${leagueId}/report-cards/students/${studentId}/history`);
      history = res.history ?? [];
    } catch (error) {
      notify.error(errorMessage(error));
      history = [];
    }
  }

  async function reloadMeta() {
    try {
      await loadMeta();
      if (selectedStudentId) {
        await loadHistory(Number(selectedStudentId));
      }
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
    if (loadingCard) return;
    loadingCard = true;
    try {
      const [res] = await Promise.all([
        api.get(`/leagues/${leagueId}/report-cards/students/${id}?semester=${encodeURIComponent(semester)}`),
        loadHistory(id),
      ]);
      if (res.card) {
        card = res.card;
      } else {
        card = null;
        notify.info('برای این دانش‌آموز کارنامه‌ای وجود ندارد؛ یک کارنامه جدید بسازید.');
      }
      loadingCard = false;
      paint();
    } catch (error) {
      notify.error(errorMessage(error));
    } finally {
      loadingCard = false;
    }
  }

  async function createNewCard() {
    const semesterInput = document.getElementById('new-card-semester');
    const clean = String(semesterInput?.value ?? semester).trim();
    if (!clean) {
      notify.error('نام نوبت / ترم را وارد کنید');
      return;
    }
    if (!selectedStudentId) {
      notify.error('ابتدا یک دانش‌آموز انتخاب کنید');
      return;
    }
    if (loadingCard || saving) return;
    loadingCard = true;
    try {
      const created = await api.post(`/leagues/${leagueId}/report-cards/students/${selectedStudentId}/new`, {
        studentId: Number(selectedStudentId),
        semester: clean,
      });
      card = created.card;
      semester = card.semester;
      await loadMeta();
      await loadHistory(Number(selectedStudentId));
      notify.ok('کارنامه جدید ساخته شد');
      loadingCard = false;
      paint();
    } catch (error) {
      notify.error(errorMessage(error));
    } finally {
      loadingCard = false;
    }
  }

  function bulkFill(levelValue) {
    if (!card || saving || loadingCard) return;
    const level = REPORT_CARD_LEVELS.find((item) => item.value === levelValue);
    if (!level) return;
    document.querySelectorAll('tr[data-subject-id]').forEach((row) => {
      const numeric = row.querySelector('.report-card-grade');
      const descriptive = row.querySelector('.report-card-level');
      if (numeric) numeric.value = '';
      if (descriptive) descriptive.value = levelValue;
    });
    notify.info(`همهٔ درس‌ها روی «${level.label}» قرار گرفتند؛ برای ثبت نهایی، «ذخیره نمرات» را بزنید.`);
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

  async function restoreCard(cardItem) {
    if (loadingCard || saving) return;
    loadingCard = true;
    try {
      const refreshed = await api.get(`/leagues/${leagueId}/report-cards/cards/${cardItem.id}`);
      card = refreshed.card;
      selectedStudentId = String(card.studentId);
      semester = card.semester;
      notify.ok(`کارنامه «${card.semester}» باز شد`);
      loadingCard = false;
      paint();
    } catch (error) {
      notify.error(errorMessage(error));
    } finally {
      loadingCard = false;
    }
  }

  async function deleteCardItem(cardItem) {
    const studentName = students.find((item) => String(item.id) === selectedStudentId)?.name ?? 'دانش‌آموز';
    const agreed = await confirmDialog({
      title: 'حذف کارنامه',
      message: `آیا از حذف کارنامه «${studentName}» برای نوبت «${cardItem.semester}» اطمینان دارید؟`,
      confirmLabel: 'حذف',
      danger: true,
    });
    if (!agreed) return;
    try {
      await api.del(`/leagues/${leagueId}/report-cards/cards/${cardItem.id}`);
      notify.ok('کارنامه حذف شد');
      if (card && card.id === cardItem.id) {
        card = null;
      }
      await reloadMeta();
    } catch (error) {
      notify.error(errorMessage(error));
    }
  }

  async function saveCard() {
    if (!card || saving || loadingCard) return;
    const payload = readEditor();
    saving = true;
    setEditorBusy(true);
    try {
      const res = await api.put(`/leagues/${leagueId}/report-cards/cards/${card.id}`, payload);
      card = res.card;
      notify.ok('کارنامه ذخیره شد');
      await loadMeta();
      await loadHistory(Number(selectedStudentId));
    } catch (error) {
      notify.error(errorMessage(error));
    } finally {
      saving = false;
      paint();
    }
  }

  async function togglePublish() {
    if (!card || saving || loadingCard) return;
    const payload = { ...readEditor(), isPublished: !card.isPublished };
    saving = true;
    setEditorBusy(true);
    try {
      const res = await api.put(`/leagues/${leagueId}/report-cards/cards/${card.id}`, payload);
      card = res.card;
      notify.ok(card.isPublished ? 'کارنامه برای دانش‌آموز منتشر شد' : 'انتشار کارنامه لغو شد');
      await loadMeta();
      await loadHistory(Number(selectedStudentId));
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

  function historyPanel() {
    if (!selectedStudentId || history.length === 0) {
      return null;
    }
    const published = history.filter((c) => c.isPublished).length;
    return el('div.report-card-history', {}, [
      el('h3', { text: `سابقه کارنامه‌های «${students.find((s) => String(s.id) === selectedStudentId)?.name ?? ''}»` }),
      published > 0
        ? el('div.muted.small', { text: `از ${published} کارنامه منتشرشده` })
        : null,
      el('div.report-card-history-list', {}, [
        history.map((item) => {
          const isActive = card && card.id === item.id;
          return el(`div.report-card-history-item${isActive ? '.active' : ''}`, {
            role: 'button',
            tabindex: '0',
            'aria-label': `باز کردن کارنامه ${item.semester}`,
            onClick: () => restoreCard(item),
            onkeydown: (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                restoreCard(item);
              }
            },
          }, [
            el('div.report-card-history-item__main', {}, [
              el('strong', { text: item.semester }),
            ]),
            el('div.report-card-history-item__meta', {}, [
              el('span.small.muted', {
                text: `${item.gradedCount} از ${subjects.length} درس نمره‌دار · ${fa(item.totalPercent)}٪ · ویرایش ${faDateTime(item.updatedAt)}`,
              }),
              el('span.spacer'),
              chip(item.isPublished ? 'منتشر‌شده' : 'پیش‌نویس', item.isPublished ? 'ok' : 'muted'),
              button('🗑', {
                kind: 'ghost',
                title: `حذف کارنامه ${item.semester}`,
                onClick: (e) => {
                  e.stopPropagation();
                  deleteCardItem(item);
                },
              }),
            ]),
          ]);
        }),
      ]),
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

  function bulkFillPanel() {
    if (!card) return null;
    return el('div.report-card-bulk', {}, [
      el('h3', { text: 'پرکردن سریع همه‌ی درس‌ها' }, []),
      el('p.muted.small', { text: 'با انتخاب یک سطح، همه‌ی ردیف‌های درس همین کارنامه با همان سطح توصیفی پر می‌شوند.' }, []),
      el('div.report-card-bulk-buttons', {}, [
        ...LEVEL_BULK_BUTTONS.map((lvl) => button(lvl.label, {
          kind: 'ghost',
          onClick: () => bulkFill(lvl.value),
        })),
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
        history = [];
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
      id: 'new-card-semester',
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
        el('div.field', {}, [el('label', { for: 'new-card-semester', text: 'نوبت / ترم' }), semesterInput]),
        button('باز کردن کارنامه', { kind: 'ghost', onClick: () => openCard() }),
        button('کارنامه جدید', { kind: 'primary', onClick: createNewCard }),
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
          ]),
          bulkFillPanel(),
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
        : selectedStudentId
          ? emptyState({
              icon: '👤',
              title: 'هنوز کارنامه‌ای ثبت نشده',
              hint: `برای «${students.find((s) => String(s.id) === selectedStudentId)?.name ?? ''}» کارنامه‌ای وجود ندارد. با دکمه‌ی «کارنامه جدید» یک پیش‌نویس بسازید یا از لیست سمت راست یک نسخه‌ی ذخیره‌شده را باز کنید.`,
            })
          : emptyState({
              icon: '👤',
              title: 'یک دانش‌آموز را انتخاب کنید',
              hint: 'با انتخاب دانش‌آموز، کارنامه‌های ذخیره‌شده‌ی او نمایش داده می‌شوند یا می‌توانید یک کارنامه جدید بسازید.',
            }),
    ]);
  }

  function paint() {
    const published = cards.filter((item) => item.isPublished).length;
    const sections = [
      el('div.grid.grid--stats', {}, [
        statCard({ label: 'درس‌های تعریف‌شده', value: fa(subjects.length), icon: '📚' }),
        statCard({ label: 'دانش‌آموزان کلاس', value: fa(students.length), icon: '👨‍🎓' }),
        statCard({ label: 'کارنامه‌ها', value: fa(cards.length), icon: '📄' }),
        statCard({ label: 'منتشرشده', value: fa(published), icon: '✅' }),
      ]),
      subjectCard(),
      historyPanel(),
      builderCard(),
      card ? el('h2.report-card-section-title', { text: 'عملکرد دانش‌آموز' }) : null,
      card ? renderPerformancePanel(card.performance) : null,
    ].filter(Boolean);
    body.replaceChildren(...sections);
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
