#!/usr/bin/env node
// pbi-delivery · read-image.js
// Reads a dashboard image (PNG) pixel by pixel and derives EXACT design values:
// colors by role (page, card, text, accent, sidebar, status…), sidebar width, header height and
// canvas scale. Writes a CSS token file that extract-design.js reads with high confidence.
// Layout (which KPIs, charts, tables) is read by Claude looking at the same image — see intake.md.
// No dependencies.
//
// Usage: node read-image.js --in <image.png> --out-css <image-tokens.css> [--out-json <image-analysis.json>]
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const A = {};
for (let i = 2; i < process.argv.length; i += 2) A[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
if (!A.in || !A['out-css']) { console.error('Usage: node read-image.js --in <image.png> --out-css <image-tokens.css> [--out-json <analysis.json>]'); process.exit(2); }

// ---------------- PNG decode ----------------
function decodePng(file) {
  const buf = fs.readFileSync(file);
  const sig = '89504e470d0a1a0a';
  if (buf.subarray(0, 8).toString('hex') !== sig) {
    const head = buf.subarray(0, 4).toString('hex');
    const kind = head.startsWith('ffd8') ? 'JPEG' : head.startsWith('5249') ? 'WEBP' : head.startsWith('4749') ? 'GIF' : 'unknown';
    throw new Error(`${path.basename(file)} is ${kind}, not PNG. Export/save it as PNG (Paint: Save as → PNG; Snipping Tool saves PNG by default) and run again.`);
  }
  let off = 8; let w, h, depth, ctype, interlace; let palette = null; let trns = null; const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off); const type = buf.toString('ascii', off + 4, off + 8); const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; ctype = data[9]; interlace = data[12]; }
    else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (interlace) throw new Error('Interlaced PNG is not supported. Re-save the image as a normal PNG.');
  if (depth !== 8 && depth !== 16 && !(ctype === 3 && depth <= 8)) throw new Error(`PNG bit depth ${depth} not supported; re-save as 8-bit PNG.`);
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype];
  const bps = depth === 16 ? 2 : 1;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bitsPerPixel = channels * depth;
  const stride = Math.ceil((w * bitsPerPixel) / 8);
  const bpp = Math.max(1, Math.ceil(bitsPerPixel / 8));
  const out = Buffer.alloc(stride * h);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[p++]; const row = y * stride; const prev = row - stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[row + x - bpp] : 0; const b = y ? out[prev + x] : 0; const c = x >= bpp && y ? out[prev + x - bpp] : 0;
      let v = raw[p++];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[row + x] = v & 255;
    }
  }
  const px = (x, y) => {
    const row = y * stride;
    if (ctype === 3) {
      const bit = x * depth; const byte = out[row + (bit >> 3)]; const idx = (byte >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
      const alpha = trns && idx < trns.length ? trns[idx] : 255;
      return [palette[idx * 3], palette[idx * 3 + 1], palette[idx * 3 + 2], alpha];
    }
    const i = row + x * channels * bps;
    const s = (k) => out[i + k * bps];
    if (ctype === 0) return [s(0), s(0), s(0), 255];
    if (ctype === 4) return [s(0), s(0), s(0), s(1)];
    if (ctype === 2) return [s(0), s(1), s(2), 255];
    return [s(0), s(1), s(2), s(3)];
  };
  return { w, h, px };
}

// ---------------- color helpers ----------------
const hex = (r, g, b) => '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('').toUpperCase();
const rgbOf = (hx) => [1, 3, 5].map((i) => parseInt(hx.slice(i, i + 2), 16));
const lum = (hx) => { const [r, g, b] = rgbOf(hx).map((c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
// chroma (0–1): absolute colorfulness. Dark grays like #1B1F2A have high HSV saturation but ~0 chroma.
const sat = (hx) => { const c = rgbOf(hx); return (Math.max(...c) - Math.min(...c)) / 255; };
const hue = (hx) => { const [r, g, b] = rgbOf(hx).map((v) => v / 255); const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (!d) return 0; let x = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; x *= 60; return x < 0 ? x + 360 : x; };
const dist = (a, b) => { const x = rgbOf(a), y = rgbOf(b); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]); };

const img = decodePng(A.in);
const { w, h, px } = img;
const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 1.5e6))); // sample ≤ ~1.5M pixels

