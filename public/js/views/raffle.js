/** Random draw (raffle) with previously-picked exclusion and animation. */

import { api } from '../api.js';
import { el } from '../dom.js';
import { errorMessage } from '../format.js';
import { renderView, setLeaguePill, setTopbarTitle } from '../shell.js';
import { setLeagueId } from '../store.js';
import { confirmDialog, emptyState, notify } from '../ui.js';
import { backToWorkbench, button, card, fa, faDateTime, grid, loadingNode, pageHead } from './common.js';

export async function renderRaffle({ params }) {
  const leagueId = Number(params.id);
  setLeagueId(leagueId);
  setTopbarTitle('قرعه‌کشی');
  const body = el('div', {}, [loadingNode()]);
  renderView([body]);

  let names = [];
  let history = [];

  async function load() {
    body.replaceChildren(loadingNode());
    try {
      const [league, students, historyPayload] = await Promise.all([
        api.get(`/leagues/${leagueId}`),
        api.get(`/leagues/${leagueId}/students`),
        api.get(`/leagues/${leagueId}/tools/raffle/history`),
      ]);
      setLeaguePill({ name: league.league.name });
      names = (students.items ?? []).map((row) => row.name);
      history = historyPayload.items ?? [];
      render(league.league.name);
    } catch (error) {
      body.replaceChildren(emptyState({ icon: '⚠️', title: 'دریافت اطلاعات قرعه‌کشی ناموفق بود', hint: errorMessage(error) }));
    }
  }

  function historyCard() {
    if (history.length === 0) {
      return card({ title: 'تاریخچه قرعه‌کشی', icon: '📜' }, [el('p.small.muted', { text: 'هنوز قرعه‌کشی انجام نشده است.' })]);
    }
    const list = el('div');
    for (const item of history) {
      list.appendChild(el('div.timeline-item', {}, [
        el('span.badge-emoji', { text: '🎯' }),
        el('div', {}, [
          el('div', { text: item.studentName }),
          el('div.small.muted', { text: `${item.reason || 'بدون دلیل'} · ${faDateTime(item.createdAt)}` }),
        ]),
      ]));
    }
    return card({
      title: 'تاریخچه قرعه‌کشی',
      icon: '📜',
      actions: [button('پاک کردن تاریخچه', { kind: 'ghost', icon: '🗑️', onClick: clearHistory })],
    }, [list]);
  }

  async function clearHistory() {
    const agreed = await confirmDialog({
      title: 'پاک کردن تاریخچه',
      message: 'تاریخچه قرعه‌کشی پاک شود؟ با این کار امکان انتخاب دوباره افراد فراهم می‌شود.',
      confirmLabel: 'پاک کن',
      danger: true,
    });
    if (!agreed) return;
    try {
      await api.del(`/leagues/${leagueId}/tools/raffle/history`);
      notify.ok('تاریخچه پاک شد');
      await load();
    } catch (error) {
      notify.error(errorMessage(error));
    }
  }

  function render(leagueName) {
    const exclude = el('input', { id: 'raffle-exclude', type: 'checkbox' });
    exclude.checked = true;
    const reason = el('input', { id: 'raffle-reason', type: 'text', placeholder: 'مثلاً پرسش کلاسی امروز' });
    const display = el('div', {
      style: { fontSize: '2.4rem', fontWeight: '800', textAlign: 'center', minHeight: '3.4rem', margin: '10px 0' },
      text: names.length ? '—' : 'دانش‌آموزی ثبت نشده',
      'aria-live': 'polite',
    });
    const meta = el('p.small.muted', { style: { textAlign: 'center' } });

    const draw = button('قرعه‌کشی کن', { icon: '🎲', onClick: () => run() });
    draw.disabled = names.length === 0;

    async function run() {
      draw.disabled = true;
      display.style.color = '';
      let ticks = 0;
      const interval = setInterval(() => {
        ticks += 1;
        display.textContent = names[Math.floor(Math.random() * names.length)];
        if (ticks > 16) clearInterval(interval);
      }, 70);

      try {
        const payload = await api.post(`/leagues/${leagueId}/tools/raffle`, {
          excludePrevious: exclude.checked,
          reason: reason.value.trim(),
        });
        clearInterval(interval);
        display.textContent = `🎉 ${payload.winner.name}`;
        display.style.color = '#7c3aed';
        meta.textContent = `${fa(payload.poolSize)} دانش‌آموز در لیگ · ${fa(payload.remaining)} نفر در نوبت باقی‌مانده${payload.cycled ? ' · فهرست دوباره از ابتدا آغاز شد' : ''}`;
        history = payload.history ?? history;
        body.replaceChildren(...pageNodes(leagueName));
      } catch (error) {
        clearInterval(interval);
        notify.error(errorMessage(error));
      } finally {
        draw.disabled = false;
      }
    }

    function stage() {
      return card({ title: 'گردونه شانس انتخاب', icon: '🎲' }, [
        display,
        meta,
        el('label.checkbox', { for: 'raffle-exclude' }, [exclude, el('span', { text: 'افراد انتخاب‌شده قبلی حذف شوند' })]),
        el('div.field', {}, [el('label', { for: 'raffle-reason', text: 'دلیل (اختیاری)' }), reason]),
        el('div.row', { style: { justifyContent: 'center' } }, [draw]),
      ]);
    }

    const pageNodes = () => [
      pageHead({
        icon: '🎲',
        title: 'قرعه‌کشی',
        subtitle: leagueName,
        actions: [
          el('a.btn.btn--ghost', { href: `#/teacher/league/${leagueId}`, text: '↩️ لیگ' }),
          backToWorkbench(),
          el('a.btn.btn--soft', { href: `#/teacher/league/${leagueId}/wheel`, text: '🎡 گردونه شانس' }),
        ],
      }),
      grid('grid--two', [stage(), historyCard()]),
    ];

    body.replaceChildren(...pageNodes());
  }

  await load();
  return undefined;
}
