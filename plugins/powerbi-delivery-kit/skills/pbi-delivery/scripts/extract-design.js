#!/usr/bin/env node
// pbi-delivery · extract-design.js
// Derives design tokens from whatever design material is shared: HTML mockups, CSS token files,
// palette / theme JSON. No dependencies.
//
// Usage: node extract-design.js --in <file|dir> [--in <file|dir> ...] --out <design-tokens.json>
//
// Strategy: 1) CSS custom properties resolved through var() aliases and matched by NAME to roles
// (text-primary → ink, sidebar-bg → sidebar …); 2) palette/theme JSON keys; 3) fallback by color
// frequency + luminance/saturation. Every token records where it came from so a human can confirm.
'use strict';
const fs = require('fs');
const path = require('path');

const ins = []; let out = null;
for (let i = 2; i < process.argv.length; i += 2) {
  if (process.argv[i] === '--in') ins.push(process.argv[i + 1]);
  if (process.argv[i] === '--out') out = process.argv[i + 1];
}
if (!ins.length || !out) { console.error('Usage: node extract-design.js --in <file|dir> [...] --out <design-tokens.json>'); process.exit(2); }

const files = [];
const walk = (p) => {
  const st = fs.statSync(p);
  if (st.isDirectory()) { for (const f of fs.readdirSync(p)) if (!f.startsWith('.') && f !== 'node_modules') walk(path.join(p, f)); }
  else if (/\.(html?|css|json|jsx?|tsx?)$/i.test(p) && st.size < 5e6) files.push(p);
};
ins.forEach((p) => walk(path.resolve(p)));
const read = (f) => fs.readFileSync(f, 'utf8').replace(/^﻿/, '');

// ---------- collect ----------
const vars = {}; const varSrc = {};
const colorFreq = {}; const fontFreq = {}; const sizeFreq = {};
const jsonPalettes = [];
const HEX = /#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g;
const normHex = (h) => { h = h.toUpperCase(); return h.length === 4 ? '#' + h.slice(1).split('').map((c) => c + c).join('') : h; };
const rgbToHex = (r, g, b) => '#' + [r, g, b].map((n) => Math.max(0, Math.min(255, Math.round(+n))).toString(16).padStart(2, '0')).join('').toUpperCase();

