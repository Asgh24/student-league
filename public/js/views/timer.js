/** Countdown timer (persisted per league) plus a local stopwatch with sound. */

import { api } from '../api.js';
import { el } from '../dom.js';
import { errorMessage } from '../format.js';
import { renderView, setLeaguePill, setTopbarTitle } from '../shell.js';
import { setLeagueId } from '../store.js';
import { emptyState, notify } from '../ui.js';
import { backToWorkbench, button, card, countdownBox, fa, faDateTime, grid, loadingNode, pageHead, startCountdown } from './common.js';

let audioContext = null;

function ensureAudio() {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  if (!audioContext) audioContext = new Ctor();
  if (audioContext.state === 'suspended') audioContext.resume();
  return audioContext;
}

/** Plays a short three-note chime; the context is created on first use. */
export function playChime() {
  const ctx = ensureAudio();
  if (!ctx) return false;
  const now = ctx.currentTime;
  [0, 0.22, 0.44].forEach((offset, index) => {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = [880, 1040, 1320][index];
    gain.gain.setValueAtTime(0.0001, now + offset);
    gain.gain.exponentialRampToValueAtTime(0.25, now + offset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.2);
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start(now + offset);
    oscillator.stop(now + offset + 0.22);
  });
  return true;
}

function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = String(Math.floor(total / 3600)).padStart(2, '0');
  const minutes = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const seconds = String(total % 60).padStart(2, '0');
  const centis = String(Math.floor((Math.max(0, ms) % 1000) / 10)).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}.${centis}`;
}

function countdownCard(leagueId, timer, reload) {
  const minutes = el('input', { id: 'cd-minutes', type: 'number', min: 0, max: 3650, value: 5, 'aria-label': 'دقیقه' });
  const seconds = el('input', { id: 'cd-seconds', type: 'number', min: 0, max: 59, value: 0, 'aria-label': 'ثانیه' });
  const display = countdownBox();
  const status = el('p.small.muted');
  const soundToggle = el('input', { id: 'cd-sound', type: 'checkbox' });
  soundToggle.checked = true;

  if (timer?.endsAt) {
    const endsAt = new Date(timer.endsAt).getTime();
    let alerted = timer.expired;
    startCountdown(display.node, () => {
      const remaining = Math.max(0, endsAt - Date.now());
      display.set(remaining);
      if (remaining === 0 && !alerted) {
        alerted = true;
        if (soundToggle.checked) playChime();
        notify.info('زمان تایمر به پایان رسید');
      }
    });
    status.textContent = timer.expired ? `پایان یافته در ${faDateTime(timer.endsAt)}` : `پایان: ${faDateTime(timer.endsAt)}`;
  } else {
    display.set(0);
    status.textContent = 'تایمری تنظیم نشده است.';
  }

  async function setTimer(totalSeconds) {
    if (totalSeconds <= 0) {
      notify.error('مدت زمان باید بیشتر از صفر باشد');
      return;
    }
    try {
      await api.put(`/leagues/${leagueId}/timer`, {
        days: Math.floor(totalSeconds / 86400),
        hours: Math.floor((totalSeconds % 86400) / 3600),
        minutes: Math.floor((totalSeconds % 3600) / 60),
        seconds: totalSeconds % 60,
      });
      ensureAudio();
      notify.ok('تایمر تنظیم شد');
      reload();
    } catch (error) {
      notify.error(errorMessage(error));
    }
  }

  async function adjust(days) {
    try {
      await api.post(`/leagues/${leagueId}/timer/adjust`, { days });
      notify.ok(days > 0 ? 'زمان افزایش یافت' : 'زمان کاهش یافت');
      reload();
    } catch (error) {
      notify.error(errorMessage(error));
    }
  }

  async function reset() {
    try {
      await api.del(`/leagues/${leagueId}/timer`);
      notify.ok('تایمر پاک شد');
      reload();
    } catch (error) {
      notify.error(errorMessage(error));
    }
  }

  return card({ title: 'شمارش معکوس', icon: '⏳' }, [
    display.node,
    status,
    el('div.grid', { style: { gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', marginTop: '10px' } }, [
      el('div.field', {}, [el('label', { for: 'cd-minutes', text: 'دقیقه' }), minutes]),
      el('div.field', {}, [el('label', { for: 'cd-seconds', text: 'ثانیه' }), seconds]),
    ]),
    el('div.row', {}, [
      button('شروع', { icon: '▶️', onClick: () => setTimer((Number(minutes.value) || 0) * 60 + (Number(seconds.value) || 0)) }),
      button('۱ دقیقه', { kind: 'ghost', onClick: () => setTimer(60) }),
      button('۵ دقیقه', { kind: 'ghost', onClick: () => setTimer(300) }),
      button('۱۰ دقیقه', { kind: 'ghost', onClick: () => setTimer(600) }),
      button('+۱ روز', { kind: 'ghost', icon: '➕', onClick: () => adjust(1) }),
      button('−۱ روز', { kind: 'ghost', icon: '➖', onClick: () => adjust(-1) }),
      button('پاک کردن', { kind: 'danger', icon: '🗑️', onClick: reset }),
    ]),
    el('label.checkbox', { for: 'cd-sound' }, [soundToggle, el('span', { text: 'پخش صدای هشدار در پایان زمان' })]),
    el('div.row', {}, [button('آزمایش صدا', { kind: 'soft', icon: '🔊', onClick: () => { if (!playChime()) notify.warn('مرورگر از پخش صدا پشتیبانی نمی‌کند'); } })]),
  ]);
}

function stopwatchCard() {
  const display = el('div', {
    style: { fontSize: '2rem', fontWeight: '800', textAlign: 'center', fontVariantNumeric: 'tabular-nums' },
    text: formatDuration(0),
    'aria-live': 'off',
  });
  const laps = el('div');
  let running = false;
  let startedAt = 0;
  let elapsed = 0;
  let handle = null;

  function paint() {
    display.textContent = formatDuration(elapsed + (running ? Date.now() - startedAt : 0));
  }

  function start() {
    if (running) return;
    running = true;
    startedAt = Date.now();
    handle = setInterval(paint, 47);
    paint();
  }

  function stop() {
    if (!running) return;
    elapsed += Date.now() - startedAt;
    running = false;
    if (handle) clearInterval(handle);
    handle = null;
    paint();
  }

  function reset() {
    stop();
    elapsed = 0;
    laps.replaceChildren();
    paint();
  }

  function lap() {
    laps.appendChild(el('div.timeline-item', {}, [
      el('span.timeline-item__delta', { text: fa(laps.childElementCount + 1) }),
      el('div', { text: formatDuration(elapsed + (running ? Date.now() - startedAt : 0)) }),
    ]));
  }

  return card({ title: 'کرنومتر', icon: '⏱️' }, [
    display,
    el('div.row', { style: { justifyContent: 'center' } }, [
      button('شروع', { icon: '▶️', onClick: start }),
      button('توقف', { kind: 'amber', icon: '⏸️', onClick: stop }),
      button('ثبت دور', { kind: 'soft', icon: '🏁', onClick: lap }),
      button('صفر', { kind: 'ghost', icon: '↩️', onClick: reset }),
    ]),
    laps,
  ]);
}

export async function renderTimerTools({ params }) {
  const leagueId = Number(params.id);
  setLeagueId(leagueId);
  setTopbarTitle('تایمر و ابزار');
  const body = el('div', {}, [loadingNode()]);
  renderView([body]);

  async function load() {
    body.replaceChildren(loadingNode());
    let league;
    let payload;
    try {
      [league, payload] = await Promise.all([
        api.get(`/leagues/${leagueId}`),
        api.get(`/leagues/${leagueId}/timer`),
      ]);
    } catch (error) {
      body.replaceChildren(emptyState({ icon: '⚠️', title: 'دریافت تایمر ناموفق بود', hint: errorMessage(error) }));
      return;
    }
    setLeaguePill({ name: league.league.name });
    body.replaceChildren(
      pageHead({
        icon: '⏱️',
        title: 'تایمر و ابزار',
        subtitle: league.league.name,
        actions: [
          el('a.btn.btn--ghost', { href: `#/teacher/league/${leagueId}`, text: '↩️ لیگ' }),
          backToWorkbench(),
        ],
      }),
      grid('grid--two', [countdownCard(leagueId, payload.timer, load), stopwatchCard()]),
    );
  }

  await load();
  return undefined;
}