// histogram of a region, merged into clusters (antialiasing collapses into the dominant exact color)
function histogram(x0, y0, x1, y1) {
  const m = new Map(); let n = 0;
  for (let y = y0; y < y1; y += step) for (let x = x0; x < x1; x += step) {
    const [r, g, b, a] = px(x, y); if (a < 200) continue;
    const k = hex(r, g, b); m.set(k, (m.get(k) || 0) + 1); n++;
  }
  const sorted = [...m.entries()].sort((p, q) => q[1] - p[1]);
  const clusters = [];
  for (const [c, cnt] of sorted) {
    // fine threshold: flat UIs use near-identical tints (white card vs #F3F7F5 page) that must stay apart
    const near = clusters.find((cl) => dist(cl.color, c) < 7);
    if (near) near.count += cnt; else clusters.push({ color: c, count: cnt });
  }
  clusters.forEach((c) => { c.share = n ? c.count / n : 0; });
  return clusters.sort((p, q) => q.count - p.count);
}
const dominant = (x0, y0, x1, y1) => histogram(x0, y0, x1, y1)[0] || { color: '#FFFFFF', share: 0 };

// ---------------- structure: sidebar, header ----------------
const colDom = (x) => dominant(x, 0, x + 1, h);
const rowDom = (y, x0) => dominant(x0, y, w, y + 1);
const whole = histogram(0, 0, w, h);
let sidebarW = 0; let sidebarColor = null;
{
  const first = colDom(Math.min(2, w - 1));
  if (first.share > 0.6 && dist(first.color, whole[0].color) > 25) {
    let x = 2;
    while (x < w * 0.35) { const d = colDom(x); if (d.share < 0.5 || dist(d.color, first.color) > 18) break; x += Math.max(1, Math.floor(w / 960)); }
    if (x > w * 0.04) { sidebarW = x; sidebarColor = first.color; }
  }
}
// Page background = the color of the outer margin (left gutter strip next to the sidebar, lower half).
// Cards can cover more area than the background, so the global most-frequent color is not reliable.
const gutterW = Math.max(3, Math.round(w * 0.006));
const page = dominant(sidebarW + 2, Math.floor(h * 0.5), Math.min(w, sidebarW + 2 + gutterW), h).color;

let headerH = 0; let headerColor = null;
{
  const x0 = sidebarW + 2; const inc = Math.max(1, Math.floor(h / 1080));
  // a header is a top band (allowing a small top margin) whose dominant color differs from the page;
  // flat UI → exact continuity. Its height is measured from the top of the canvas.
  let y0 = 0;
  while (y0 < h * 0.15) { const d = rowDom(y0, x0); if (d.share > 0.6 && dist(d.color, page) > 2) break; y0 += inc; }
  const top = y0 < h * 0.15 ? rowDom(y0, x0) : null;
  if (top) {
    let y = y0;
    while (y < h * 0.3) { const d = rowDom(y, x0); if (dist(d.color, top.color) > 4 || d.share < 0.35) break; y += inc; }
    if (y - y0 > h * 0.03) { headerH = y; headerColor = top.color; }
  }
}

// ---------------- roles ----------------
const contentHist = histogram(sidebarW + 2, headerH + 2, w, h);
const present = (c, min = 0.0004) => c.share >= min;
const neutral = (c) => sat(c.color) < 0.1;
const surface = (contentHist.find((c) => present(c, 0.01) && c.color !== page && neutral(c) && lum(c.color) > 0.8) || { color: lum(page) > 0.9 ? page : '#FFFFFF' }).color;
const lightBase = lum(page) > 0.5;
const inkC = contentHist.filter((c) => present(c) && neutral(c)).sort((p, q) => (lightBase ? lum(p.color) - lum(q.color) : lum(q.color) - lum(p.color)))[0];
const ink = inkC ? inkC.color : lightBase ? '#000000' : '#FFFFFF';
const grays = contentHist.filter((c) => present(c) && neutral(c) && ![page, surface, ink].includes(c.color));
// borders/gridlines are the most NEUTRAL light gray with real presence (light brand tints compete on area)
const border = (grays.filter((c) => present(c, 0.002) && lum(c.color) > 0.6 && lum(c.color) < Math.max(lum(page), lum(surface)) && dist(c.color, page) > 4)
  .sort((p, q) => (sat(p.color) - sat(q.color)) || (q.count - p.count))[0] || {}).color;
