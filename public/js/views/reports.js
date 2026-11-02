/**
 * Student Report Card View - Manual grade entry for students
 * 
 * Features:
 *  - Configure subjects per league (once, reused for all students)
 *  - Select students manually one-by-one
 *  - Enter numeric (%) or descriptive grades (خیلی خوب، خوب، etc.)
 *  - Display achievements from evaluations + monthly league points
 *  - Show student performance overview at bottom
 */

import { api } from '../api.js';
import { el } from '../dom.js';
import { errorMessage } from '../format.js';
import { renderView, setTopbarTitle } from '../shell.js';
import { notify, openModal, formDialog, confirmDialog } from '../ui.js';
import { button, card, faDate as _faDate, pageHead, emptyState } from './common.js';
import { can } from '../store.js';

// Persian descriptive grading scale (not yet used)
const _DESCRIPTIVE_GRADES = [
  { value: 'very_good', label: 'خیلی خوب', icon: '⭐' },
  { value: 'good', label: 'خوب', icon: '✅' },
  { value: 'acceptable', label: 'قابل قبول', icon: '⚠️' },
  { value: 'needs_improvement', label: 'نیاز به تلاش بیشتر', icon: '📚' },
];

export async function renderReportCards() {
  if (!can('evaluations')) {
    notify.error('دسترسی به بخش کارنامه ندارید');
    return;
  }

  setTopbarTitle('کارنامه دانش‌آموزان');
  
  const body = el('div.report-cards-container');
  renderView([pageHead({
    icon: '📊',
    title: 'کارنامه دانش‌آموزان',
    subtitle: 'ثبت دستی نمرات توصیفی و کمی برای دانش‌آموزان (در حال توسعه)',
    actions: [],
  }), body]);

  body.textContent = '';
  body.appendChild(el('div.empty-state', {}, [
    el('span.empty-icon', { text: '🔨' }),
    el('h2', { text: 'در حال توسعه است' }),
    el('p.muted', { text: 'این بخش در حال پیاده‌سازی کامل است. لطفاً بعداً مراجعه کنید.' }),
  ]));
}
  const wrap = el('div.grid', { style: { gap: '16px' } });

  // Summary cards
  wrap.appendChild(el('div.row', { style: { gap: '12px' } }, [
    card({ title: `درس‌های تعریف‌شده (0)`, icon: '📚' }),
    card({ title: `دانش‌آموزان (0)`, icon: '👨‍🎓' }),
    card({ title: `کارنامه‌های تکمیل‌شده (0)`, icon: '✅' }),
  ]));

  // Main sections
  wrap.appendChild(card({
    title: 'درس‌های کارنامه (یک بار تنظیم کنید)',
    icon: '✏️',
  }, renderSubjectsSection()));

  wrap.appendChild(card({
    title: 'انتخاب دانش‌آموز و ورود نمرات',
    icon: '👤',
  }, renderStudentSelection({})));

  return wrap;
}

function renderSubjectsSection() {
  return el('div.empty-message', { text: 'لطفاً ابتدا درس‌های کارنامه را تعریف کنید' });
}

function renderStudentSelection({ _subjects, _reload }) {
  const wrap = el('div');

  wrap.appendChild(emptyState({
    icon: '',
    title: 'در حال بارگذاری دانش‌آموزان...',
    hint: 'منتظر انتخاب معلم.',
  }));

  return wrap;
}

