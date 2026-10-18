/** File sharing: upload with drag & drop, download and delete. */

import { api } from '../api.js';
import { el } from '../dom.js';
import { bytes, errorMessage } from '../format.js';
import { renderView, setLeaguePill, setTopbarTitle } from '../shell.js';
import { setLeagueId } from '../store.js';
import { confirmDialog, emptyState, notify } from '../ui.js';
import { button, card, fa, faDateTime, iconButton, loadingNode, pageHead } from './common.js';

async function deleteFile(item, reload) {
  const agreed = await confirmDialog({
    title: 'حذف فایل',
    message: `فایل «${item.originalName}» حذف شود؟`,
    confirmLabel: 'حذف',
    danger: true,
  });
  if (!agreed) return;
  try {
    await api.del(`/files/${item.id}`);
    notify.ok('فایل حذف شد');
    reload();
  } catch (error) {
    notify.error(errorMessage(error));
  }
}

export async function renderFiles({ params }) {
  const leagueId = Number(params.id);
  setLeagueId(leagueId);
  setTopbarTitle('ارسال فایل');
  const body = el('div', {}, [loadingNode()]);
  renderView([body]);

  async function load() {
    body.replaceChildren(loadingNode());
    let league;
    let payload;
    try {
      [league, payload] = await Promise.all([
        api.get(`/leagues/${leagueId}`),
        api.get(`/leagues/${leagueId}/files`),
      ]);
    } catch (error) {
      body.replaceChildren(emptyState({ icon: '⚠️', title: 'دریافت فایل‌ها ناموفق بود', hint: errorMessage(error) }));
      return;
    }
    setLeaguePill({ name: league.league.name });
    const items = payload.items ?? [];
    const limits = payload.limits ?? {};

    const fileInput = el('input', { id: 'file-input', type: 'file', hidden: 'true' });
    const chosen = el('p.small.muted', { text: 'فایلی انتخاب نشده است.' });
    const description = el('input', { id: 'file-description', type: 'text', placeholder: 'توضیح فایل (اختیاری)' });
    const submit = button('ارسال فایل', { icon: '⬆️', disabled: true, onClick: () => upload() });

    const dropZone = el('div.drop-zone', {
      onclick: () => fileInput.click(),
      onkeydown: (event) => {
        if (event.key === 'Enter' || event.key === ' ') fileInput.click();
      },
      role: 'button',
      tabindex: '0',
      'aria-label': 'انتخاب فایل برای ارسال',
    }, [
      el('p', { style: { textAlign: 'center', margin: 0 }, text: '📎 فایل را اینجا رها کنید یا برای انتخاب کلیک کنید' }),
      chosen,
    ]);

    dropZone.addEventListener('dragover', (event) => {
      event.preventDefault();
      dropZone.classList.add('is-over');
    });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('is-over'));
    dropZone.addEventListener('drop', (event) => {
      event.preventDefault();
      dropZone.classList.remove('is-over');
      if (event.dataTransfer?.files?.length) {
        fileInput.files = event.dataTransfer.files;
        pick();
      }
    });
    fileInput.addEventListener('change', pick);

    function pick() {
      const file = fileInput.files?.[0];
      chosen.textContent = file ? `${file.name} — ${bytes(file.size)}` : 'فایلی انتخاب نشده است.';
      submit.disabled = !file;
    }

    async function upload() {
      const file = fileInput.files?.[0];
      if (!file) return;
      const form = new FormData();
      form.append('file', file);
      if (description.value.trim()) form.append('description', description.value.trim());
      submit.disabled = true;
      try {
        await api.upload(`/leagues/${leagueId}/files`, form);
        notify.ok('فایل ارسال شد');
        await load();
      } catch (error) {
        notify.error(errorMessage(error));
      } finally {
        submit.disabled = false;
      }
    }

    const list = el('div');
    if (items.length === 0) {
      list.appendChild(emptyState({ icon: '📁', title: 'فایلی ارسال نشده است', hint: 'اولین فایل کلاس را از این صفحه بفرستید.' }));
    }
    for (const item of items) {
      list.appendChild(el('div.file-row', {}, [
        el('span.badge-emoji', { text: '📄' }),
        el('div', { style: { flex: '1' } }, [
          el('div.file-row__name', { text: item.originalName }),
          el('div.small.muted', {
            text: `${bytes(item.size)} · ${faDateTime(item.createdAt)}${item.description ? ` · ${item.description}` : ''}`,
          }),
        ]),
        el('a.btn.btn--sm.btn--soft', { href: `/api/v1/files/${item.id}/download`, text: '⬇️ دریافت' }),
        iconButton('✕', { label: 'حذف فایل', danger: true, onClick: () => deleteFile(item, load) }),
      ]));
    }

    const allowed = (limits.extensions ?? []).join(' ');

    body.replaceChildren(
      pageHead({
        icon: '📎',
        title: 'ارسال فایل',
        subtitle: league.league.name,
        actions: [el('a.btn.btn--ghost', { href: `#/teacher/league/${leagueId}`, text: '↩️ لیگ' })],
      }),
      card({ title: 'ارسال فایل جدید', icon: '⬆️' }, [
        fileInput,
        dropZone,
        el('div.field', { style: { marginTop: '10px' } }, [el('label', { for: 'file-description', text: 'توضیح' }), description]),
        el('div.row', {}, [submit]),
        el('p.small.muted', {
          text: `حداکثر حجم: ${bytes(limits.maxBytes ?? 0)} · پسوندهای مجاز: ${allowed || '—'}`,
        }),
      ]),
      card({ title: `فایل‌های کلاس (${fa(items.length)})`, icon: '📁' }, [list]),
    );
  }

  await load();
  return undefined;
}