// secondary text is small: accept low-presence neutrals (antialiased text), never reuse one color for both roles
const textGrays = contentHist.filter((c) => present(c, 0.00004) && neutral(c) && ![page, surface, ink].includes(c.color) && lum(c.color) > 0.06 && lum(c.color) < 0.6);
const muted = (textGrays.filter((c) => lum(c.color) < 0.22).sort((p, q) => q.count - p.count)[0] || {}).color;
const subtle = (textGrays.filter((c) => lum(c.color) >= 0.22 && c.color !== muted).sort((p, q) => q.count - p.count)[0] || {}).color;
const sats = contentHist.filter((c) => present(c, 0.0008) && sat(c.color) > 0.25);
const isRed = (c) => hue(c.color) < 15 || hue(c.color) > 345;
const isGreen = (c) => hue(c.color) > 90 && hue(c.color) < 170;
const isAmber = (c) => hue(c.color) >= 25 && hue(c.color) <= 50;
const brandish = sats.filter((c) => !isRed(c) && !isGreen(c) && !isAmber(c));
const accent = (brandish[0] || sats[0] || {}).color;
const secondary = (brandish.find((c) => c.color !== accent && dist(c.color, accent) > 50) || {}).color;
// status colors only need to exist (often tiny delta text/arrows), but as SOLID fills: text antialiasing
// (ClearType) scatters reddish/orange fringe pixels that must not be mistaken for a status color.
// Test: a real fill has 2x2 blocks of the identical color; fringes are 1px-wide columns.
const candidates = new Set(contentHist.filter((c) => sat(c.color) > 0.35).map((c) => c.color));
const blocks = new Map();
for (let y = headerH + 1; y < h - 1; y++) for (let x = sidebarW + 1; x < w - 1; x++) {
  const p0 = px(x, y); const c0 = hex(p0[0], p0[1], p0[2]);
  if (!candidates.has(c0)) continue;
  const same = (q) => q[0] === p0[0] && q[1] === p0[1] && q[2] === p0[2];
  if (same(px(x + 1, y)) && same(px(x, y + 1)) && same(px(x + 1, y + 1))) blocks.set(c0, (blocks.get(c0) || 0) + 1);
}
const statusPool = contentHist.filter((c) => sat(c.color) > 0.35 && (blocks.get(c.color) || 0) >= 6);
const good = (statusPool.find((c) => isGreen(c)) || {}).color;
const bad = (statusPool.find((c) => isRed(c)) || {}).color;
const warning = (statusPool.find((c) => isAmber(c)) || {}).color;
let sidebarText = null, sidebarActive = null;
if (sidebarW) {
  const sb = histogram(0, 0, sidebarW, h).filter((c) => c.color !== sidebarColor && present(c, 0.001));
  sidebarActive = (sb.find((c) => sat(c.color) > 0.35 && (!accent || dist(c.color, accent) < 40)) || {}).color || null;
  // nav text = frequent neutral with real contrast against the sidebar (excludes dividers and hover fills)
  const bgL = lum(sidebarColor);
  sidebarText = (sb.filter((c) => c.color !== sidebarActive && sat(c.color) < 0.1 && Math.abs(lum(c.color) - bgL) > 0.2 && c.color !== '#FFFFFF')
    .sort((p, q) => q.count - p.count)[0] || {}).color || null;
}
const series = [accent, secondary, ...brandish.map((c) => c.color)].filter(Boolean).filter((c, i, a) => a.indexOf(c) === i).slice(0, 6);