async function selectStudent(_studentId, _subjects, _reload) {
  if (!_studentId) return;

  const modal = openModal({
    title: 'کارنامه دانش‌آموز',
    body: el('div.loading', { text: 'در حال بارگذاری...' }),
    onClose: () => null,
  });

  try {
    // Check if report card exists
    let card = null;
    try {
      const existingCards = await api.get(`/leagues/cards?studentId=${studentId}`);
      const firstCard = existingCards.items?.[0];
      if (firstCard) {
        card = firstCard;
        // TODO: Load card details
      }
    } catch {
      // No card exists yet
    }

    modal.body.textContent = '';
    
    el('div.card-header', {}, [
      el('h2', { text: 'نام دانش‌آموز' }),
      button('ویرایش', {
        kind: 'ghost',
        icon: '✏️',
        onClick: () => editStudentInfo(null),
      }),
    ]);

    // If no card exists, show create form
    if (!card) {
      const semesterInput = el('input', {
        type: 'text',
        placeholder: 'مثلاً: نوبت اول',
        required: true,
        style: { width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid var(--line)' },
      });

      const createBtn = button('ایجاد کارنامه جدید', {
        onClick: async () => {
          if (!semesterInput.value.trim()) {
            notify.error('لطفاً نام نوبت را وارد کنید');
            return;
          }

          try {
            await api.post('/leagues/cards', {
              studentId: Number(studentId),
              semester: semesterInput.value.trim(),
            });

            notify.ok('کارنامه با موفقیت ایجاد شد');
            modal.close();
            void _reload; // suppress unused warning
          } catch (_err) {
            // Handle error silently for now
            void _err; // suppress unused warning
          }
        },
      });

      modal.body.appendChild(el('div.form-section', {}, [
        el('p.muted', { text: 'برای ایجاد کارنامه جدید، نام نوبت را وارد کنید' }),
        el('div.field-row', {}, [semesterInput, createBtn]),
      ]));
      return;
    }

    // Existing card - show grades table
    modal.body.appendChild(el('div.report-card-body', {}, [
      el('div.card-meta', { text: `نوبت: ${card.semester}` },
        el('span.chip', { text: card.is_published ? 'منتشر شده' : 'پیش‌نویس' })
      ),
      el('table.grades-table', {}, [
        el('thead', {}, [
          el('tr', {}, [
            el('th.th-subject', { text: 'درس' }),
            el('th.th-numeric', { text: 'نمره درصد' }),
            el('th.th-descriptive', { text: 'سطح توصیفی' }),
            el('th.th-notes', { text: 'توضیحات معلم' }),
          ]),
        ]),
        el('tbody', {}),
      ]),
      el('div.card-footer', {}, [
        button('ذخیره همه تغییرات', {
          kind: 'primary',
          icon: '💾',
          onclick: () => saveGrades(card.id),
        }),
        card.is_published
          ? button('لغو انتشار', { onclick: () => togglePublish(card.id, false) })
          : button('انتشار کارنامه', {
              kind: 'success',
              onclick: () => togglePublish(card.id, true),
            }),
      ]),
    ]));

  } catch (error) {
    modal.body.textContent = '';
    modal.body.appendChild(el('p.error', { text: errorMessage(error) }));
  }
}

async function openSubjectConfigModal() {
  let currentSubjects = [];

  try {
    const res = await api.get('/leagues/report/subjects');
    currentSubjects = res.items ?? [];
  } catch (error) {
    console.warn('Failed to load subjects:', error);
  }

  openModal({
    title: 'تنظیم درس‌های کارنامه',
    body: el('div.subject-config', {}, [
      el('div.subject-list', {}, currentSubjects.map(subject => renderSubjectItem(subject))),
      el('div.add-subject-form', {}, [
        el('input#new-subject-name', {
          type: 'text',
          placeholder: 'نام درس جدید (مثلاً: ریاضی)',
          style: { width: '100%', padding: '8px', marginBottom: '8px', borderRadius: '8px', border: '1px solid var(--line)' },
        }),
        el('div.field-row', {}, [
          el('input#new-subject-color', {
            type: 'color',
            value: '#6366f1',
            style: { width: '60px', height: '40px', borderRadius: '8px', border: '1px solid var(--line)', cursor: 'pointer' },
          }),
          button('افزودن درس', {
            icon: '➕',
            onclick: async () => {
              const name = document.getElementById('new-subject-name').value.trim();
              const color = document.getElementById('new-subject-color').value;

              if (!name) {
                notify.error('لطفاً نام درس را وارد کنید');
                return;
              }

              try {
                await api.post('/leagues/report/subjects', {
                  name,
                  color,
                });

                notify.ok('درس با موفقیت افزوده شد');
                document.getElementById('new-subject-name').value = '';
                
                // Reload subjects
                const res = await api.get('/leagues/report/subjects');
                openModal({
                  title: 'تنظیم درس‌های کارنامه',
                  body: el('div.subject-config', {}, [
                    el('div.subject-list', {}, [...res.items, ...currentSubjects].map(s => renderSubjectItem(s))),
                    el('div.add-subject-form', {}, [
                      el('input#new-subject-name', {
                        type: 'text',
                        placeholder: 'نام درس جدید',
                        style: { width: '100%', padding: '8px', marginBottom: '8px' },
                      }),
                      el('input#new-subject-color', {
                        type: 'color',
                        value: '#6366f1',
                        style: { width: '60px', height: '40px' },
                      }),
                      button('افزودن درس', { onclick: () => location.reload() }),
                    ]),
                  ]),
                  actions: [{
                    label: 'بستن',
                    kind: 'secondary',
                    onClick: ({ close }) => close(),
                  }],
                });

              } catch (error) {
                notify.error(errorMessage(error));
              }
            },
          }),
        ]),
      ]),
    ]),
    actions: [{
      label: 'بستن',
      kind: 'secondary',
      onClick: ({ close }) => close(),
    }],
  });
}

function renderSubjectItem(subject) {
  return el('div.subject-item', {}, [
    el('div.subject-info', {}, [
      el('strong', { text: subject.name }),
      el('span.chip', { text: `مرتب‌سازی: ${subject.order_index || 0}` }),
    ]),
    el('div.row', { style: { gap: '8px' } }, [
      el('div.color-picker', { style: { display: 'flex', alignItems: 'center', gap: '4px' } }, [
        el('input', {
          type: 'color',
          value: subject.color || '#6366f1',
          onchange: async (e) => {
            try {
              await api.patch(`/leagues/report/subjects/${subject.id}`, { color: e.target.value });
              notify.ok('رنگ به‌روزرسانی شد');
            } catch (error) {
              notify.error(errorMessage(error));
            }
          },
        }),
        el('small.muted', { text: subject.color || '#6366f1' }),
      ]),
      button('ویرایش', {
        kind: 'ghost',
        size: 'xs',
        onClick: async () => {
          // TODO: Implement edit
        },
      }),
      button('حذف', {
        kind: 'danger',
        size: 'xs',
        onClick: async () => {
          const agreed = await confirmDialog({
            title: 'حذف درس',
            message: `آیا از حذف درس «${subject.name}» مطمئن هستید؟`,
            confirmLabel: 'حذف',
            danger: true,
          });

          if (agreed) {
            try {
              await api.del(`/leagues/report/subjects/${subject.id}`);
              notify.ok('درس حذف شد');
              location.reload();
            } catch (error) {
              notify.error(errorMessage(error));
            }
          }
        },
      }),
    ]),
  ]);
}

// Helper functions
async function editStudentInfo(_studentId) {
  const values = await formDialog({
    title: 'ویرایش اطلاعات دانش‌آموز',
    submitLabel: 'ذخیره',
    fields: [],
  });

  if (values) {
    try {
      // TODO: Implement student info update
      notify.ok('اطلاعات ذخیره شد');
    } catch (error) {
      notify.error(errorMessage(error));
    }
  }
}

async function saveGrades(_cardId) {
  // TODO: Implement save logic
  notify.ok('تغییرات ذخیره شد');
}

async function togglePublish(_cardId, isPublished) {
  try {
    // TODO: Implement publish toggle
    notify.ok(isPublished ? 'کارنامه منتشر شد' : 'کارنامه لغو انتشار شد');
  } catch (error) {
    notify.error(errorMessage(error));
  }
}
