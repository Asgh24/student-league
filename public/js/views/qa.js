/** Class questions with student answers and point awards. */

import { api } from '../api.js';
import { el } from '../dom.js';
import { errorMessage } from '../format.js';
import { renderView, setLeaguePill, setTopbarTitle } from '../shell.js';
import { setLeagueId } from '../store.js';
import { confirmDialog, emptyState, formDialog, notify, openModal } from '../ui.js';
import { button, card, chip, fa, faDateTime, grid, iconButton, loadingNode, pageHead } from './common.js';

async function createQuestion(leagueId, reload) {
  const values = await formDialog({
    title: 'سؤال جدید',
    submitLabel: 'ثبت سؤال',
    fields: [
      { name: 'body', label: 'متن سؤال', type: 'textarea', required: true, placeholder: 'مثلاً: پایتخت ایران کجاست؟' },
      { name: 'points', label: 'امتیاز پاسخ درست', type: 'number', value: 25, min: 0, max: 10000, required: true },
    ],
  });
  if (!values) return;
  try {
    await api.post(`/leagues/${leagueId}/questions`, { body: values.body.trim(), points: Number(values.points) || 0 });
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
        list.appendChild(el('div.timeline-item', {}, [
          el('div', { style: { flex: '1' } }, [
            el('div', {}, [el('strong', { text: answer.studentName }), chip(faDateTime(answer.createdAt), 'muted')]),
            el('div', { text: answer.body }),
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
      modal.setContent([
        el('h2.modal__title', { text: `پاسخ‌ها (${fa(payload.items.length)})` }),
        el('p.small.muted', { text: payload.question.body }),
        el('p.small.muted', { text: `امتیاز پیشنهادی سؤال: ${fa(payload.question.points)}` }),
        list,
      ]);
    } catch (error) {
      modal.setContent([el('h2.modal__title', { text: 'خطا' }), el('p', { text: errorMessage(error) })]);
    }
  }

  await refresh();
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
          ]),
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

    body.replaceChildren(
      pageHead({
        icon: '❓',
        title: 'سوال و پاسخ',
        subtitle: league.league.name,
        actions: [
          button('سؤال جدید', { icon: '➕', onClick: () => createQuestion(leagueId, load) }),
          el('a.btn.btn--ghost', { href: `#/teacher/league/${leagueId}`, text: '↩️ لیگ' }),
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
    );
  }

  await load();
  return undefined;
}
