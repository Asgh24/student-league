/** Canvas lucky wheel with teacher editable segments. */

import { api } from '../api.js';
import { el } from '../dom.js';
import { errorMessage } from '../format.js';
import { renderView, setLeaguePill, setTopbarTitle } from '../shell.js';
import { setLeagueId } from '../store.js';
import { emptyState, notify } from '../ui.js';
import { button, card, fa, grid, loadingNode, pageHead } from './common.js';

const PALETTE = ['#7c3aed', '#a855f7', '#ec4899', '#f59e0b', '#22c55e', '#0ea5e9', '#f43f5e', '#8b5cf6'];
const SIZE = 340;

function randomIndex(length) {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const buffer = new Uint32Array(1);
    crypto.getRandomValues(buffer);
    return buffer[0] % length;
  }
  return Math.floor(Math.random() * length);
}

function prepareCanvas(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = SIZE * dpr;
  canvas.height = SIZE * dpr;
  canvas.style.width = `${SIZE}px`;
  canvas.style.height = `${SIZE}px`;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

function drawWheel(ctx, segments, rotation) {
  const center = SIZE / 2;
  const radius = center - 8;
  ctx.clearRect(0, 0, SIZE, SIZE);
  const angle = (Math.PI * 2) / segments.length;

  segments.forEach((segment, index) => {
    const start = rotation + index * angle;
    const end = start + angle;
    ctx.beginPath();
    ctx.moveTo(center, center);
    ctx.arc(center, center, radius, start, end);
    ctx.closePath();
    ctx.fillStyle = PALETTE[index % PALETTE.length];
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.save();
    ctx.translate(center, center);
    ctx.rotate(start + angle / 2);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 14px Vazirmatn, Tahoma, sans-serif';
    const label = segment.label.length > 18 ? `${segment.label.slice(0, 17)}…` : segment.label;
    ctx.fillText(label, radius - 14, 0);
    ctx.restore();
  });

  ctx.beginPath();
  ctx.arc(center, center, 26, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = '#7c3aed';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = '#7c3aed';
  ctx.font = '700 20px Vazirmatn, Tahoma, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('🎯', center, center + 1);
}

export async function renderWheel({ params }) {
  const leagueId = Number(params.id);
  setLeagueId(leagueId);
  setTopbarTitle('گردونه شانس');
  const body = el('div', {}, [loadingNode()]);
  renderView([body]);

  async function load() {
    body.replaceChildren(loadingNode());
    let league;
    let payload;
    try {
      [league, payload] = await Promise.all([
        api.get(`/leagues/${leagueId}`),
        api.get(`/leagues/${leagueId}/tools/wheel`),
      ]);
    } catch (error) {
      body.replaceChildren(emptyState({ icon: '⚠️', title: 'دریافت گردونه ناموفق بود', hint: errorMessage(error) }));
      return;
    }
    setLeaguePill({ name: league.league.name });
    paint(league, payload);
  }

  function paint(league, payload) {
    const segments = payload.segments ?? [];
    if (segments.length < 2) {
      body.replaceChildren(
        pageHead({ icon: '🎡', title: 'گردونه شانس', subtitle: league.league.name }),
        card({ title: 'گردونه', icon: '🎡' }, [emptyState({ icon: '🎡', title: 'برای گردونه حداقل دو بخش لازم است', hint: 'گزینه‌ها را ویرایش کنید.' })]),
        segmentsEditor(segments),
      );
      return;
    }

    const canvas = el('canvas', { 'aria-label': 'گردونه شانس' });
    const ctx = prepareCanvas(canvas);
    let rotation = -Math.PI / 2;
    drawWheel(ctx, segments, rotation);

    const result = el('p', { style: { textAlign: 'center', fontSize: '1.4rem', fontWeight: '800', minHeight: '2rem' }, 'aria-live': 'polite' });
    const spin = button('چرخاندن', { icon: '🎡', onClick: () => run() });

    function run() {
      if (spin.disabled) return;
      spin.disabled = true;
      result.textContent = '';
      const index = randomIndex(segments.length);
      const angle = (Math.PI * 2) / segments.length;
      const start = rotation;
      let target = -Math.PI / 2 - (index + 0.5) * angle;
      while (target > start + Math.PI * 2 * 5) target -= Math.PI * 2;
      while (target < start + Math.PI * 2 * 5) target += Math.PI * 2;
      const duration = 3600;
      const startedAt = performance.now();

      const frame = (now) => {
        const progress = Math.min(1, (now - startedAt) / duration);
        const eased = 1 - (1 - progress) ** 3;
        rotation = start + (target - start) * eased;
        drawWheel(ctx, segments, rotation);
        if (progress < 1) {
          requestAnimationFrame(frame);
        } else {
          rotation = target % (Math.PI * 2);
          result.textContent = `🎉 ${segments[index].label}`;
          spin.disabled = false;
        }
      };
      requestAnimationFrame(frame);
    }

    const sourceLabels = { custom: 'بخش‌های دلخواه معلم', students: 'نام دانش‌آموزان', default: 'گزینه‌های پیش‌فرض' };

    body.replaceChildren(
      pageHead({
        icon: '🎡',
        title: 'گردونه شانس',
        subtitle: league.league.name,
        actions: [
          el('a.btn.btn--ghost', { href: `#/teacher/league/${leagueId}`, text: '↩️ لیگ' }),
          el('a.btn.btn--soft', { href: `#/teacher/league/${leagueId}/raffle`, text: '🎲 قرعه‌کشی' }),
        ],
      }),
      grid('grid--two', [
        card({ title: 'گردونه', icon: '🎡' }, [
          el('div.wheel-stage', {}, [el('span.wheel-pointer', { text: '▼', 'aria-hidden': 'true' }), canvas]),
          result,
          el('div.row', { style: { justifyContent: 'center' } }, [spin]),
          el('p.small.muted', { text: `منبع بخش‌ها: ${sourceLabels[payload.source] ?? 'دلخواه'} · تعداد: ${fa(segments.length)}` }),
        ]),
        segmentsEditor(segments),
      ]),
    );
  }

  function segmentsEditor(segments) {
    const textarea = el('textarea', {
      id: 'wheel-segments',
      value: segments.map((segment) => segment.label).join('\n'),
      rows: 10,
    });
    const save = button('ذخیره بخش‌ها', { kind: 'soft', icon: '💾', onClick: async () => {
      const labels = textarea.value.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 24);
      if (labels.length < 2) {
        notify.error('حداقل دو بخش لازم است');
        return;
      }
      try {
        await api.put(`/leagues/${leagueId}/tools/wheel`, { segments: labels.map((label) => ({ label: label.slice(0, 40) })) });
        notify.ok('بخش‌های گردونه ذخیره شد');
        await load();
      } catch (error) {
        notify.error(errorMessage(error));
      }
    } });

    return card({ title: 'ویرایش بخش‌ها', icon: '✏️' }, [
      el('p.small.muted', { text: 'هر خط یک بخش گردونه است (حداقل ۲ و حداکثر ۲۴ بخش).' }),
      el('div.field', {}, [el('label', { for: 'wheel-segments', text: 'بخش‌ها' }), textarea]),
      el('div.row', {}, [save]),
    ]);
  }

  await load();
  return undefined;
}
