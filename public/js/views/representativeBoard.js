/** Projector-friendly «نماینده کلاس» board with automatic refresh. */

import { api } from '../api.js';
import { el } from '../dom.js';
import { errorMessage } from '../format.js';
import { renderView, setLeaguePill, setTopbarTitle } from '../shell.js';
import { setLeagueId } from '../store.js';
import { emptyState } from '../ui.js';
import { backToWorkbench, fa, faDateTime, loadingNode } from './common.js';

const BASE = (leagueId) => `/leagues/${leagueId}/tools/representative`;
const POLL_MS = 4000;

export async function renderRepresentativeBoard({ params }) {
  const leagueId = Number(params.id);
  setLeagueId(leagueId);
  setTopbarTitle('تابلوی نماینده کلاس');

  const body = el('div.rep-stage-page', {}, [loadingNode()]);
  renderView([body]);

  let state = null;
  let leagueName = '';
  let lastShownId = null;
  let timer = null;

  function stopPolling() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function cyclePicks() {
    return (state.history ?? [])
      .filter((item) => item.cycle === state.cycle)
      .slice()
      .sort((a, b) => a.id - b.id);
  }

  function paint() {
    const winner = state.lastSelected;
    const isNew = Boolean(winner) && winner.id !== lastShownId;
    if (winner) lastShownId = winner.id;
    const picks = cyclePicks();
    const progress = Math.max(0, Math.min(100, Number(state.percent) || 0));

    body.replaceChildren(
      el('section.rep-stage', {}, [
        el('div.rep-stage__bar', {}, [
          el('span.rep-stage__brand', { text: '👑 نمایندهٔ کلاس' }),
          el('span.rep-stage__league', { text: leagueName }),
        ]),
        el('div.rep-stage__cycle', {}, [
          el('span', { text: `دور ${fa(state.cycle)}` }),
          el('span.rep-stage__dot', { text: '·', 'aria-hidden': 'true' }),
          el('span', {
            text: state.completed ? '✅ دور تکمیل شد' : `${fa(state.remainingCount)} نفر باقی مانده`,
          }),
        ]),
        el('div.rep-stage__crown', { text: '👑', 'aria-hidden': 'true' }),
        el('div.rep-stage__label', {
          text: winner
            ? state.completed ? 'آخرین نمایندهٔ این دور' : 'نمایندهٔ این دور'
            : 'هنوز نماینده‌ای انتخاب نشده است',
        }),
        el(`h1.rep-stage__name${isNew ? '.is-new' : ''}`, {
          text: winner?.studentName ?? '—',
          'aria-live': 'polite',
        }),
        winner
          ? el('div.rep-stage__when', { text: faDateTime(winner.createdAt) })
          : el('div.rep-stage__when', { text: 'با دکمهٔ انتخاب در صفحهٔ کنترل شروع کنید.' }),
        el('div.rep-stage__progress', {}, [
          el('div.rep-stage__progress-meta', {}, [
            el('span', { text: `پیشرفت دور ${fa(state.cycle)}` }),
            el('strong', { text: `${fa(progress)}٪` }),
          ]),
          el('div.rep-stage__track', {
            role: 'progressbar',
            'aria-valuemin': '0',
            'aria-valuemax': '100',
            'aria-valuenow': String(progress),
            'aria-label': 'پیشرفت نماینده‌های این دور',
          }, [
            el('span.rep-stage__fill', { style: { width: `${progress}%` } }),
          ]),
          el('div.rep-stage__progress-meta.rep-stage__progress-meta--small', {}, [
            el('span', { text: `${fa(state.selectedCount)} از ${fa(state.totalStudents)} انتخاب‌شده` }),
            el('span', { text: `${fa(state.remainingCount)} باقی‌مانده` }),
          ]),
        ]),
        picks.length
          ? el('div.rep-stage__picks', {}, [
            el('span.rep-stage__picks-label', { text: 'نماینده‌های این دور' }),
            ...picks.map((item) => el('span.rep-stage__pick', { text: item.studentName })),
          ])
          : null,
        el('div.rep-stage__foot', {}, [
          el('a.btn.btn--soft', {
            href: `#/teacher/league/${leagueId}/representative`,
            text: '↩️ کنترل و انتخاب',
          }),
          backToWorkbench(),
        ]),
        el('p.rep-stage__hint', {
          text: `این تابلو هر ${fa(POLL_MS / 1000)} ثانیه به‌روزرسانی می‌شود.`,
        }),
      ]),
    );
  }

  async function load() {
    try {
      const [leaguePayload, representative] = await Promise.all([
        api.get(`/leagues/${leagueId}`),
        api.get(BASE(leagueId)),
      ]);
      leagueName = leaguePayload.league?.name ?? '';
      state = representative;
      setLeaguePill({ name: leagueName });
      paint();
    } catch (error) {
      body.replaceChildren(emptyState({
        icon: '⚠️',
        title: 'دریافت تابلوی نماینده ناموفق بود',
        hint: errorMessage(error),
      }));
    }
  }

  await load();
  if (state) {
    timer = setInterval(async () => {
      if (!body.isConnected) {
        stopPolling();
        return;
      }
      try {
        state = await api.get(BASE(leagueId));
        paint();
      } catch {
        /* keep the last good board during a transient network error */
      }
    }, POLL_MS);
  }
  return undefined;
}
