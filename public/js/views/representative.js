/** «نماینده کلاس» — fair, non-repeating representative draws with history. */

import { api } from '../api.js';
import { el } from '../dom.js';
import { errorMessage } from '../format.js';
import { matches } from '../normalize.js';
import { renderView, setLeaguePill, setTopbarTitle } from '../shell.js';
import { setLeagueId } from '../store.js';
import { confirmDialog, emptyState, notify } from '../ui.js';
import { backToWorkbench, button, card, fa, faDateTime, grid, loadingNode, pageHead, statCard } from './common.js';

const BASE = (leagueId) => `/leagues/${leagueId}/tools/representative`;

export async function renderRepresentative({ params }) {
  const leagueId = Number(params.id);
  setLeagueId(leagueId);
  setTopbarTitle('نماینده کلاس');

  const body = el('div', {}, [loadingNode()]);
  renderView([body]);

  let state = null;
  let leagueName = '';
  let busy = false;
  let searchTerm = '';
  let justPickedId = null;

  async function load() {
    body.replaceChildren(loadingNode());
    try {
      const [leaguePayload, representative] = await Promise.all([
        api.get(`/leagues/${leagueId}`),
        api.get(BASE(leagueId)),
      ]);
      leagueName = leaguePayload.league?.name ?? '';
      state = representative;
      setLeaguePill({ name: leagueName });
      render();
    } catch (error) {
      body.replaceChildren(emptyState({
        icon: '⚠️',
        title: 'دریافت اطلاعات نماینده کلاس ناموفق بود',
        hint: errorMessage(error),
      }));
    }
  }

  async function draw() {
    if (busy || !state || state.completed || state.totalStudents === 0) return;
    busy = true;
    render();
    try {
      const payload = await api.post(`${BASE(leagueId)}/draw`, {});
      state = payload.state;
      justPickedId = payload.winner?.historyId ?? null;
      notify.ok(`${payload.winner.name} نمایندهٔ این دور شد`);
    } catch (error) {
      if (error?.code === 'CYCLE_COMPLETE') {
        notify.warn(errorMessage(error));
        await load();
        return;
      }
      notify.error(errorMessage(error));
    } finally {
      busy = false;
      if (state) render();
    }
  }

  async function startNextCycle({ force = false } = {}) {
    if (busy || !state) return;
    const agreed = await confirmDialog({
      title: 'شروع دور جدید',
      message: force
        ? 'هنوز همهٔ دانش‌آموزان این دور انتخاب نشده‌اند. با شروع دور جدید، انتخاب‌های باقی‌مانده به دور بعد منتقل می‌شوند. ادامه می‌دهید؟'
        : 'دور جدید شروع شود؟ تاریخچهٔ دوره‌های قبلی حفظ می‌شود.',
      confirmLabel: 'شروع دور جدید',
    });
    if (!agreed) return;
    busy = true;
    render();
    try {
      const payload = await api.post(`${BASE(leagueId)}/cycle`, { force });
      state = payload.state;
      justPickedId = null;
      notify.ok(`دور ${fa(payload.cycle)} شروع شد`);
    } catch (error) {
      notify.error(errorMessage(error));
    } finally {
      busy = false;
      if (state) render();
    }
  }

  async function undoLast() {
    if (busy || !state?.lastSelected) return;
    const agreed = await confirmDialog({
      title: 'لغو آخرین انتخاب',
      message: `انتخاب «${state.lastSelected.studentName}» در این دور لغو شود؟ این دانش‌آموز دوباره در فهرست باقی‌مانده‌ها قرار می‌گیرد.`,
      confirmLabel: 'لغو انتخاب',
      danger: true,
    });
    if (!agreed) return;
    busy = true;
    render();
    try {
      const payload = await api.del(`${BASE(leagueId)}/last`);
      state = payload.state;
      justPickedId = null;
      notify.ok('آخرین انتخاب لغو شد');
    } catch (error) {
      notify.error(errorMessage(error));
    } finally {
      busy = false;
      if (state) render();
    }
  }

  async function resetHistory() {
    if (busy || !state) return;
    const agreed = await confirmDialog({
      title: 'ریست تاریخچه',
      message: 'همهٔ تاریخچهٔ نماینده‌ها و وضعیت دورها پاک شود؟ این کار قابل بازگشت نیست.',
      confirmLabel: 'پاک کن',
      danger: true,
    });
    if (!agreed) return;
    busy = true;
    render();
    try {
      const payload = await api.del(`${BASE(leagueId)}/history`);
      state = payload.state;
      justPickedId = null;
      searchTerm = '';
      notify.ok('تاریخچه پاک شد و دور تازه شروع شد');
    } catch (error) {
      notify.error(errorMessage(error));
    } finally {
      busy = false;
      if (state) render();
    }
  }

  function winnerBlock() {
    if (!state.lastSelected) {
      return el('div.rep-winner.rep-winner--empty', {}, [
        el('span.rep-winner__crown', { text: '👑', 'aria-hidden': 'true' }),
        el('span', { text: 'هنوز نماینده‌ای در این دور انتخاب نشده است' }),
      ]);
    }
    const isNew = justPickedId !== null && state.lastSelected.id === justPickedId;
    return el(`div.rep-winner${isNew ? '.is-new' : ''}`, {}, [
      el('span.rep-winner__crown', { text: '👑', 'aria-hidden': 'true' }),
      el('div.rep-winner__main', {}, [
        el('span.rep-winner__label', {
          text: state.completed ? '🎉 آخرین نمایندهٔ این دور' : 'آخرین نمایندهٔ این دور',
        }),
        el('strong.rep-winner__name', { text: state.lastSelected.studentName }),
      ]),
      el('span.rep-winner__date', { text: faDateTime(state.lastSelected.createdAt) }),
    ]);
  }

  function hero() {
    const complete = state.completed;
    const noStudents = state.totalStudents === 0;
    const buttonLabel = complete ? 'شروع دور جدید' : noStudents ? 'دانش‌آموزی ثبت نشده' : 'انتخاب نماینده بعدی';
    const drawButton = button(buttonLabel, {
      kind: 'amber',
      icon: complete ? '🔄' : '🎲',
      disabled: busy || noStudents,
      onClick: () => {
        if (complete) void startNextCycle();
        else void draw();
      },
    });
    drawButton.classList.add('rep-hero__draw');

    const progressWidth = `${Math.max(0, Math.min(100, state.percent))}%`;

    return el('section.card.rep-hero', {}, [
      el('div.rep-hero__top', {}, [
        el('span.rep-hero__eyebrow', { text: `👑 دور ${fa(state.cycle)}` }),
        el(`span.rep-hero__state${complete ? '.is-done' : ''}`, {
          text: complete ? '✅ دور تکمیل شد' : `${fa(state.remainingCount)} نفر باقی مانده`,
        }),
      ]),
      el('h2.rep-hero__title', {
        text: complete ? 'همهٔ دانش‌آموزان این دور نماینده شدند' : 'نمایندهٔ بعدی کلاس را انتخاب کن',
      }),
      el('p.rep-hero__hint', {
        text: complete
          ? 'برای ادامه، یک دور تازه شروع کنید؛ تاریخچهٔ دوره‌های قبل حفظ می‌شود.'
          : 'هر دانش‌آموز در هر دور فقط یک بار شانس انتخاب دارد.',
      }),
      winnerBlock(),
      el('div.rep-hero__draw-wrap', {}, [drawButton]),
      el('div.rep-progress', {}, [
        el('div.rep-progress__meta', {}, [
          el('span', { text: `پیشرفت دور ${fa(state.cycle)}` }),
          el('strong', { text: `${fa(state.percent)}٪` }),
        ]),
        el('div.rep-progress__track', { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(state.percent), 'aria-label': 'پیشرفت نماینده‌های این دور' }, [
          el('span.rep-progress__fill', { style: { width: progressWidth } }),
        ]),
        el('div.rep-progress__meta.rep-progress__meta--small', {}, [
          el('span', { text: `${fa(state.selectedCount)} از ${fa(state.totalStudents)} انتخاب‌شده` }),
          el('span', { text: `${fa(state.remainingCount)} باقی‌مانده` }),
        ]),
      ]),
      el('div.rep-hero__actions', {}, [
        button('لغو آخرین انتخاب', {
          kind: 'ghost',
          icon: '↩️',
          disabled: busy || state.selectedCount === 0,
          onClick: () => void undoLast(),
        }),
        !complete && state.selectedCount > 0
          ? button('شروع دور بعد', {
            kind: 'ghost',
            icon: '⏭️',
            disabled: busy,
            onClick: () => void startNextCycle({ force: true }),
          })
          : null,
        state.history.length > 0
          ? button('ریست تاریخچه', {
            kind: 'ghost',
            icon: '🗑️',
            disabled: busy,
            onClick: () => void resetHistory(),
          })
          : null,
      ]),
    ]);
  }

  function stats() {
    return grid('grid--stats', [
      statCard({ label: 'کل دانش‌آموزان', value: fa(state.totalStudents), icon: '🧑‍🎓' }),
      statCard({ label: 'نماینده‌شده در این دور', value: fa(state.selectedCount), kind: 'ok', icon: '✅' }),
      statCard({ label: 'باقی‌مانده', value: fa(state.remainingCount), kind: state.remainingCount ? 'warn' : 'ok', icon: '⏳' }),
      statCard({ label: 'پیشرفت دور', value: `${fa(state.percent)}٪`, icon: '📈' }),
    ]);
  }

  function statusCard() {
    const search = el('input', {
      id: 'rep-search',
      type: 'search',
      value: searchTerm,
      placeholder: 'جست‌وجوی نام دانش‌آموز…',
      autocomplete: 'off',
      'aria-label': 'جست‌وجوی دانش‌آموز در فهرست نماینده‌ها',
    });
    const hint = el('p.small.muted');
    const list = el('div.rep-students');

    const cards = state.students.map((student) => {
      const meta = [];
      if (student.selected) meta.push('این دور');
      if (student.timesSelected > 1) meta.push(`${fa(student.timesSelected)} بار`);
      const node = el(`div.rep-student${student.selected ? '.is-selected' : ''}`, {
        dataset: { name: student.name },
        title: student.lastSelectedAt
          ? `آخرین انتخاب: ${faDateTime(student.lastSelectedAt)}`
          : 'هنوز نماینده نشده است',
      }, [
        el('span.rep-student__mark', { text: student.selected ? '✅' : '⏳', 'aria-hidden': 'true' }),
        el('span.rep-student__name', { text: student.name }),
        meta.length ? el('span.rep-student__meta', { text: meta.join(' · ') }) : null,
      ]);
      list.appendChild(node);
      return node;
    });

    function applySearch() {
      const visible = cards.filter((node) => matches(node.dataset.name, search.value)).length;
      for (const node of cards) node.hidden = !matches(node.dataset.name, search.value);
      hint.textContent = state.totalStudents
        ? `نمایش ${fa(visible)} از ${fa(state.totalStudents)} دانش‌آموز`
        : 'هنوز دانش‌آموزی به این لیگ اضافه نشده است.';
    }
    search.addEventListener('input', () => {
      searchTerm = search.value;
      applySearch();
    });
    applySearch();

    return card({ title: 'وضعیت دانش‌آموزان این دور', icon: '🧑‍🏫' }, [
      el('p.small.muted', { text: 'دانش‌آموزانی که در این دور انتخاب شده‌اند با ✅ مشخص می‌شوند.' }),
      search,
      hint,
      list,
    ]);
  }

  function historyCard() {
    if (state.history.length === 0) {
      return card({ title: 'تاریخچهٔ نماینده‌ها', icon: '📜' }, [
        el('p.small.muted', { text: 'هنوز نماینده‌ای انتخاب نشده است. اولین انتخاب را انجام دهید.' }),
      ]);
    }

    const cycleMeta = new Map((state.cycles ?? []).map((cycle) => [cycle.cycle, cycle]));
    const groups = new Map();
    for (const item of state.history) {
      if (!groups.has(item.cycle)) groups.set(item.cycle, []);
      groups.get(item.cycle).push(item);
    }

    const container = el('div.rep-history');
    for (const [cycle, items] of [...groups.entries()].sort((a, b) => b[0] - a[0])) {
      const meta = cycleMeta.get(cycle);
      container.appendChild(el('section.rep-cycle', {}, [
        el('header.rep-cycle__head', {}, [
          el('strong', { text: `دور ${fa(cycle)}${cycle === state.cycle ? ' · جاری' : ''}` }),
          el('span.small.muted', {
            text: [
              `${fa(items.length)} نماینده`,
              meta?.startedAt ? faDateTime(meta.startedAt) : '',
            ].filter(Boolean).join(' · '),
          }),
        ]),
        ...items.map((item) => el('div.rep-history__row', {}, [
          el('span.rep-history__name', { text: item.studentName }),
          el('span.small.muted', { text: faDateTime(item.createdAt) }),
        ])),
      ]));
    }

    return card({
      title: 'تاریخچهٔ نماینده‌ها',
      icon: '📜',
      actions: [button('ریست', { kind: 'ghost', icon: '🗑️', onClick: () => void resetHistory() })],
    }, [container]);
  }

  function render() {
    if (!state) return;
    setTopbarTitle('نماینده کلاس');
    body.replaceChildren(
      pageHead({
        icon: '👑',
        title: 'نماینده کلاس',
        subtitle: `${leagueName} · انتخاب منصفانه و بدون تکرار`,
        actions: [
          el('a.btn.btn--soft', { href: `#/teacher/league/${leagueId}/raffle`, text: '🎲 قرعه‌کشی' }),
          el('a.btn.btn--ghost', { href: `#/teacher/league/${leagueId}`, text: '↩️ لیگ' }),
          backToWorkbench(),
        ],
      }),
      hero(),
      stats(),
      grid('grid--two', [statusCard(), historyCard()]),
    );
  }

  await load();
  return undefined;
}
