/**
 * «جای‌گیری» — the classroom seating plan.
 *
 * The teacher can place students by hand (pick a student, then pick a seat) or
 * let the app shuffle the class at random. Every change is saved right away.
 */

import { api } from '../api.js';
import { el } from '../dom.js';
import { errorMessage } from '../format.js';
import { renderView, setLeaguePill, setTopbarTitle } from '../shell.js';
import { setLeagueId } from '../store.js';
import { confirmDialog, emptyState, notify } from '../ui.js';
import { backToWorkbench, button, card, fa, grid, loadingNode, pageHead } from './common.js';

export async function renderSeating({ params }) {
  const leagueId = Number(params.id);
  setTopbarTitle('جای‌گیری دانش‌آموزان');
  setLeagueId(leagueId);
  const body = el('div', {}, [loadingNode()]);
  renderView([body]);

  let plan = { layout: { rows: 4, cols: 6 }, seats: [], students: [], unassigned: [] };
  let held = null;
  let saving = false;

  const status = el('p.small.muted');

  function seatAt(row, col) {
    return plan.seats.find((seat) => seat.row === row && seat.col === col) ?? null;
  }

  function seatOfStudent(studentId) {
    return plan.seats.find((seat) => seat.studentId === studentId) ?? null;
  }

  function studentName(studentId) {
    return plan.students.find((student) => student.id === studentId)?.name ?? '';
  }

  async function load() {
    try {
      const [seating, league] = await Promise.all([
        api.get(`/leagues/${leagueId}/seating`),
        api.get(`/leagues/${leagueId}`),
      ]);
      plan = seating;
      setLeaguePill({ name: league.league?.name ?? '' });
    } catch (error) {
      body.replaceChildren(emptyState({ icon: '⚠️', title: 'دریافت چیدمان ناموفق بود', hint: errorMessage(error) }));
      return;
    }
    paint();
  }

  /** Sends the whole plan to the server and adopts the answer. */
  async function persist(seats, rows, cols, message = 'ذخیره شد') {
    if (saving) return;
    saving = true;
    status.textContent = '⏳ در حال ذخیره…';
    paint();
    try {
      plan = await api.put(`/leagues/${leagueId}/seating`, {
        rows,
        cols,
        seats: seats.map((seat) => ({ row: seat.row, col: seat.col, studentId: seat.studentId })),
      });
      status.textContent = `✅ ${message}`;
    } catch (error) {
      status.textContent = `⚠️ ${errorMessage(error)}`;
      notify.error(errorMessage(error));
    } finally {
      saving = false;
    }
    paint();
  }

  async function onSeatClick(row, col) {
    const target = seatAt(row, col);

    if (held !== null) {
      const studentId = held;
      const heldSeat = seatOfStudent(studentId);
      held = null;
      if (target && target.studentId === studentId) {
        paint();
        return;
      }
      const seats = plan.seats
        .filter((seat) => seat.studentId !== studentId && seat.studentId !== target?.studentId)
        .map((seat) => ({ row: seat.row, col: seat.col, studentId: seat.studentId, name: seat.name }));
      if (target && heldSeat) {
        // the two students swap places
        seats.push({ row: heldSeat.row, col: heldSeat.col, studentId: target.studentId, name: target.name });
      }
      seats.push({ row, col, studentId, name: studentName(studentId) });
      await persist(seats, plan.layout.rows, plan.layout.cols, 'جای دانش‌آموز ذخیره شد');
      return;
    }

    if (target) {
      const seats = plan.seats
        .filter((seat) => seat.studentId !== target.studentId)
        .map((seat) => ({ row: seat.row, col: seat.col, studentId: seat.studentId, name: seat.name }));
      await persist(seats, plan.layout.rows, plan.layout.cols, `${target.name} از صندلی برداشته شد`);
    }
  }

  function onStudentClick(studentId) {
    held = held === studentId ? null : studentId;
    paint();
  }

  async function changeLayout(rows, cols) {
    const nextRows = Math.max(1, Math.min(20, Number(rows) || plan.layout.rows));
    const nextCols = Math.max(1, Math.min(20, Number(cols) || plan.layout.cols));
    const dropped = plan.seats.filter((seat) => seat.row >= nextRows || seat.col >= nextCols).length;
    const seats = plan.seats
      .filter((seat) => seat.row < nextRows && seat.col < nextCols)
      .map((seat) => ({ row: seat.row, col: seat.col, studentId: seat.studentId, name: seat.name }));
    await persist(
      seats,
      nextRows,
      nextCols,
      dropped ? `چیدمان ذخیره شد (${fa(dropped)} دانش‌آموز بی‌جا شد)` : 'چیدمان ذخیره شد',
    );
  }

  async function shuffle() {
    try {
      plan = await api.post(`/leagues/${leagueId}/seating/shuffle`, {});
      held = null;
      status.textContent = '✅ چیدمان تصادفی ساخته شد';
      notify.ok('چیدمان تصادفی انجام شد');
    } catch (error) {
      status.textContent = `⚠️ ${errorMessage(error)}`;
      notify.error(errorMessage(error));
    }
    paint();
  }

  async function clearAll() {
    const agreed = await confirmDialog({
      title: 'پاک کردن چیدمان',
      message: 'همهٔ صندلی‌ها خالی می‌شود. ادامه می‌دهید؟',
      confirmLabel: 'پاک کردن',
      danger: true,
    });
    if (!agreed) return;
    try {
      plan = await api.del(`/leagues/${leagueId}/seating`);
      held = null;
      status.textContent = '✅ چیدمان پاک شد';
    } catch (error) {
      status.textContent = `⚠️ ${errorMessage(error)}`;
      notify.error(errorMessage(error));
    }
    paint();
  }

  function layoutCard() {
    const rows = el('input', { id: 'seat-rows', type: 'number', min: 1, max: 20, value: plan.layout.rows });
    const cols = el('input', { id: 'seat-cols', type: 'number', min: 1, max: 20, value: plan.layout.cols });
    const apply = () => changeLayout(rows.value, cols.value);
    rows.addEventListener('change', apply);
    cols.addEventListener('change', apply);
    return card({ title: 'اندازهٔ کلاس', icon: '📐' }, [
      el('div.grid', { style: { gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))' } }, [
        el('div.field', {}, [el('label', { for: 'seat-rows', text: 'تعداد ردیف' }), rows]),
        el('div.field', {}, [el('label', { for: 'seat-cols', text: 'تعداد ستون' }), cols]),
      ]),
      el('p.small.muted', { text: 'با کم‌کردن ابعاد کلاس، دانش‌آموزانی که جایشان بیرون می‌ماند به فهرست «بدون جا» برمی‌گردند.' }),
    ]);
  }

  function classroomCard() {
    const { rows, cols } = plan.layout;
    const gridNode = el('div.seating__grid', { style: { gridTemplateColumns: `repeat(${cols}, minmax(64px, 1fr))` } });
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const seat = seatAt(row, col);
        gridNode.appendChild(el(`button.seat${seat ? '.seat--filled' : ''}`, {
          type: 'button',
          title: seat ? `${seat.name} — ردیف ${fa(row + 1)}، صندلی ${fa(col + 1)}` : `صندلی خالی ردیف ${fa(row + 1)}`,
          dataset: { row: String(row), col: String(col) },
          onclick: () => onSeatClick(row, col),
        }, [
          el('span.seat__name', { text: seat ? seat.name : 'خالی' }),
          el('span.seat__pos', { text: `ر${fa(row + 1)} · ص${fa(col + 1)}` }),
        ]));
      }
    }
    return card({ title: 'نمای کلاس', icon: '🪑' }, [
      el('div.seating__board', { text: '🧑‍🏫 تخته / میز معلم' }),
      gridNode,
      el('p.small.muted', { text: 'روی دانش‌آموز «بدون جا» کلیک کنید و بعد روی صندلی؛ برای برداشتن، روی صندلی پر کلیک کنید.' }),
    ]);
  }

  function unassignedCard() {
    const list = el('div.seating__list');
    if (plan.unassigned.length === 0) {
      list.appendChild(el('p.small.muted', { text: 'همهٔ دانش‌آموزان جا دارند. 🎉' }));
    }
    for (const student of plan.unassigned) {
      list.appendChild(el(`button.chip.chip--button${held === student.id ? '.chip--ok' : ''}`, {
        type: 'button',
        text: student.name,
        onclick: () => onStudentClick(student.id),
      }));
    }
    const seated = el('div.seating__list');
    for (const seat of plan.seats) {
      seated.appendChild(el(`button.chip.chip--button${held === seat.studentId ? '.chip--ok' : ''}`, {
        type: 'button',
        text: `${seat.name} · ر${fa(seat.row + 1)} ص${fa(seat.col + 1)}`,
        onclick: () => onStudentClick(seat.studentId),
      }));
    }
    return card({ title: 'دانش‌آموزان بدون جا', icon: '🧍' }, [
      list,
      el('p.small.muted', { text: `بدون جا: ${fa(plan.unassigned.length)} از ${fa(plan.students.length)}` }),
      el('h3.card__title', { text: 'نشسته‌ها' }),
      seated,
    ]);
  }

  function paint() {
    body.replaceChildren(
      pageHead({
        icon: '🪑',
        title: 'جای‌گیری دانش‌آموزان',
        subtitle: 'چیدمان صندلی‌ها به‌صورت دستی یا تصادفی',
        actions: [
          button('چیدمان تصادفی', { kind: 'soft', icon: '🎲', onClick: shuffle }),
          button('پاک کردن', { kind: 'danger', icon: '🧹', onClick: clearAll }),
          el('a.btn.btn--ghost', { href: `#/teacher/league/${leagueId}`, text: '↩️ لیگ' }),
          backToWorkbench(),
        ],
      }),
      grid('grid--stats', [
        el('div.stat', {}, [el('div.stat__value', { text: fa(plan.students.length) }), el('div.stat__label', { text: '🧑‍🎓 دانش‌آموز' })]),
        el('div.stat', {}, [el('div.stat__value', { text: fa(plan.seats.length) }), el('div.stat__label', { text: '🪑 نشسته' })]),
        el('div.stat', {}, [el('div.stat__value', { text: fa(plan.unassigned.length) }), el('div.stat__label', { text: '🧍 بدون جا' })]),
        el('div.stat', {}, [el('div.stat__value', { text: `${fa(plan.layout.rows)}×${fa(plan.layout.cols)}` }), el('div.stat__label', { text: '📐 ابعاد کلاس' })]),
      ]),
      status,
      grid('grid--two', [classroomCard(), unassignedCard()]),
      layoutCard(),
    );
  }

  await load();
  return undefined;
}
