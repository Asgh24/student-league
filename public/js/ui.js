import { clear, el, mount } from './dom.js';

/* ------------------------------------------------------------------ toasts */

const TOAST_TTL = 4200;

export function toast(message, kind = 'info') {
  const host = document.getElementById('toasts');
  if (!host) return null;
  const node = el(`div.toast.toast--${kind}`, { role: 'status' });
  node.appendChild(el('span', { text: message }));
  host.appendChild(node);
  const timer = setTimeout(() => node.remove(), TOAST_TTL);
  node.addEventListener('click', () => {
    clearTimeout(timer);
    node.remove();
  });
  return node;
}

export const notify = {
  ok: (message) => toast(message, 'ok'),
  error: (message) => toast(message, 'bad'),
  warn: (message) => toast(message, 'warn'),
  info: (message) => toast(message, 'info'),
};

/* ------------------------------------------------------------------- modal */

function focusables(root) {
  return [...root.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(
    (node) => !node.disabled && node.offsetParent !== null,
  );
}

/**
 * Opens a modal dialog. `body` is a DOM node (never a raw string), so user
 * supplied content is always inserted as text.
 */
export function openModal({ title, body, actions = [], onClose = null, labelledBy = 'modal-title' }) {
  const root = document.getElementById('modal-root') ?? document.body;
  const previousFocus = document.activeElement;

  const titleId = labelledBy;
  const content = el('div.modal', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId });
  if (title) content.appendChild(el('h2.modal__title', { id: titleId, text: title }));
  if (body) content.appendChild(body);

  const footer = el('div.modal__actions');
  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKeyDown);
    if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
    if (onClose) onClose();
  };

  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = focusables(content);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  for (const action of actions) {
    const button = el(`button.btn${action.kind ? `.btn--${action.kind}` : ''}`, {
      type: 'button',
      text: action.label,
      onclick: () => {
        if (action.onClick) action.onClick({ close, button });
        else close();
      },
    });
    footer.appendChild(button);
  }
  if (actions.length === 0) {
    footer.appendChild(el('button.btn.btn--ghost', { type: 'button', text: 'بستن', onclick: close }));
  }
  content.appendChild(footer);

  const backdrop = el('div.modal-backdrop', {
    onclick: (event) => {
      if (event.target === backdrop) close();
    },
  });
  backdrop.appendChild(content);
  root.appendChild(backdrop);
  document.addEventListener('keydown', onKeyDown);

  const items = focusables(content);
  if (items.length) items[0].focus();
  else content.focus();

  /**
   * Replaces the dialog's title/body while keeping the action buttons (and their
   * listeners) alive, then moves focus back inside. Async dialogs use this
   * instead of `content.replaceChildren(...)`, which would delete the footer and
   * leave focus on <body>.
   */
  const setContent = (nodes) => {
    content.replaceChildren(...nodes, footer);
    const updated = focusables(content);
    if (updated.length) updated[0].focus();
    else content.focus();
  };

  return { close, content, setContent };
}

/** Promise based confirmation dialog. Resolves to `true` when confirmed. */
export function confirmDialog({ title = 'تأیید عملیات', message, confirmLabel = 'تأیید', cancelLabel = 'انصراف', danger = false }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const modal = openModal({
      title,
      body: el('p.muted-2', { text: message }),
      actions: [
        {
          label: cancelLabel,
          kind: 'ghost',
          onClick: ({ close }) => {
            finish(false);
            close();
          },
        },
        {
          label: confirmLabel,
          kind: danger ? 'danger' : undefined,
          onClick: ({ close }) => {
            finish(true);
            close();
          },
        },
      ],
      onClose: () => finish(false),
    });
    void modal;
  });
}

/**
 * Small form dialog. `fields` is a list of `{ name, label, type, value, options,
 * required, placeholder, min, max }`; resolves with the collected values or null.
 */
export function formDialog({ title, fields = [], submitLabel = 'ذخیره', cancelLabel = 'انصراف', description = '' }) {
  return new Promise((resolve) => {
    const inputs = new Map();
    const form = el('form', { class: 'form-dialog', novalidate: 'true' });

    if (description) form.appendChild(el('p.muted.small', { text: description }));

    for (const field of fields) {
      const id = `f-${field.name}`;
      const wrapper = el('div.field');
      wrapper.appendChild(el('label', { for: id, text: field.label }));
      let input;
      if (field.type === 'select') {
        input = el('select', { id, name: field.name });
        for (const option of field.options ?? []) {
          input.appendChild(el('option', { value: option.value, text: option.label, selected: String(option.value) === String(field.value) }));
        }
      } else if (field.type === 'textarea') {
        input = el('textarea', { id, name: field.name, placeholder: field.placeholder ?? '', value: field.value ?? '' });
      } else {
        input = el('input', {
          id,
          name: field.name,
          type: field.type ?? 'text',
          value: field.value ?? '',
          placeholder: field.placeholder ?? '',
          min: field.min,
          max: field.max,
          step: field.step,
          autocomplete: field.autocomplete ?? 'off',
        });
      }
      if (field.required) input.required = true;
      inputs.set(field.name, input);
      wrapper.appendChild(input);
      if (field.hint) wrapper.appendChild(el('span.muted.small', { text: field.hint }));
      form.appendChild(wrapper);
    }

    let settled = false;
    const modal = openModal({
      title,
      body: form,
      actions: [
        {
          label: cancelLabel,
          kind: 'ghost',
          onClick: ({ close }) => {
            settled = true;
            close();
            resolve(null);
          },
        },
        {
          label: submitLabel,
          onClick: ({ close }) => {
            const values = {};
            let valid = true;
            for (const [name, input] of inputs) {
              values[name] = input.value;
              if (input.required && !String(input.value).trim()) {
                valid = false;
                input.style.borderColor = '#dc2626';
              }
            }
            if (!valid) return;
            settled = true;
            close();
            resolve(values);
          },
        },
      ],
      onClose: () => {
        if (!settled) resolve(null);
      },
    });

    form.addEventListener('submit', (event) => event.preventDefault());
    const items = focusables(modal.content);
    if (items.length) items[0].focus();
  });
}

export function emptyState({ icon = '📭', title, hint = '' }) {
  const node = el('div.empty');
  node.appendChild(el('span.empty__icon', { text: icon, 'aria-hidden': 'true' }));
  node.appendChild(el('p', { text: title }));
  if (hint) node.appendChild(el('p.small.muted', { text: hint }));
  return node;
}

export function statCard({ label, value, kind = '', icon = '' }) {
  const node = el(`div.stat${kind ? `.stat--${kind}` : ''}`);
  node.appendChild(el('div.stat__value', { text: value }));
  node.appendChild(el('div.stat__label', { text: icon ? `${icon} ${label}` : label }));
  return node;
}

/** Replaces a container with a loading placeholder while a request is running. */
export function withLoading(container, render) {
  mount(container, el('div.empty', {}, [el('span.empty__icon', { text: '⏳', 'aria-hidden': 'true' }), el('p', { text: 'در حال بارگذاری…' })]));
  return Promise.resolve(render()).catch((error) => {
    mount(container, emptyState({ icon: '⚠️', title: 'بارگذاری داده‌ها ناموفق بود', hint: error?.message ?? '' }));
    throw error;
  });
}

export { clear, el, mount };
