const ARABIC_INDIC = /[\u0660-\u0669]/g;
const EXTENDED_ARABIC_INDIC = /[\u06F0-\u06F9]/g;

/** Converts Persian/Arabic digits inside a string to ASCII digits. */
export function toAsciiDigits(input) {
  return String(input ?? '')
    .replace(EXTENDED_ARABIC_INDIC, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(ARABIC_INDIC, (d) => String(d.charCodeAt(0) - 0x0660));
}

/** Converts ASCII digits inside a string to Persian digits. */
export function toPersianDigits(input) {
  return String(input ?? '').replace(/[0-9]/g, (d) => String.fromCharCode(0x06f0 + Number(d)));
}

/**
 * Normalizes Persian text for search and comparison:
 * unifies Arabic Yeh/Kaf, drops ZWNJ and bidi marks, removes diacritics, collapses spaces.
 */
export function normalizeFa(input) {
  if (typeof input !== 'string') return '';
  return input
    .replace(/[\u064A\u0649]/g, '\u06CC')
    .replace(/\u0643/g, '\u06A9')
    .replace(/[\u0623\u0625\u0622]/g, '\u0627')
    .replace(/\u0629/g, '\u0647')
    .replace(/[\u064B-\u0652\u0670\u0640]/g, '')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Deterministic name comparison (Persian aware) used to break ranking ties. */
export function compareNames(a, b) {
  const na = normalizeFa(a);
  const nb = normalizeFa(b);
  if (na !== nb) {
    const cmp = na.localeCompare(nb, 'fa');
    if (cmp !== 0) return cmp;
  }
  const ra = String(a ?? '');
  const rb = String(b ?? '');
  if (ra === rb) return 0;
  return ra < rb ? -1 : 1;
}

/** True when `haystack` contains `needle` after Persian normalization. */
export function matchesFa(haystack, needle) {
  const n = normalizeFa(needle);
  if (!n) return true;
  return normalizeFa(haystack).includes(n);
}
