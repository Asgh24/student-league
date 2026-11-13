/**
 * Colour palette switching.
 *
 * The default palette is "ember" (warm orange with near-black ink). The
 * original violet theme and a cool "ocean" theme stay available. The choice is
 * stored per browser in `localStorage`; `index.html` applies it before the
 * stylesheets load so there is no flash of the wrong palette.
 */

import { el } from './dom.js';
import { openModal } from './ui.js';

export const PALETTE_STORAGE_KEY = 'scl.palette';
export const DEFAULT_PALETTE = 'ember';

export const PALETTES = [
  {
    id: 'ember',
    label: 'نارنجی و مشکی',
    hint: 'پیش‌فرض',
    colors: ['#ea580c', '#f59e0b', '#1c1917'],
  },
  {
    id: 'violet',
    label: 'بنفش و صورتی',
    hint: 'تم قبلی',
    colors: ['#7c3aed', '#a855f7', '#ec4899'],
  },
  {
    id: 'ocean',
    label: 'آبی و فیروزه‌ای',
    hint: 'خنک و آرام',
    colors: ['#0284c7', '#0ea5e9', '#0f172a'],
  },
];

const PALETTE_IDS = new Set(PALETTES.map((palette) => palette.id));

/** Live swatch groups, kept so a change in the dialog also repaints settings. */
const swatchSyncers = new Set();

function syncAllSwatches() {
  for (const entry of swatchSyncers) {
    if (!entry.node.isConnected) {
      swatchSyncers.delete(entry);
      continue;
    }
    entry.sync();
  }
}

export function normalizePalette(value) {
  return PALETTE_IDS.has(value) ? value : DEFAULT_PALETTE;
}

function storageOrNull(storage) {
  if (storage) return storage;
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Reads the saved palette, falling back to the default. */
export function storedPalette(storage = null) {
  const store = storageOrNull(storage);
  if (!store) return DEFAULT_PALETTE;
  try {
    return normalizePalette(store.getItem(PALETTE_STORAGE_KEY));
  } catch {
    return DEFAULT_PALETTE;
  }
}

/** Palette currently painted on the document. */
export function currentPalette() {
  if (typeof document === 'undefined') return DEFAULT_PALETTE;
  return normalizePalette(document.documentElement?.dataset?.palette);
}

/**
 * Applies a palette to the root element and remembers it. Invalid ids fall back
 * to the default palette. Pass `persist: false` when restoring on startup.
 */
export function applyPalette(id, { persist = true, storage = null } = {}) {
  const palette = normalizePalette(id);
  if (typeof document !== 'undefined') document.documentElement.dataset.palette = palette;
  if (persist) {
    const store = storageOrNull(storage);
    if (store) {
      try {
        store.setItem(PALETTE_STORAGE_KEY, palette);
      } catch {
        /* private mode / disabled storage: the palette still applies for this page */
      }
    }
  }
  syncAllSwatches();
  return palette;
}

/** Restores the saved palette without rewriting storage. */
export function initPalette(storage = null) {
  return applyPalette(storedPalette(storage), { persist: false, storage });
}

/** Swatch picker used by the top bar dialog and the settings page. */
export function paletteSwatches({ onChange = null } = {}) {
  const buttons = new Map();
  const node = el('div.palette-grid', { role: 'radiogroup', 'aria-label': 'پالت رنگی سامانه' });

  function sync() {
    const active = currentPalette();
    for (const [id, button] of buttons) {
      const selected = id === active;
      button.classList.toggle('is-active', selected);
      button.setAttribute('aria-checked', String(selected));
    }
  }

  for (const palette of PALETTES) {
    const button = el('button.palette-swatch', {
      type: 'button',
      role: 'radio',
      'aria-checked': String(palette.id === currentPalette()),
      'data-palette-id': palette.id,
      onclick: () => {
        applyPalette(palette.id);
        sync();
        if (onChange) onChange(palette.id);
      },
    }, [
      el('span.palette-swatch__colors', { 'aria-hidden': 'true' }, palette.colors.map((color) => (
        el('span.palette-swatch__dot', { style: { background: color } })
      ))),
      el('span.palette-swatch__label', { text: palette.label }),
      palette.hint ? el('span.palette-swatch__hint', { text: palette.hint }) : null,
      el('span.palette-swatch__check', { text: '✓', 'aria-hidden': 'true' }),
    ]);
    buttons.set(palette.id, button);
    node.appendChild(button);
  }

  sync();
  swatchSyncers.add({ node, sync });
  return node;
}

/** Opens the palette picker from the top bar. */
export function openPaletteDialog() {
  return openModal({
    title: '🎨 پالت رنگی سامانه',
    body: el('div', {}, [
      el('p.muted.small', { text: 'پالت دلخواه را انتخاب کنید. انتخاب شما فقط در همین مرورگر ذخیره می‌شود.' }),
      paletteSwatches(),
    ]),
    actions: [{ label: 'بستن', kind: 'ghost' }],
  });
}
