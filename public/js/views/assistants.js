import { api } from '../api.js';
import { el } from '../dom.js';
import { errorMessage } from '../format.js';
import { renderView, setTopbarTitle } from '../shell.js';
import { confirmDialog, emptyState, notify, openModal } from '../ui.js';
import { button, card, faDateTime, pageHead } from './common.js';

const PERMISSION_META_FALLBACK = [
  { key: 'scores', label: 'لیگ انفرادی و امتیازها', icon: '🏆' },
];

function permissionPicker(meta, selected = []) {
  const selectedSet = new Set(selected);
  const inputs = new Map();
  const grid = el('div.perm-grid');
  for (const item of meta) {
    const input = el('input', { type: 'checkbox', value: item.key, checked: selectedSet.has(item.key) });
    inputs.set(item.key, input);
    grid.appendChild(el('label.checkbox', {}, [input, el('span', { text: `${item.icon ?? ''} ${item.label}`.trim() })]));
  }
  return {
    node: grid,
    values: () => [...inputs].filter(([, input]) => input.checked).map(([key]) => key),
  };
}

export async function renderAssistants() {
  setTopbarTitle('همیاران سایت');
  const body = el('div');
  renderView([pageHead({
    icon: '🤝',
    title: 'همیاران سایت',
    subtitle: 'دانش‌آموزانی که به عنوان همیار وارد پنل معلم می‌شوند',
    actions: [button('همیار جدید', { icon: '➕', onClick: () => openAddDialog() })],
  }), body]);
  body.appendChild(el('div.empty', {}, [el('span.empty__icon', { text: '⏳' }), el('p', { text: 'در حال بارگذاری…' })]));

  const load = async () => {
    let permissions = PERMISSION_META_FALLBACK;
    let assistants = [];
    let leagues = [];
    let log = [];
    try { permissions = (await api.get('/assistants/permissions')).items ?? permissions; } catch { /* keep fallback */ }
    try { assistants = (await api.get('/assistants')).items ?? []; } catch (error) { notify.error(errorMessage(error)); }
    try { leagues = (await api.get('/leagues')).items ?? []; } catch { leagues = []; }
    try { log = (await api.get('/assistants/log')).items ?? []; } catch { log = []; }

    body.textContent = '';
    body.appendChild(renderBody({ permissions, assistants, leagues, log, reload: load }));
  };

  let openAddDialog = () => {};
  function renderBody({ permissions, assistants, leagues, log, reload }) {
    const wrap = el('div.grid', { style: { gap: '14px' } });

    if (leagues.length === 0) {
      wrap.appendChild(emptyState({ icon: '🏁', title: 'ابتدا یک لیگ بسازید', hint: 'همیار به یک لیگ خاص متصل است.' }));
      return wrap;
    }

    openAddDialog = async () => {
      await openAssistantDialog({ permissions, leagues, reload });
    };

    wrap.appendChild(card({ title: 'همیاران ثبت‌شده', icon: '🤝' }, [
      assistants.length === 0
        ? emptyState({ icon: '🧑‍🎓', title: 'هنوز همیاری ثبت نشده است', hint: 'با «همیار جدید» یک دانش‌آموز را انتخاب کنید.' })
        : el('div.assistant-list', {}, assistants.map((item) => assistantCard(item, permissions, reload))),
    ]));

    wrap.appendChild(card({ title: 'گزارش تغییرات (۷ روز گذشته)', icon: '📜' }, [
      log.length === 0
        ? emptyState({ icon: '✨', title: 'هنوز تغییری ثبت نشده است', hint: 'با ورود همیار و انجام تغییرات، فهرست اینجا ظاهر می‌شود.' })
        : el('div.log-list', {}, log.map((row) => el('div.log-item', {}, [
          el('div.log-item__head', {}, [
            el('strong', { text: row.assistantName || 'همیار' }),
            el('span.chip.chip--muted', { text: row.action }),
            el('span.small.muted', { text: faDateTime(row.createdAt) }),
          ]),
          el('div.small.muted', { text: row.detail || '', title: row.detail || '' }),
        ]))),
    ]));

    return wrap;
  }

  await load();
  return undefined;
}

function assistantCard(item, permissions, reload) {
  const permissionLabels = new Map(permissions.map((p) => [p.key, p]));
  return el('div.assistant-row', {}, [
    el('div.assistant-row__main', {}, [
      el('div', {}, [
        el('strong', { text: item.displayName || item.username }),
        el('span.chip.chip--muted', { text: item.username }),
        item.studentName ? el('span.chip', { text: `دانش‌آموز: ${item.studentName}` }) : null,
        item.active ? el('span.chip.chip--ok', { text: 'فعال' }) : el('span.chip.chip--bad', { text: 'لغو شده' }),
      ]),
      el('div.small.muted', { text: `لیگ: ${item.leagueName}` }),
      el('div.row', { style: { flexWrap: 'wrap', gap: '4px', marginTop: '4px' } },
        (item.permissions || []).map((key) => el('span.chip.chip--soft', { text: permissionLabels.get(key)?.label ?? key }))),
    ]),
    el('div.row', { style: { gap: '6px', flexWrap: 'wrap' } }, [
      button('دسترسی‌ها', { kind: 'ghost', icon: '☑️', onClick: () => editPermissions(item, permissions, reload) }),
      button('گذرواژه', { kind: 'ghost', icon: '🔑', onClick: () => resetPassword(item, reload) }),
      item.active ? button('لغو دسترسی', { kind: 'danger', icon: '✕', onClick: () => revoke(item, reload) }) : null,
    ]),
  ]);
}

