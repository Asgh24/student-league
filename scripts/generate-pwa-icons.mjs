#!/usr/bin/env node
/**
 * Draws the home-screen icons (manifest + apple-touch-icon) without any image
 * dependency. A tiny PNG encoder on top of `node:zlib` paints the trophy on the
 * brand gradient, so the assets can be regenerated after a palette change:
 *
 *   node scripts/generate-pwa-icons.mjs
 *
 * Output (committed): public/img/pwa/icon-192.png, icon-512.png,
 * icon-maskable-512.png and apple-touch-icon.png.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'img', 'pwa');

const BRAND = [234, 88, 12]; // #ea580c (ember palette)
const BRAND_2 = [245, 158, 11]; // #f59e0b
const WHITE = [255, 255, 255];

const clamp01 = (value) => Math.min(1, Math.max(0, value));

function mix(from, to, amount) {
  const t = clamp01(amount);
  return [
    Math.round(from[0] + (to[0] - from[0]) * t),
    Math.round(from[1] + (to[1] - from[1]) * t),
    Math.round(from[2] + (to[2] - from[2]) * t),
  ];
}

/* ----------------------------------------------------------------- trophy */

const CUP_TOP = 0.318;
const CUP_BOTTOM = 0.592;
const GLYPH_CENTER = 0.540;

/** Cup half-width: wide rim, tapered walls, rounded bottom. */
function cupHalfWidth(v) {
  const t = clamp01((v - CUP_TOP) / (CUP_BOTTOM - CUP_TOP));
  return 0.145 + 0.055 * (1 - t) ** 1.35;
}

function inPill(u, v, { half, top, bottom }) {
  const radius = (bottom - top) / 2;
  const center = (top + bottom) / 2;
  const dy = Math.abs(v - center);
  if (dy > radius) return false;
  const x = Math.abs(u - 0.5);
  if (x <= half - radius) return true;
  return (x - (half - radius)) ** 2 + dy ** 2 <= radius ** 2;
}

function inRim(u, v) {
  return inPill(u, v, { half: 0.202, top: 0.300, bottom: 0.336 });
}

function inCup(u, v) {
  if (v < CUP_TOP) return false;
  if (v <= CUP_BOTTOM) return Math.abs(u - 0.5) <= cupHalfWidth(v);
  // Bottom cap: lower half of an ellipse keeps the cup rounded.
  const dx = (u - 0.5) / 0.145;
  const dy = (v - CUP_BOTTOM) / 0.055;
  return dx * dx + dy * dy <= 1;
}

function inHandle(u, v, side) {
  const cx = side > 0 ? 0.645 : 0.355;
  if (side > 0 ? u < cx : u > cx) return false;
  const distance = Math.hypot(u - cx, v - 0.430);
  return distance <= 0.085 && distance >= 0.055;
}

function inTrophy(u, v) {
  if (inRim(u, v)) return true;
  if (inCup(u, v)) return true;
  if (inHandle(u, v, 1) || inHandle(u, v, -1)) return true;
  // Stem between the cup and the foot.
  if (v >= 0.600 && v <= 0.720) {
    const t = (v - 0.600) / 0.120;
    if (Math.abs(u - 0.5) <= 0.028 + 0.012 * t) return true;
  }
  // Foot.
  if (inPill(u, v, { half: 0.150, top: 0.716, bottom: 0.778 })) return true;
  return false;
}

/* -------------------------------------------------------------- renderer */

/** Paints one icon: full-bleed brand gradient with a white trophy. */
function renderIcon(size, { glyphScale = 1, samples = 4 } = {}) {
  const data = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let coverage = 0;
      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const u = (x + (sx + 0.5) / samples) / size;
          const v = (y + (sy + 0.5) / samples) / size;
          const gu = (u - 0.5) / glyphScale + 0.5;
          const gv = (v - GLYPH_CENTER) / glyphScale + GLYPH_CENTER;
          if (inTrophy(gu, gv)) coverage += 1;
        }
      }
      coverage /= samples * samples;

      const u = (x + 0.5) / size;
      const v = (y + 0.5) / size;
      let background = mix(BRAND, BRAND_2, clamp01(u * 0.55 + v * 0.45));
      // Soft centre glow so the flat gradient gets a little depth.
      const glow = Math.max(0, 1 - Math.hypot(u - 0.5, v - 0.46) / 0.6) * 0.14;
      background = mix(background, WHITE, glow);

      const color = mix(background, WHITE, coverage);
      const offset = (y * size + x) * 4;
      data[offset] = color[0];
      data[offset + 1] = color[1];
      data[offset + 2] = color[2];
      data[offset + 3] = 255;
    }
  }
  return data;
}

/* ----------------------------------------------------------- PNG encoder */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, payload) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(payload.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), payload]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  header[10] = 0; // compression
  header[11] = 0; // filter
  header[12] = 0; // interlace

  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0; // filter type: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------------------------------------------------------------- output */

const ICONS = [
  { file: 'icon-192.png', size: 192 },
  { file: 'icon-512.png', size: 512 },
  { file: 'icon-maskable-512.png', size: 512, glyphScale: 0.78 },
  { file: 'apple-touch-icon.png', size: 180 },
];

fs.mkdirSync(outDir, { recursive: true });
for (const icon of ICONS) {
  const png = encodePng(icon.size, renderIcon(icon.size, { glyphScale: icon.glyphScale ?? 1 }));
  fs.writeFileSync(path.join(outDir, icon.file), png);
  console.log(`${icon.file} — ${icon.size}×${icon.size}, ${(png.length / 1024).toFixed(1)} KB`);
}
