/** Rounds a value to `digits` decimals; missing or non-finite input yields `null`. */
export function roundTo(value, digits = 2) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const factor = 10 ** digits;
  return Math.round(number * factor) / factor;
}