async function openAssistantDialog({ permissions, leagues, reload }) {
  let students = [];
  const leagueSelect = el('select', { required: 'true' });
  for (const league of leagues) {
    leagueSelect.appendChild(el('option', { value: league.id, text: league.name }));
  }
  const studentSelect = el('select', {});
  const loadStudents = async () => {
    studentSelect.replaceChildren(el('option', { value: '', text: 'در حال بارگذاری…' }));
    try {
      const data = await api.get(`/leagues/${leagueSelect.value}/students`);
      students = data.items ?? [];
    } catch {
      students = [];
    }
    studentSelect.replaceChildren(el('option', { value: '', text: 'بدون اتصال به دانش‌آموز' }));
    for (const student of students) {
      studentSelect.appendChild(el('option', { value: student.id, text: student.name }));
    }
  };
  leagueSelect.addEventListener('change', () => void loadStudents());
  await loadStudents();

  const displayNameInput = el('input', { type: 'text', placeholder: 'در صورت خالی، نام دانش‌آموز' });
  const usernameInput = el('input', { type: 'text', required: 'true', autocomplete: 'off' });
  const passwordInput = el('input', { type: 'password', required: 'true', autocomplete: 'new-password' });
  const picker = permissionPicker(permissions, []);

  const form = el('div.form-dialog', {}, [
    el('div.field', {}, [el('label', { text: 'لیگ' }), leagueSelect]),
    el('div.field', {}, [el('label', { text: 'دانش‌آموز (اختیاری)' }), studentSelect]),
    el('div.field', {}, [el('label', { text: 'نام نمایشی' }), displayNameInput]),
    el('div.field', {}, [el('label', { text: 'نام کاربری' }), usernameInput]),
    el('div.field', {}, [el('label', { text: 'گذرواژه' }), passwordInput]),
    el('div.field', {}, [el('label', { text: 'دسترسی‌ها' }), picker.node]),
  ]);

  let settled = false;
  const modal = openModal({
    title: 'همیار جدید',
    body: form,
    actions: [
      { label: 'انصراف', kind: 'ghost', onClick: ({ close }) => { settled = true; close(); } },
      {
        label: 'ذخیره',
        onClick: async ({ close, button }) => {
          if (!usernameInput.value.trim() || !passwordInput.value.trim()) {
            notify.error('نام کاربری و گذرواژه الزامی هستند');
            return;
          }
          button.disabled = true;
          try {
            await api.post('/assistants', {
              leagueId: Number(leagueSelect.value),
              studentId: studentSelect.value ? Number(studentSelect.value) : undefined,
              displayName: displayNameInput.value.trim(),
              username: usernameInput.value.trim(),
              password: passwordInput.value,
              permissions: picker.values(),
            });
            notify.ok('همیار افزوده شد');
            settled = true;
            close();
            await reload();
          } catch (error) {
            notify.error(errorMessage(error));
          } finally {
            button.disabled = false;
          }
        },
      },
    ],
    onClose: () => {
      if (!settled) settled = true;
    },
  });
  return modal;
}

async function editPermissions(item, permissions, reload) {
  const picker = permissionPicker(permissions, item.permissions || []);
  const form = el('div', {}, [picker.node]);
  let settled = false;
  openModal({
    title: `دسترسی‌ها — ${item.displayName || item.username}`,
    body: form,
    actions: [
      { label: 'انصراف', kind: 'ghost', onClick: ({ close }) => { settled = true; close(); } },
      {
        label: 'ذخیره',
        onClick: async ({ close, button }) => {
          button.disabled = true;
          try {
            await api.patch(`/assistants/${item.id}`, { permissions: picker.values() });
            notify.ok('دسترسی‌ها ذخیره شد');
            settled = true;
            close();
            await reload();
          } catch (error) {
            notify.error(errorMessage(error));
          } finally {
            button.disabled = false;
          }
        },
      },
    ],
    onClose: () => {
      if (!settled) settled = true;
    },
  });
}

async function resetPassword(item, reload) {
  const values = await (async () => {
    const { formDialog } = await import('../ui.js');
    return formDialog({
      title: `گذرواژه جدید — ${item.displayName || item.username}`,
      submitLabel: 'ذخیره',
      fields: [{ name: 'password', label: 'گذرواژه جدید', type: 'password', required: true }],
    });
  })();
  if (!values) return;
  try {
    await api.post(`/assistants/${item.id}/password`, { password: values.password });
    notify.ok('گذرواژه ذخیره شد');
    await reload();
  } catch (error) {
    notify.error(errorMessage(error));
  }
}

async function revoke(item, reload) {
  const agreed = await confirmDialog({
    title: 'لغو دسترسی',
    message: `دسترسی «${item.displayName || item.username}» لغو شود؟ گزارش تغییرات او باقی می‌ماند.`,
    confirmLabel: 'لغو دسترسی',
    danger: true,
  });
  if (!agreed) return;
  try {
    await api.del(`/assistants/${item.id}`);
    notify.ok('دسترسی لغو شد');
    await reload();
  } catch (error) {
    notify.error(errorMessage(error));
  }
}
