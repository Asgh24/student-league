/** Full-width live leaderboard with polling, big typography and a countdown. */

import { api } from '../api.js';
import { el } from '../dom.js';
import { errorMessage } from '../format.js';
import { renderView, setLeaguePill, setTopbarTitle } from '../shell.js';
import { setLeagueId } from '../store.js';
import { emptyState } from '../ui.js';
import { card, countdownBox, fa, faDateTime, grid, loadingNode, pageHead, startCountdown } from './common.js';

const POLL_MS = 5000;

export async function renderLiveBoard({ params }) {
  const leagueId = Number(params.id);
  setLeagueId(leagueId);
  setTopbarTitle('تابلوی زنده');
  const body = el('div', {}, [loadingNode()]);
  renderView([body]);

  let mode = 'students';
  let source = null;
  let poller = null;

  async function fetchOnce() {
    const payload = await api.get(`/leagues/${leagueId}/live`);
    source = payload;
    return payload;
  }

  function stopPolling() {
    if (poller) {
      clearInterval(poller);
      poller = null;
    }
  }

  function rowsContainer(payload) {
    const board = el('div.live-board');
    if (mode === 'students') {
      if (payload.students.length === 0) return el('div', {}, [emptyState({ icon: '🧑‍🎓', title: 'دانش‌آموزی در لیگ نیست' })]);
      for (const row of payload.students) {
        board.appendChild(el(`div.live-row${row.rank <= 3 ? `.live-row--${row.rank}` : ''}`, {}, [
          el('span.live-row__rank', { text: fa(row.rank) }),
          el('span', { text: row.name }),
          el('span.chip.chip--muted', { text: `${row.title?.icon ?? ''} ${row.title?.title ?? ''}` }),
          el('span.live-row__total', { text: fa(row.total) }),
        ]));
      }
      return board;
    }
    if (payload.teams.length === 0) return el('div', {}, [emptyState({ icon: '🛡️', title: 'تیمی ساخته نشده است' })]);
    for (const team of payload.teams) {
      board.appendChild(el(`div.live-row${team.rank <= 3 ? `.live-row--${team.rank}` : ''}`, {}, [
        el('span.live-row__rank', { text: fa(team.rank) }),
        el('span', { text: team.name }),
        team.label ? el('span.chip.chip--amber', { text: team.label }) : null,
        el('span.small.muted', { text: `${fa(team.members)} عضو` }),
        el('span.live-row__total', { text: fa(team.points) }),
      ]));
    }
    return board;
  }

  function paint(payload) {
    const display = countdownBox();
    if (payload.timer?.endsAt) {
      const endsAt = new Date(payload.timer.endsAt).getTime();
      startCountdown(display.node, () => display.set(Math.max(0, endsAt - Date.now())));
    } else {
      display.set(0);
    }

    const studentTab = el(`button.tab${mode === 'students' ? '.is-active' : ''}`, {
      type: 'button',
      text: '🧑‍🎓 دانش‌آموزان',
      onclick: () => {
        mode = 'students';
        paint(source);
      },
    });
    const teamTab = el(`button.tab${mode === 'teams' ? '.is-active' : ''}`, {
      type: 'button',
      text: '🛡️ تیم‌ها',
      onclick: () => {
        mode = 'teams';
        paint(source);
      },
    });

    body.replaceChildren(
      pageHead({
        icon: '📺',
        title: 'تابلوی زنده',
        subtitle: `${payload.league.name} · آخرین به‌روزرسانی ${faDateTime(payload.updatedAt)}`,
        actions: [
          el('a.btn.btn--ghost', { href: `#/teacher/league/${leagueId}`, text: '↩️ لیگ' }),
        ],
      }),
      grid('grid--two', [
        card({ title: 'زمان باقی‌مانده', icon: '⏳' }, [
          display.node,
          el('p.small.muted', {
            text: payload.timer?.endsAt ? `پایان: ${faDateTime(payload.timer.endsAt)}` : 'تایمری تنظیم نشده است.',
          }),
        ]),
        card({ title: 'اطلاعات', icon: 'ℹ️' }, [
          el('p', { text: `معلم: ${payload.teacher.displayName}` }),
          el('p.small.muted', { text: `وضعیت لیگ: ${payload.league.status === 'completed' ? 'پایان‌یافته' : 'فعال'}` }),
          el('p.small.muted', { text: `به‌روزرسانی خودکار هر ${fa(POLL_MS / 1000)} ثانیه` }),
        ]),
      ]),
      card({ title: 'رده‌بندی', icon: '🏅' }, [
        el('div.tabs', {}, [studentTab, teamTab]),
        rowsContainer(payload),
      ]),
    );
  }

  function startPolling() {
    stopPolling();
    poller = setInterval(async () => {
      if (!body.isConnected) {
        stopPolling();
        return;
      }
      try {
        await fetchOnce();
        if (source) paint(source);
      } catch {
        /* transient network errors keep the last good board */
      }
    }, POLL_MS);
  }

  try {
    const payload = await fetchOnce();
    setLeaguePill({ name: payload.league.name });
    paint(payload);
    startPolling();
  } catch (error) {
    body.replaceChildren(emptyState({ icon: '⚠️', title: 'دریافت تابلوی زنده ناموفق بود', hint: errorMessage(error) }));
  }
  return undefined;
}
