/** Homework list with per-student completion tracking. */

import { api } from '../api.js';
import { el } from '../dom.js';
import { errorMessage } from '../format.js';
import { renderView, setLeaguePill, setTopbarTitle } from '../shell.js';
import { setLeagueId } from '../store.js';
import { confirmDialog, emptyState, formDialog, notify, openModal } from '../ui.js';
import { backToWorkbench, button, card, chip, fa, faDate, grid, iconButton, loadingNode, pageHead } from './common.js';

async function createHomework(leagueId, reload) {
  const values = await formDialog({
    title: 'تکلیف جدید',
    submitLabel: 'ثبت تکلیف',
    fields: [
      { name: 'title', label: 'عنوان', type: 'text', required: true, placeholder: 'مثلاً تمرین فصل سوم' },
      { name: 'description', label: 'توضیح', type: 'textarea', placeholder: 'شرح تکلیف برای دانش‌آموزان' },
      { name: 'dueDate', label: 'مهلت (میلادی، اختیاری)', type: 'date' },
    ],
  });
  if (!values) return;
  try {
    await api.post(`/leagues/${leagueId}/homework`, {
      title: values.title.trim(),
      description: values.description.trim(),
      dueDate: values.dueDate || null,
    });
    notify.ok('تکلیف ثبت شد');
    reload();
  } catch (error) {
    notify.error(errorMessage(error));
  }
}

async function editHomework(item, reload) {
  const values = await formDialog({
    title: 'ویرایش تکلیف',
    submitLabel: 'ذخیره',
    fields: [
      { name: 'title', label: 'عنوان', type: 'text', value: item.title, required: true },
      { name: 'description', label: 'توضیح', type: 'textarea', value: item.description ?? '' },
      { name: 'dueDate', label: 'مهلت (میلادی)', type: 'date', value: item.dueDate ?? '' },
    ],
  });
  if (!values) return;
  try {
    await api.patch(`/homework/${item.id}`, {
      title: values.title.trim(),
      description: values.description.trim(),
      dueDate: values.dueDate || null,
    });
    notify.ok('تکلیف ذخیره شد');
    reload();
  } catch (error) {
    notify.error(errorMessage(error));
  }
}

async function deleteHomework(item, reload) {
  const agreed = await confirmDialog({
    title: 'حذف تکلیف',
    message: `تکلیف «${item.title}» و وضعیت انجام آن حذف شود؟`,
    confirmLabel: 'حذف',
    danger: true,
  });
  if (!agreed) return;
  try {
    await api.del(`/homework/${item.id}`);
    notify.ok('تکلیف حذف شد');
    reload();
  } catch (error) {
    notify.error(errorMessage(error));
  }
}

async function openStatus(item, reload) {
  const body = el('div', {}, [el('p.small.muted', { text: 'در حال بارگذاری…' })]);
  const modal = openModal({ title: `وضعیت تکلیف: ${item.title}`, body });

  async function refresh() {
    try {
      const payload = await api.get(`/homework/${item.id}/status`);
      const list = el('div');
      for (const student of payload.items) {
        const done = student.status === 'done';
        list.appendChild(el('div.row', { style: { justifyContent: 'space-between', borderBottom: '1px solid var(--line)', padding: '6px 0' } }, [
          el('span', { text: student.name }),
          el('button.chip.chip--button', {
            type: 'button',
            text: done ? '✅ انجام شد' : '⏳ انجام نشده',
            title: 'تغییر وضعیت',
            onclick: async () => {
              try {
                await api.post(`/homework/${item.id}/status`, { studentId: student.studentId, status: done ? 'not_done' : 'done' });
                await refresh();
                reload();
              } catch (error) {
                notify.error(errorMessage(error));
              }
            },
          }),
        ]));
      }
      modal.setContent([
        el('h2.modal__title', { text: `وضعیت تکلیف: ${item.title}` }),
        el('div.row', {}, [
          button('همه انجام شد', { kind: 'soft', icon: '✅', onClick: () => bulk('done', refresh, reload) }),
          button('همه انجام نشده', { kind: 'ghost', icon: '⏳', onClick: () => bulk('not_done', refresh, reload) }),
        ]),
        list,
      ]);
    } catch (error) {
      modal.setContent([el('h2.modal__title', { text: 'خطا' }), el('p', { text: errorMessage(error) })]);
    }
  }

  async function bulk(status, refresh, reload) {
    try {
      await api.post(`/homework/${item.id}/status/bulk`, { status });
      notify.ok('وضعیت همه دانش‌آموزان ثبت شد');
      await refresh();
      reload();
    } catch (error) {
      notify.error(errorMessage(error));
    }
  }

  await refresh();
}

