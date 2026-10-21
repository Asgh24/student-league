import { toAsciiDigits } from './normalize.js';

const MOBILE_PATTERN = /^09\d{9}$/;

/**
 * Canonical Iranian mobile number, or `''` when the value cannot be read as
 * one. Accepts Persian/Arabic digits, spaces, dashes and +98/0098/98 prefixes
 * so a number typed on a phone is usually accepted as-is.
 */
export function normalizeMobile(value) {
  let text = toAsciiDigits(value).replace(/[\s\-().]/g, '');
  if (!text) return '';
  if (text.startsWith('+98')) text = `0${text.slice(3)}`;
  else if (text.startsWith('0098')) text = `0${text.slice(4)}`;
  else if (text.startsWith('98') && text.length === 12) text = `0${text.slice(2)}`;
  else if (/^9\d{9}$/.test(text)) text = `0${text}`;
  return MOBILE_PATTERN.test(text) ? text : '';
}

export function isValidMobile(value) {
  return normalizeMobile(value) !== '';
}

/** `09121234567` -> `0912***4567`, used in read-only summaries. */
export function maskMobile(value) {
  const mobile = normalizeMobile(value);
  if (!mobile) return '';
  return `${mobile.slice(0, 4)}***${mobile.slice(-4)}`;
}
