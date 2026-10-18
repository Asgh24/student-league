import crypto from 'node:crypto';

/**
 * Uniformly distributed integer in [0, maxExclusive) using rejection sampling
 * over crypto.randomBytes, so the result has no modulo bias.
 */
export function randomInt(maxExclusive) {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
    throw new RangeError('maxExclusive must be a positive integer');
  }
  const range = 0x100000000; // 2^32
  const limit = Math.floor(range / maxExclusive) * maxExclusive;
  let value;
  do {
    value = crypto.randomBytes(4).readUInt32BE(0);
  } while (value >= limit);
  return value % maxExclusive;
}

export function pickOne(items) {
  if (!Array.isArray(items) || items.length === 0) throw new RangeError('cannot pick from an empty list');
  return items[randomInt(items.length)];
}

export function shuffle(items) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}
