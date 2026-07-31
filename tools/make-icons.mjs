#!/usr/bin/env node
// Renders the extension's PNG icons from code, so a tweak to the mark is a diff
// rather than a binary swap. No dependencies: zlib ships with Node.
//
//   node tools/make-icons.mjs
//
// Draws three fader tracks with knobs at different heights — the classic EQ
// silhouette, which stays legible down to 16px where a curve would turn to mush.

import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "icons");
const SIZES = [16, 32, 48, 128];

const BG = [0x12, 0x16, 0x1d];
const TRACK = [0x3a, 0x43, 0x52];
const KNOB_START = [0xff, 0x5c, 0x57]; // coral
const KNOB_END = [0xc0, 0x84, 0xfc]; // violet

const COLUMNS = [0.28, 0.5, 0.72]; // x centre, as a fraction of the canvas
const KNOBS = [0.36, 0.62, 0.46]; // y centre per column, same units

const SS = 4; // supersamples per axis, for antialiasing

// Signed containment test for a rounded rectangle.
function inRound(px, py, x0, y0, x1, y1, r) {
  const dx = Math.max(x0 + r - px, 0, px - (x1 - r));
  const dy = Math.max(y0 + r - py, 0, py - (y1 - r));
  return dx * dx + dy * dy <= r * r;
}

function lerp(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

// Proportions that read well at 48px and up collapse into mush at 16px, where a
// knob is only a couple of pixels tall. Small sizes therefore get thicker tracks,
// chunkier knobs and less padding — the same mark, drawn with more mass.
function metrics(S) {
  const small = S <= 24;
  return {
    tw: small ? Math.max(S * 0.09, 1.5) : Math.max(S * 0.055, 1),
    kw: S * (small ? 0.3 : 0.22),
    kh: small ? Math.max(S * 0.24, 3) : Math.max(S * 0.15, 2),
    top: S * (small ? 0.12 : 0.18),
    bot: S * (small ? 0.88 : 0.82),
    radius: S * (small ? 0.16 : 0.22),
  };
}

// Returns [r,g,b,a] for one supersample point, painting back to front.
function sample(x, y, S) {
  const { tw, kw, kh, top, bot, radius } = metrics(S);

  for (let i = 0; i < COLUMNS.length; i++) {
    const cx = COLUMNS[i] * S;
    const cy = KNOBS[i] * S;
    if (inRound(x, y, cx - kw / 2, cy - kh / 2, cx + kw / 2, cy + kh / 2, kh / 2)) {
      return [...lerp(KNOB_START, KNOB_END, i / (COLUMNS.length - 1)), 255];
    }
  }
  for (const c of COLUMNS) {
    const cx = c * S;
    if (inRound(x, y, cx - tw / 2, top, cx + tw / 2, bot, tw / 2)) return [...TRACK, 255];
  }
  if (inRound(x, y, 0, 0, S, S, radius)) return [...BG, 255];
  return [0, 0, 0, 0];
}

// Supersampled render into a raw RGBA buffer.
function render(S) {
  const buf = Buffer.alloc(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;
          const c = sample(px, py, S);
          const af = c[3] / 255;
          // Accumulate premultiplied, so edge pixels don't fringe toward black.
          r += c[0] * af; g += c[1] * af; b += c[2] * af; a += af;
        }
      }
      const n = SS * SS;
      const i = (y * S + x) * 4;
      if (a > 0) {
        buf[i] = Math.round(r / a);
        buf[i + 1] = Math.round(g / a);
        buf[i + 2] = Math.round(b / a);
      }
      buf[i + 3] = Math.round((a / n) * 255);
    }
  }
  return buf;
}

// ---- Minimal PNG encoder (8-bit RGBA, no interlacing) ----
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(rgba, S) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(S, 0);
  ihdr.writeUInt32BE(S, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  // bytes 10-12 stay zero: deflate, adaptive filtering, no interlace

  // Each scanline is prefixed with its filter byte; 0 means "none".
  const raw = Buffer.alloc(S * (S * 4 + 1));
  for (let y = 0; y < S; y++) {
    raw[y * (S * 4 + 1)] = 0;
    rgba.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT, { recursive: true });
for (const S of SIZES) {
  const file = join(OUT, `icon${S}.png`);
  writeFileSync(file, encodePng(render(S), S));
  console.log("wrote", file);
}