// ---------------- scale to a Power BI canvas ----------------
const ratio = w / h;
const canvas = Math.abs(ratio - 16 / 9) < 0.08 ? { width: 1920, height: 1080 } : { width: 1920, height: Math.round(1920 / ratio) };
const k = canvas.width / w;
const S = (v) => Math.round((v * k) / 4) * 4; // snap to the 4px grid

// ---------------- write ----------------
const v = (name, val, why) => (val ? `  --${name}: ${val}; /* ${why} */\n` : '');
let css = `/* Generated by pbi-delivery/scripts/read-image.js from ${path.basename(A.in)} (${w}x${h}px, scale ${k.toFixed(3)} to ${canvas.width}x${canvas.height}).\n   Exact pixel colors; confirm roles marked "check" with the user. */\n:root {\n`;
css += v('bg-app', page, 'outer margin color next to the sidebar / page edge');
css += v('surface-card', surface, 'most frequent light neutral besides the page (cards)');
css += v('text-primary', ink, lightBase ? 'darkest frequent neutral (text)' : 'lightest frequent neutral (text on dark)');
css += v('text-muted', muted, 'darker mid neutral (secondary text) — check');
css += v('text-secondary', subtle, 'lighter mid neutral (axes/labels) — check');
css += v('border-default', border, 'light neutral between page and card (borders/gridlines) — check');
css += v('color-primary', accent, 'most frequent saturated non-status color');
css += v('color-secondary', secondary, 'second distinct saturated color — check');
css += series.slice(0).map((c, i) => v(`chart-${i + 1}`, c, 'series color by frequency')).join('');
css += v('status-positive', good, 'saturated green present');
css += v('status-negative', bad, 'saturated red present');
css += v('status-warning', warning, 'saturated amber present');
css += v('sidebar-bg', sidebarColor, `left band ${sidebarW}px wide in the image`);
css += v('sidebar-text', sidebarText, 'most frequent neutral inside the sidebar');
css += v('sidebar-active-bg', sidebarActive, 'saturated color inside the sidebar (active item)');
css += v('header-bg', headerColor, `top band ${headerH}px tall in the image`);
css += `  --canvas-width: ${canvas.width}px;\n  --canvas-height: ${canvas.height}px;\n`;
if (sidebarW) css += `  --sidebar-width: ${S(sidebarW)}px;\n`;
if (headerH) css += `  --header-height: ${S(headerH)}px;\n`;
css += '}\n';
fs.mkdirSync(path.dirname(path.resolve(A['out-css'])), { recursive: true });
fs.writeFileSync(A['out-css'], css);

const analysis = {
  $schema: 'pbi-delivery/image-analysis/1', image: path.basename(A.in), size: { width: w, height: h }, scale: k, canvas,
  sidebar: sidebarW ? { widthPx: sidebarW, widthCanvas: S(sidebarW), color: sidebarColor, text: sidebarText, active: sidebarActive } : null,
  header: headerH ? { heightPx: headerH, heightCanvas: S(headerH), color: headerColor } : null,
  roles: { page, surface, ink, muted, subtle, border, accent, secondary, good, bad, warning },
  topColors: whole.slice(0, 16).map((c) => ({ color: c.color, share: Math.round(c.share * 1000) / 10 })),
  toConfirm: [
    ...['muted', 'subtle', 'border', 'secondary'].filter((r) => !({ muted, subtle, border, secondary })[r]).map((r) => `color role not found in image: ${r}`),
    ...(!good ? ['no green in image: positive status color will come from defaults — confirm'] : []),
    ...(!bad ? ['no red in image: negative status color will come from defaults — confirm'] : []),
    'font family: read it from the image (Claude) and confirm',
  ],
};
if (A['out-json']) fs.writeFileSync(A['out-json'], JSON.stringify(analysis, null, 2));
console.log(JSON.stringify({ ok: true, css: A['out-css'], size: analysis.size, canvas, sidebar: analysis.sidebar, header: analysis.header, roles: analysis.roles, toConfirm: analysis.toConfirm }, null, 2));