export async function renderHomework({ params }) {
  const leagueId = Number(params.id);
  setLeagueId(leagueId);
  setTopbarTitle('تکالیف');
  const body = el('div', {}, [loadingNode()]);
  renderView([body]);

  async function load() {
    body.replaceChildren(loadingNode());
    let league;
    let payload;
    try {
      [league, payload] = await Promise.all([
        api.get(`/leagues/${leagueId}`),
        api.get(`/leagues/${leagueId}/homework`),
      ]);
    } catch (error) {
      body.replaceChildren(emptyState({ icon: '⚠️', title: 'دریافت تکالیف ناموفق بود', hint: errorMessage(error) }));
      return;
    }
    setLeaguePill({ name: league.league.name });
    const items = payload.items ?? [];

    const list = el('div');
    if (items.length === 0) {
      list.appendChild(emptyState({ icon: '📚', title: 'هنوز تکلیفی ثبت نشده است', hint: 'با دکمه «تکلیف جدید» شروع کنید.' }));
    }
    for (const item of items) {
      list.appendChild(el('div.timeline-item', {}, [
        el('div', { style: { flex: '1' } }, [
          el('div', {}, [
            el('strong', { text: item.title }),
            item.dueDate ? chip(`مهلت ${faDate(item.dueDate)}`, 'amber') : null,
          ]),
          item.description ? el('div.small.muted', { text: item.description }) : null,
          el('div.row', { style: { gap: '6px', marginTop: '4px' } }, [
            chip(`✅ ${fa(item.doneCount)} انجام‌شده`, 'ok'),
            chip(`⏳ ${fa(item.pendingCount)} باقی‌مانده`, 'muted'),
          ]),
        ]),
        el('span.row', { style: { gap: '3px' } }, [
          iconButton('👥', { label: 'وضعیت دانش‌آموزان', kind: 'soft', onClick: () => openStatus(item, load) }),
          iconButton('✏️', { label: 'ویرایش تکلیف', onClick: () => editHomework(item, load) }),
          iconButton('✕', { label: 'حذف تکلیف', danger: true, onClick: () => deleteHomework(item, load) }),
        ]),
      ]));
    }

    body.replaceChildren(
      pageHead({
        icon: '📚',
        title: 'تکالیف',
        subtitle: league.league.name,
        actions: [
          button('تکلیف جدید', { icon: '➕', onClick: () => createHomework(leagueId, load) }),
          el('a.btn.btn--ghost', { href: `#/teacher/league/${leagueId}`, text: '↩️ لیگ' }),
          backToWorkbench(),
        ],
      }),
      grid('grid--stats', [
        el('div.stat', {}, [el('div.stat__value', { text: fa(items.length) }), el('div.stat__label', { text: '📚 تکالیف' })]),
        el('div.stat', {}, [
          el('div.stat__value', { text: fa(items.reduce((acc, item) => acc + item.doneCount, 0)) }),
          el('div.stat__label', { text: '✅ انجام‌شده' }),
        ]),
        el('div.stat', {}, [
          el('div.stat__value', { text: fa(items.reduce((acc, item) => acc + item.pendingCount, 0)) }),
          el('div.stat__label', { text: '⏳ باقی‌مانده' }),
        ]),
      ]),
      card({ title: 'فهرست تکالیف', icon: '📋' }, [list]),
    );
  }

  await load();
  return undefined;
}
