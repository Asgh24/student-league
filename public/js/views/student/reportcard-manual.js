/**
 * Student «کارنامه دستی»: the published manual report cards the teacher wrote,
 * with grades plus the same performance panel the teacher sees.
 */

import { api } from '../../api.js';
import { el } from '../../dom.js';
import { errorMessage } from '../../format.js';
import { renderView, setTopbarTitle } from '../../shell.js';
import { emptyState, openModal, statCard } from '../../ui.js';
import { card, chip, fa, faDate, loadingNode, pageHead } from '../common.js';
import { renderPerformancePanel, levelLabel } from '../reportCardShared.js';
import { studentTabs } from './tabs.js';

function gradeCell(grade) {
  if (grade.numeric !== null && grade.numeric !== undefined) return `${fa(grade.numeric)}٪`;
  if (grade.descriptive) return levelLabel(grade.descriptive) || grade.descriptive;
  return '—';
}

function gradesTable(grades) {
  if (!grades?.length) {
    return emptyState({ icon: '📝', title: 'هنوز نمره‌ای ثبت نشده است' });
  }
  return el('div.table-wrap.student-manual-grades-wrap', {}, [
    el('table.grid-table.report-card-grades.student-manual-grades', {}, [
      el('thead', {}, [
        el('tr', {}, [
          el('th', { text: 'درس' }),
          el('th', { text: 'نمره' }),
          el('th', { text: 'سطح توصیفی' }),
          el('th', { text: 'توضیح معلم' }),
        ]),
      ]),
      el('tbody', {}, grades.map((grade) => el('tr', {}, [
        el('td', { 'data-label': 'درس' }, [
          el('span.report-card-subject__dot', { style: { background: grade.color || '#6366f1' } }),
          el('strong', { text: grade.subjectName }),
        ]),
        el('td', { 'data-label': 'نمره', text: gradeCell(grade) }),
        el('td', {
          'data-label': 'سطح توصیفی',
          text: grade.descriptive ? `${grade.level?.icon ?? ''} ${grade.level?.label ?? levelLabel(grade.descriptive)}` : '—',
        }),
        el('td', { 'data-label': 'توضیح معلم', text: grade.notes || '—' }),
      ]))),
    ]),
  ]);
}

function cardHeader(cardData) {
  return el('div.row.report-card-editor__head', {}, [
    el('div', {}, [
      el('strong', { text: cardData.semester }),
      el('span.small.muted', { text: ` · ${cardData.studentName}` }),
    ]),
    el('span.spacer'),
    cardData.totalPercent !== null && cardData.totalPercent !== undefined
      ? chip(`میانگین ${fa(cardData.totalPercent)}٪`, 'muted')
      : null,
  ]);
}

async function openDetails(cardId) {
  const modal = openModal({ title: 'جزئیات کارنامه', body: loadingNode() });
  try {
    const res = await api.get(`/student/report-cards/${cardId}`);
    const detail = res.card;
    const nodes = [
      cardHeader(detail),
      gradesTable(detail.grades),
      detail.notes ? el('p.small.muted', { text: `توضیح معلم: ${detail.notes}` }) : null,
      el('p.small.muted', { text: `آخرین بروزرسانی: ${faDate(detail.updatedAt)}` }),
      el('h3.report-card-section-title', { text: 'عملکرد من' }),
      renderPerformancePanel(detail.performance),
    ].filter(Boolean);
    modal.setContent(nodes);
  } catch (error) {
    modal.setContent([el('p.error', { text: errorMessage(error) })]);
  }
}

function summaryCard(cardData) {
  return card({ title: cardData.semester, icon: '📄', className: 'student-manual-report-card' }, [
    cardHeader(cardData),
    gradesTable(cardData.grades),
    el('div.row.report-card-editor__actions', {}, [
      el('button.btn.btn--primary.btn--sm', {
        type: 'button',
        text: 'مشاهده جزئیات و عملکرد',
        onclick: () => void openDetails(cardData.id),
      }),
    ]),
  ]);
}

export async function renderStudentReportCard() {
  setTopbarTitle('کارنامه دستی');
  const body = el('div.report-card-page.student-manual-report-card-page', {}, [loadingNode()]);
  renderView([
    pageHead({
      icon: '📊',
      title: 'کارنامه دستی من',
      subtitle: 'کارنامه‌هایی که معلم برای شما ثبت و منتشر کرده است.',
    }),
    studentTabs('student/report-cards'),
    body,
  ]);

  try {
    const me = await api.get('/student/me');
    const student = me.student;
    const res = await api.get('/student/report-cards');
    const cards = res.items ?? [];

    const completed = cards.filter((item) => (item.totalPercent ?? 0) > 0);
    const average = completed.length
      ? Math.round(completed.reduce((sum, item) => sum + Number(item.totalPercent || 0), 0) / completed.length)
      : 0;

    body.replaceChildren(
      el('div.grid.grid--stats.student-manual-report-stats', {}, [
        statCard({ label: 'کارنامه‌های منتشرشده', value: fa(cards.length), icon: '📄' }),
        statCard({ label: 'میانگین کل', value: `${fa(average)}٪`, icon: '📈' }),
        statCard({ label: 'دانش‌آموز', value: student?.name ?? '', icon: '🧑‍🎓' }),
      ]),
      cards.length
        ? el('div.report-card-list', {}, cards.map(summaryCard))
        : emptyState({
          icon: '📭',
          title: 'هنوز کارنامه‌ای منتشر نشده',
          hint: 'وقتی معلم کارنامه شما را منتشر کند، همین‌جا نمایش داده می‌شود.',
        }),
    );
  } catch (error) {
    body.replaceChildren(emptyState({
      icon: '⚠️',
      title: 'بارگذاری کارنامه ناموفق بود',
      hint: errorMessage(error),
    }));
  }
}