for (const f of files) {
  const txt = read(f);
  if (/\.json$/i.test(f)) {
    try { jsonPalettes.push({ file: f, json: JSON.parse(txt) }); } catch { /* not JSON */ }
  }
  for (const m of txt.matchAll(/--([A-Za-z0-9_-]+)\s*:\s*([^;}\n]+)/g)) {
    if (!(m[1] in vars)) { vars[m[1]] = m[2].trim(); varSrc[m[1]] = path.basename(f); }
  }
  for (const m of txt.matchAll(HEX)) { const h = normHex(m[0]); colorFreq[h] = (colorFreq[h] || 0) + 1; }
  for (const m of txt.matchAll(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\)/g)) {
    if (m[4] !== undefined && +m[4] < 0.9) continue; // ignore translucent shadows
    const h = rgbToHex(m[1], m[2], m[3]); colorFreq[h] = (colorFreq[h] || 0) + 1;
  }
  for (const m of txt.matchAll(/font-family\s*:\s*([^;}"']*(?:["'][^"']+["'][^;}]*)*)/gi)) {
    const fam = m[1].split(',')[0].replace(/["']/g, '').trim();
    if (fam && !/^var\(/.test(fam) && !/inherit|initial/i.test(fam)) fontFreq[fam] = (fontFreq[fam] || 0) + 1;
  }
  for (const m of txt.matchAll(/font-size\s*:\s*(\d+(?:\.\d+)?)px/gi)) sizeFreq[m[1]] = (sizeFreq[m[1]] || 0) + 1;
}

// resolve var() chains
const resolve = (v, depth = 0) => {
  if (depth > 10 || v == null) return v;
  return v.replace(/var\(\s*--([A-Za-z0-9_-]+)\s*(?:,\s*([^)]+))?\)/g, (_, n, fb) => (n in vars ? resolve(vars[n], depth + 1) : (fb || '')));
};
const R = {}; for (const k of Object.keys(vars)) R[k] = resolve(vars[k]);
const asHex = (v) => {
  if (!v) return null;
  const h = v.match(HEX); if (h) return normHex(h[0]);
  const r = v.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/); if (r) return rgbToHex(r[1], r[2], r[3]);
  if (/^\s*white\s*$/i.test(v)) return '#FFFFFF';
  if (/^\s*black\s*$/i.test(v)) return '#000000';
  return null;
};
const px = (v) => { const m = v && String(v).match(/(-?\d+(?:\.\d+)?)px/); return m ? +m[1] : null; };

// ---------- color math ----------
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const lum = (h) => { const [r, g, b] = rgb(h).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const sat = (h) => { const c = rgb(h); const mx = Math.max(...c), mn = Math.min(...c); return mx === 0 ? 0 : (mx - mn) / mx; };
const hue = (h) => {
  const [r, g, b] = rgb(h); const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (!d) return 0; let x = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; x *= 60; return x < 0 ? x + 360 : x;
};

// ---------- 1) name-based role mapping ----------
const ROLES = {
  page:           [/^(bg|background)-(app|page|canvas)$/, /^page-(bg|background)$/, /^canvas-bg$/, /^color-background$/],
  surface:        [/^surface-card$/, /^(card|panel)-(bg|background)$/, /^surface$/, /^color-surface$/, /^bg-card$/],
  ink:            [/^text-primary$/, /^color-text$/, /^(ink|foreground|text-default|text-strong|fg)$/, /^text$/],
  muted:          [/^text-muted$/, /^text-secondary-strong$/, /^color-text-muted$/],
  subtle:         [/^text-secondary$/, /^text-(subtle|tertiary|weak)$/, /^chart-axis$/],
  border:         [/^border-default$/, /^border$/, /^color-border$/, /^(divider|stroke|hairline)$/, /^chart-grid$/],
  accent:         [/^color-primary$/, /^primary$/, /^(accent|brand)$/, /^color-(accent|brand)$/, /^chart-1$/],
  secondary:      [/^color-secondary$/, /^secondary$/, /^chart-2$/],
  neutralSeries:  [/^chart-3$/],
  sidebar:        [/^sidebar-bg$/, /^(nav|sidenav|side-nav)-bg$/, /^sidebar$/],
  sidebarText:    [/^sidebar-text$/, /^nav-text$/],
  sidebarSection: [/^sidebar-section$/, /^nav-section$/],
  onAccent:       [/^text-on-primary$/, /^on-primary$/, /^color-on-primary$/],
  good:           [/^status-positive$/, /^(success|positive|good)$/, /^color-(success|positive)$/],
  bad:            [/^status-negative$/, /^(danger|error|negative|bad)$/, /^color-(danger|error|negative)$/],
  warning:        [/^status-warning$/, /^(warning|caution)$/, /^color-warning$/],
};
const tokens = {};
for (const [role, pats] of Object.entries(ROLES)) {
  for (const re of pats) {
    const name = Object.keys(R).find((k) => re.test(k) && asHex(R[k]));
    if (name) { tokens[role] = { value: asHex(R[name]), from: `--${name} (${varSrc[name]})`, confidence: 'high' }; break; }
  }
}

// ---------- 2) palette / Power BI theme JSON ----------
let jsonDataColors = null;
for (const { file, json } of jsonPalettes) {
  const flat = {};
  const visit = (o, pre) => { if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { if (typeof v === 'string' && asHex(v)) flat[(pre ? pre + '.' : '') + k] = asHex(v); else visit(v, (pre ? pre + '.' : '') + k); } };
  visit(json, '');
  if (Array.isArray(json.dataColors)) jsonDataColors = json.dataColors.map(asHex).filter(Boolean);
  const map = { foreground: 'ink', background: 'surface', secondaryBackground: 'page', backgroundLight: 'page', tableAccent: 'accent', good: 'good', bad: 'bad', neutral: 'warning', foregroundNeutralSecondary: 'muted', foregroundNeutralTertiary: 'subtle', backgroundNeutral: 'border' };
  for (const [k, v] of Object.entries(flat)) {
    const leaf = k.split('.').pop();
    const role = map[leaf] || Object.keys(ROLES).find((r) => ROLES[r].some((re) => re.test(leaf.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()))));
    if (role && !tokens[role]) tokens[role] = { value: v, from: `${k} (${path.basename(file)})`, confidence: 'medium' };
  }
  if (!tokens.accent && jsonDataColors && jsonDataColors[0]) tokens.accent = { value: jsonDataColors[0], from: `dataColors[0] (${path.basename(file)})`, confidence: 'medium' };
}

// ---------- 3) frequency + luminance fallback ----------
const ranked = Object.entries(colorFreq).sort((a, b) => b[1] - a[1]).map(([h]) => h);
const pick = (role, pred, why) => {
  if (tokens[role]) return;
  const h = ranked.find(pred);
  if (h) tokens[role] = { value: h, from: `most frequent ${why} color in shared files`, confidence: 'low' };
};
const gray = (h) => sat(h) < 0.12;
pick('surface', (h) => h === '#FFFFFF', 'white');
pick('page', (h) => gray(h) && lum(h) > 0.85 && h !== '#FFFFFF', 'very light neutral');
pick('ink', (h) => lum(h) < 0.06, 'darkest');
pick('border', (h) => gray(h) && lum(h) > 0.7 && lum(h) <= 0.92 && h !== (tokens.page || {}).value, 'light neutral');
pick('muted', (h) => gray(h) && lum(h) > 0.08 && lum(h) < 0.25, 'mid-dark neutral');
pick('subtle', (h) => gray(h) && lum(h) >= 0.25 && lum(h) < 0.5, 'mid neutral');
pick('accent', (h) => sat(h) > 0.45 && lum(h) > 0.08 && lum(h) < 0.6 && !(hue(h) < 20 || hue(h) > 340) && !(hue(h) > 80 && hue(h) < 160), 'saturated (non red/green)');
pick('secondary', (h) => sat(h) > 0.35 && h !== (tokens.accent || {}).value && !(hue(h) < 20 || hue(h) > 340) && !(hue(h) > 80 && hue(h) < 160), 'second saturated');
pick('good', (h) => sat(h) > 0.4 && hue(h) > 90 && hue(h) < 170, 'green');
pick('bad', (h) => sat(h) > 0.45 && (hue(h) < 15 || hue(h) > 345), 'red');
pick('warning', (h) => sat(h) > 0.5 && hue(h) >= 25 && hue(h) <= 50, 'amber/orange');
if (!tokens.onAccent) tokens.onAccent = { value: '#FFFFFF', from: 'default (white on accent)', confidence: 'low' };
if (!tokens.sidebar && tokens.ink) tokens.sidebar = { value: tokens.ink.value, from: 'fallback: ink', confidence: 'low' };
if (!tokens.sidebarText && tokens.subtle) tokens.sidebarText = { value: tokens.subtle.value, from: 'fallback: subtle', confidence: 'low' };
if (!tokens.sidebarSection && tokens.muted) tokens.sidebarSection = { value: tokens.muted.value, from: 'fallback: muted', confidence: 'low' };

// ---------- typography ----------
const fontVar = Object.keys(R).find((k) => /^font-(sans|family|body|base|primary)$/.test(k));
let font = fontVar ? R[fontVar].split(',')[0].replace(/["']/g, '').trim() : null;
let fontFrom = fontVar ? `--${fontVar}` : null;
if (!font || /^(ui-|system)/.test(font)) {
  const top = Object.entries(fontFreq).sort((a, b) => b[1] - a[1])[0];
  if (top) { font = top[0]; fontFrom = 'most frequent font-family'; }
}
const sizeVar = (re) => { const k = Object.keys(R).find((n) => re.test(n) && px(R[n])); return k ? { px: px(R[k]), from: `--${k}` } : null; };
const typo = {
  kpi: sizeVar(/^(text|font-size|fs)-(kpi|metric|number|display-sm)$/),
  pageTitle: sizeVar(/^(text|font-size|fs)-(h1|title-lg|page-title)$/),
  cardTitle: sizeVar(/^(text|font-size|fs)-(title|h3|card-title)$/),
  body: sizeVar(/^(text|font-size|fs)-(body|base|md)$/),
  label: sizeVar(/^(text|font-size|fs)-(caption|label|sm|xs)$/),
};
const defaultsPx = { kpi: 28, pageTitle: 24, cardTitle: 16, body: 14, label: 12 };
const typography = {};
for (const [k, v] of Object.entries(typo)) {
  const p = v ? v.px : defaultsPx[k];
  typography[k] = { px: p, pt: Math.round(p * 0.75 * 100) / 100, from: v ? v.from : 'default' };
}

// ---------- layout ----------
const lay = (re, def) => { const k = Object.keys(R).find((n) => re.test(n) && px(R[n]) != null); return k ? { value: px(R[k]), from: `--${k}` } : { value: def, from: 'default' }; };
const layout = {
  canvasWidth: lay(/^canvas-width$/, 1920),
  canvasHeight: lay(/^canvas-height$/, 1080),
  sidebarWidth: lay(/^(sidebar|nav|sidenav)-width$/, null),
  headerHeight: lay(/^(header|topbar)-height$/, 72),
  padding: lay(/^page-padding$/, 32),
  gutter: lay(/^(grid-gutter|gutter|gap)$/, 24),
  cardPadding: lay(/^card-padding$/, 24),
  radius: lay(/^radius-(lg|card)$|^card-radius$/, 12),
};
if (layout.sidebarWidth.value == null) {
  // look for a sidebar/nav rule with a px width in CSS
  for (const f of files) {
    const m = read(f).match(/(?:sidebar|side-nav|sidenav|aside|\.nav)[^{]*\{[^}]*?\bwidth\s*:\s*(\d+)px/i);
    if (m) { layout.sidebarWidth = { value: +m[1], from: `sidebar rule in ${path.basename(f)}` }; break; }
  }
}

// ---------- data colors ----------
const chartVars = Object.keys(R).filter((k) => /^chart-\d+$/.test(k)).sort((a, b) => +a.split('-')[1] - +b.split('-')[1]).map((k) => asHex(R[k])).filter(Boolean);
let dataColors = (chartVars.length ? chartVars : jsonDataColors) || [];
const extra = [tokens.accent, tokens.secondary, tokens.neutralSeries].filter(Boolean).map((t) => t.value)
  .concat(ranked.filter((h) => sat(h) > 0.3 && !(hue(h) < 15 || hue(h) > 345) && !(hue(h) > 90 && hue(h) < 170)));
for (const h of extra) if (dataColors.length < 8 && !dataColors.includes(h)) dataColors.push(h);

const required = ['ink', 'muted', 'subtle', 'surface', 'border', 'accent', 'page'];
const result = {
  $schema: 'pbi-delivery/design-tokens/1',
  sources: files.map((f) => path.relative(process.cwd(), f)),
  colors: Object.fromEntries(Object.entries(tokens).map(([k, v]) => [k, v.value])),
  evidence: tokens,
  font: font ? { family: font, stack: `${font}, Segoe UI, sans-serif`, from: fontFrom } : { family: 'Segoe UI', stack: 'Segoe UI, sans-serif', from: 'default' },
  typography,
  layout: Object.fromEntries(Object.entries(layout).map(([k, v]) => [k, v.value])),
  layoutEvidence: layout,
  dataColors,
  toConfirm: [
    ...required.filter((r) => !tokens[r]).map((r) => `missing color role: ${r}`),
    ...Object.entries(tokens).filter(([, v]) => v.confidence === 'low').map(([k, v]) => `low confidence: ${k} = ${v.value} (${v.from})`),
    ...(font ? [] : ['font family not found — using Segoe UI']),
  ],
};
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(out, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ ok: true, out, files: files.length, colors: result.colors, font: result.font.family, layout: result.layout, toConfirm: result.toConfirm }, null, 2));
