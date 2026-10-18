/** Persian text normalization used by the client side quick search. */

export function normalizeFa(input) {
  if (typeof input !== 'string') return '';
  return input
    .replace(/[\u064A\u0649]/g, '\u06CC')
    .replace(/\u0643/g, '\u06A9')
    .replace(/[\u0623\u0625\u0622]/g, '\u0627')
    .replace(/\u0629/g, '\u0647')
    .replace(/[\u064B-\u0652\u0670\u0640]/g, '')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')
    .replace(/[\u00A0\s]+/g, ' ')
    .trim()
    .toLowerCase();
}

export function matches(haystack, needle) {
  const query = normalizeFa(needle);
  if (!query) return true;
  return normalizeFa(haystack).includes(query);
}
