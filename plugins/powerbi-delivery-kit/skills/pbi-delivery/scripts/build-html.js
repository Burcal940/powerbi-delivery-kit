#!/usr/bin/env node
// pbi-delivery · build-html.js
// Interactive HTML twin of the Power BI pages, generated from the SAME state.json and the real data.
// One self-contained file per page (offline, no libraries): same layout/tokens as the mockup and
// build-pbir.js, plus sidebar slicers, click-to-cross-filter, tooltips and measure-driven titles
// that recompute on every filter change.
//
// Usage:
//   node build-html.js --state <project>/state.json [--page <id>] [--out <dir>] [--data <dir>]
//                      [--plan <model-plan.json>] [--model <name>.SemanticModel] [--values <file.json>]
// --values writes the raw numbers it prints (per page and per disconnected-table category) for reconcile.js.
// Defaults: --out <project>/html  --data <project>/data  --plan state.intake.plan  --model first *.SemanticModel
//
// Needs in state.json: model.measures[].calc for every measure a page uses (see references/state-schema.md),
// optional pages[].slicers and top-level "locale" (default es-CO).
// The output embeds real data → <project>/html/ is git-ignored. Prints the unfiltered values of every
// measure on the page so they can be reconciled with Power BI.
'use strict';
const fs = require('fs');
const path = require('path');
const { readTableSource } = require('./lib/read-data');
const { createEngine } = require('./lib/html-engine');

const A = {};
for (let i = 2; i < process.argv.length; i += 2) A[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
if (!A.state) { console.error('Usage: node build-html.js --state <project>/state.json [--page <id>] [--out <dir>]'); process.exit(2); }

const statePath = path.resolve(A.state);
const proj = path.dirname(statePath);
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
const warn = []; const fail = (m) => { console.error('ERROR: ' + m); process.exit(1); };
const ds = state.designSystem || {}; const colors = ds.colors || {};
const locale = state.locale || 'es-CO';
const SHELL = shellOf(state);

// ---------- model plan (Power BI column ← source column, type) ----------
const planPath = A.plan ? path.resolve(A.plan) : state.intake && state.intake.plan ? path.resolve(proj, state.intake.plan) : null;
const plan = planPath && fs.existsSync(planPath) ? JSON.parse(fs.readFileSync(planPath, 'utf8')) : { tables: [] };
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();

// ---------- TMDL column format strings (labels like "STAKE 3", "7 ago") ----------
const colFormats = {};
const modelDir = A.model ? path.resolve(A.model) : (fs.readdirSync(proj).filter((f) => f.endsWith('.SemanticModel')).map((f) => path.join(proj, f))[0]);
if (modelDir && fs.existsSync(path.join(modelDir, 'definition', 'tables'))) {
  for (const f of fs.readdirSync(path.join(modelDir, 'definition', 'tables'))) {
    const txt = fs.readFileSync(path.join(modelDir, 'definition', 'tables', f), 'utf8');
    const table = (txt.match(/^table\s+(?:'([^']+)'|(\S+))/m) || []).slice(1).find(Boolean);
    let cur = null;
    for (const line of txt.split(/\r?\n/)) {
      const c = line.match(/^\tcolumn\s+(?:'([^']+)'|([^\s=]+))/); if (c) { cur = c[1] || c[2]; continue; }
      if (/^\t(measure|partition|hierarchy)\b/.test(line)) cur = null;
      const fm = line.match(/^\t\tformatString:\s*(.+)$/); if (fm && cur && table) colFormats[`${table}[${cur}]`] = fm[1].trim();
    }
  }
}

// ---------- which columns the pages and measures reference ----------
const tables = (state.model && state.model.tables) || [];
const rels = (state.model && state.model.relationships) || [];
const tableNames = [...new Set(tables.map((t) => t.name).concat(rels.flatMap((r) => [r.fromTable, r.toTable])))];
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const pages = (state.pages || []).filter((p) => !A.page || p.id === A.page);
if (!pages.length) fail('No page ' + (A.page || '') + ' in state.json');
const fieldRe = new RegExp(`(${tableNames.map(reEsc).join('|')})\\[([^\\]]+)\\]`, 'g');
const scanText = JSON.stringify([pages, state.model.measures]);
const fields = new Set([...scanText.matchAll(fieldRe)].map((m) => `${m[1]}[${m[2]}]`));

const fact = tables.find((t) => t.role === 'fact') || tables[0];
if (!fact) fail('state.model.tables has no fact table');
// Disconnected tables with static rows (tables[].rows) → engine "statics" (no relationship, no data file)
const statics = {};
for (const t of tables) if (Array.isArray(t.rows)) statics[t.name] = t.rows;
// Fact columns computed in Power Query (tables[].derivedColumns[].calc = "(r) => ...", r('<column>') = same row)
const computed = {};
for (const d of fact.derivedColumns || []) if (d.calc) computed[d.name] = d.calc;
const derived = {}; // Dim Date columns derived from the fact date column
const lookups = []; // other dimension columns joined onto fact rows
for (const f of fields) {
  const [, t, c] = f.match(/^(.*)\[(.*)\]$/);
  if (t === fact.name || statics[t]) continue;
  const r = rels.find((x) => x.toTable === t && x.fromTable === fact.name);
  if (!r) { warn.push(`No relationship from ${fact.name} to ${t} for ${f}`); continue; }
  const dimSrc = tables.find((x) => x.name === t);
  // a date table without a data file (generated in M, or only described by build-model's tmdl block) → derived from the fact date
  if (/date/i.test(t) && (!dimSrc || (!dimSrc.source && !dimSrc.rows))) { derived[f] = { from: `${fact.name}[${r.fromColumn}]`, part: c }; fields.add(`${fact.name}[${r.fromColumn}]`); }
  else { lookups.push({ field: f, rel: r, table: dimSrc }); fields.add(`${fact.name}[${r.fromColumn}]`); }
}

// ---------- read the data ----------
const dataDir = A.data ? path.resolve(A.data) : path.join(proj, 'data');
function loadTable(t) {
  const pt = plan.tables.find((p) => norm(p.source) === norm(t.source)) || plan.tables.find((p) => p.name === t.name);
  let src; try { src = readTableSource(dataDir, t, pt); } catch (e) { fail(e.message); }
  const { file: fp, files, header, rows } = src;
  if (files.length > 1) console.log(`${t.name}: ${files.length} files combined (${rows.length} rows)`);
  const cache = {};
  const colOf = (name) => {
    if (cache[name]) return cache[name];
    if (t === fact && computed[name]) {
      const f = Function('"use strict"; return (' + computed[name] + ');')();
      const deps = {};
      const vals = rows.map((_, i) => f((n) => (deps[n] || (deps[n] = colOf(n)))[i]));
      return (cache[name] = vals.map((v) => (v === undefined || v === '' ? null : v)));
    }
    const pc = pt && pt.columns.find((c) => c.name === name);
    const src = pc ? pc.source : name;
    const i = header.findIndex((h) => norm(h) === norm(src));
    if (i < 0) fail(`Column ${t.name}[${name}] (source "${src}") not in ${path.basename(fp)} — add it to derivedColumns[].calc if Power Query computes it`);
    const type = pc ? pc.type : 'text';
    return (cache[name] = rows.map((r) => convert(r[i], type)));
  };
  return { n: rows.length, colOf };
}
function convert(v, type) {
  if (v == null || v === '') return null;
  const s = String(v).trim(); if (s === '') return null;
  if (type === 'date') return s.slice(0, 10);
  if (type === 'datetime') return s.replace('T', ' ');
  if (type === 'int' || type === 'decimal') { const n = Number(/,\d+$/.test(s) && !/\./.test(s) ? s.replace(',', '.') : s.replace(/,/g, '')); return isNaN(n) ? null : n; }
  if (type === 'bool') return /^(true|1|yes|si|sí|y)$/i.test(s);
  return s;
}
const F = loadTable(fact);
const columns = {};
for (const f of fields) {
  const [, t, c] = f.match(/^(.*)\[(.*)\]$/);
  if (t === fact.name) columns[f] = F.colOf(c);
}
for (const l of lookups) {
  if (!l.table) { warn.push(`${l.field}: dimension table has no source in state.model.tables`); continue; }
  const D = loadTable(l.table); const keys = D.colOf(l.rel.toColumn); const vals = D.colOf(l.field.match(/\[(.*)\]$/)[1]);
  const map = new Map(keys.map((k, i) => [k, vals[i]]));
  columns[l.field] = columns[`${fact.name}[${l.rel.fromColumn}]`].map((k) => (map.has(k) ? map.get(k) : null));
}
// compact encoding: text → dictionary, others → plain arrays
const data = { n: F.n, cols: {} };
for (const k in columns) {
  const v = columns[k];
  if (v.some((x) => typeof x === 'string')) {
    const dict = [...new Set(v.filter((x) => x != null))]; const ix = new Map(dict.map((d, i) => [d, i]));
    data.cols[k] = { dict, idx: v.map((x) => (x == null ? -1 : ix.get(x))) };
  } else data.cols[k] = { vals: v };
}

// ---------- check measures ----------
const measures = (state.model.measures || []).map((m) => ({ name: m.name, format: m.format || (m.hidden ? '@' : undefined), calc: m.calc }));
const usedMeasures = new Set();
const MKEY = /^(measure|titleMeasure|reference|status|center|footer|caption)$/;
const walk = (o) => { if (Array.isArray(o)) return o.forEach(walk); if (o && typeof o === 'object') for (const k in o) { if (MKEY.test(k) && typeof o[k] === 'string') usedMeasures.add(o[k]); else walk(o[k]); } };
walk(pages);
// measures referenced inside other measures' calc ({Name} in templates, divide operands, c.m('Name') in js)
for (let grew = true; grew;) {
  grew = false;
  for (const m of measures) if (usedMeasures.has(m.name) && m.calc) {
    const txt = JSON.stringify(m.calc);
    for (const x of measures) if (!usedMeasures.has(x.name) && (txt.includes(`{${x.name}}`) || txt.includes(`"${x.name}"`) || txt.includes(`'${x.name}'`))) { usedMeasures.add(x.name); grew = true; }
  }
}
const missing = [...usedMeasures].filter((n) => !measures.find((m) => m.name === n && m.calc));
if (missing.length) fail('Add "calc" in state.model.measures for: ' + missing.join(', ') + '  (see references/state-schema.md → calc)');

// ---------- value labels for slicers / axes ----------
const valueLabels = {};
for (const p of pages) for (const s of p.slicers || []) if (s.labels) valueLabels[s.field] = s.labels;

// ---------- engine check in Node: unfiltered values ----------
const engine = createEngine({ locale, measures, derived, statics }, data);
const read = (f) => fs.readFileSync(path.join(__dirname, 'lib', f), 'utf8');
const outDir = A.out ? path.resolve(A.out) : path.join(proj, 'html');
fs.mkdirSync(outDir, { recursive: true });

const valuesOut = { rows: engine.all.length, pages: [] }; // --values <file>: raw numbers for reconcile.js
for (const page of pages) {
  let rows = engine.all;
  for (const f of page.filters || []) rows = engine.filter(rows, f);
  engine.setScope(engine.all, page.filters || []);
  console.log(`\n${page.id}: ${rows.length} rows after page filters`);
  const pv = { id: page.id, filters: page.filters || [], rows: rows.length, values: {}, groups: [] }; valuesOut.pages.push(pv);
  const seen = new Set();
  const show = (n) => { if (!n || seen.has(n)) return; seen.add(n); const v = engine.m(n, rows); pv.values[n] = v === undefined ? null : v; console.log(`  ${n.padEnd(26)} ${engine.fmt(n, v)}`); };
  if (page.headline && page.headline.measure) show(page.headline.measure);
  JSON.stringify(page.rows, (k, v) => { if (MKEY.test(k) && k !== 'status' && typeof v === 'string') show(v); return v; });
  // per category of a disconnected table (e.g. bands): the values each chart/ring shows
  JSON.stringify(page.rows, (k, v) => {
    if (v && v.category && engine.isStatic(v.category)) {
      const ms = [v.measure, v.caption].concat((v.series || []).map((s) => s.measure)).filter(Boolean);
      const key = v.category + ms.join();
      if (!seen.has(key)) {
        seen.add(key);
        for (const g of engine.groupBy(v.category, rows)) {
          const vals = {}; for (const n of ms) { const x = engine.m(n, rows, g.ctx); vals[n] = x === undefined ? null : x; }
          pv.groups.push({ category: v.category, key: g.key, values: vals });
          console.log(`  ${String(g.key).padEnd(10)} ${ms.map((n) => `${n} ${engine.fmt(n, vals[n])}`).join(' · ')}`);
        }
      }
    }
    return v;
  });
  for (const s of page.slicers || []) if (!engine.has(s.field)) warn.push(`Slicer field not embedded: ${s.field}`);

  const cfg = {
    locale, colors, font: ds.font, canvas: state.canvas, shell: SHELL, page, measures, derived, statics, colFormats, valueLabels,
  };
  const html = template(page, cfg, data);
  const out = path.join(outDir, `${page.id}.html`);
  fs.writeFileSync(out, html);
  console.log(`  → ${path.relative(process.cwd(), out)} (${(html.length / 1024).toFixed(0)} KB)`);
}
if (warn.length) { console.log('\nWarnings:'); warn.forEach((w) => console.log('  - ' + w)); }
if (A.values) fs.writeFileSync(path.resolve(A.values), JSON.stringify(valuesOut, null, 2));

// ---------- page template ----------
// Same shell defaults as build-pbir.js: header 72px; sidebar only when state.shell.sidebar exists
// (without one, slicers open from a "Filters" button in the header, like Power BI's header slicers).
function shellOf(st) {
  const sh = st.shell || {};
  return { header: Object.assign({ height: 72 }, sh.header), sidebar: sh.sidebar ? Object.assign({ width: 240 }, sh.sidebar) : null };
}
function template(page, cfg, data) {
  const SBW = SHELL.sidebar ? SHELL.sidebar.width : 0;
  const c = colors; const sh = ds.cardShadow;
  const rgba = (hex, a) => { const h = (hex || '#000000').replace('#', ''); return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`; };
  const shadow = sh ? `0 ${sh.distance || 2}px ${sh.blur || 6}px ${rgba(sh.color || c.ink, (100 - (sh.transparency == null ? 88 : sh.transparency)) / 100)}` : 'none';
  const json = (o) => JSON.stringify(o).replace(/</g, '\\u003c');
  // strong text on the sidebar: white on a dark sidebar, ink on a light one
  const lum = (hex) => { const h = (hex || '#000000').replace('#', ''); return (0.299 * parseInt(h.slice(0, 2), 16) + 0.587 * parseInt(h.slice(2, 4), 16) + 0.114 * parseInt(h.slice(4, 6), 16)) / 255; };
  const sbStrong = lum(c.sidebar) > 0.6 ? c.ink : (c.onAccent || '#fff');
  const brand = (state.shell && state.shell.sidebar && state.shell.sidebar.brand) || state.project;
  return `<!DOCTYPE html>
<html lang="${locale.slice(0, 2)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${brand} · ${page.title}</title>
<!-- Generated by pbi-delivery/scripts/build-html.js from state.json + real data. Do not edit by hand:
     change state.json and run the generator again. Contains real data: do not commit or publish. -->
<style>
:root{--page:${c.page};--frame:${c.pageFrame || c.page};--ink:${c.ink};--muted:${c.muted};--subtle:${c.subtle};--surface:${c.surface};--border:${c.border};
--accent:${c.accent};--on-accent:${c.onAccent || '#fff'};--sb:${c.sidebar};--sb-text:${c.sidebarText};--sb-sec:${c.sidebarSection};--sb-strong:${sbStrong};
--radius:${state.canvas.radius || 12}px;--shadow:${shadow};--font:${ds.font || 'Segoe UI, sans-serif'}}
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;overflow:hidden;background:var(--frame);font-family:var(--font);color:var(--ink);-webkit-font-smoothing:antialiased}
#stage{position:absolute;left:0;top:0;width:${state.canvas.width}px;height:${state.canvas.height}px;transform-origin:0 0;background:var(--page);overflow:hidden}
.abs{position:absolute}.num{font-feature-settings:"tnum" 1}
.sb{left:0;top:0;width:${SBW}px;height:100%;background:var(--sb)}
.sb .brand{left:24px;top:20px;font-size:24px;line-height:32px;font-weight:700;color:var(--sb-strong)}
.sb .sub{left:24px;top:52px;font-size:12px;line-height:20px;color:var(--sb-text)}
.sb .sec,.filters .sec{left:24px;font-size:11px;line-height:18px;font-weight:700;letter-spacing:.08em;color:var(--sb-sec)}
.sb .item{left:16px;width:${SBW - 32}px;height:40px;border-radius:8px;padding:0 16px;display:flex;align-items:center;font-size:14px;color:var(--sb-text)}
.sb .item.on{background:var(--accent);color:var(--on-accent);font-weight:600}
.filters{left:24px;width:${Math.max(SBW, 240) - 48}px;display:flex;flex-direction:column;gap:16px}
.filters.pop{left:auto;right:32px;width:280px;padding:16px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);box-shadow:0 8px 24px rgba(0,0,0,.12);z-index:5;max-height:70%;overflow:auto;
--sb-text:var(--muted);--sb-sec:var(--border);--sb-strong:var(--ink)}
.filters.pop[hidden]{display:none}
.fbtn{right:32px;top:${Math.round((SHELL.header.height - 34) / 2)}px;height:34px;padding:0 14px;border-radius:8px;border:1px solid var(--border);background:var(--surface);color:var(--ink);font:600 13px var(--font);cursor:pointer}
.fbtn.on{background:var(--accent);border-color:var(--accent);color:var(--on-accent)}
.slbl{font-size:12px;line-height:18px;color:var(--sb-text);margin-bottom:6px}
.rng{display:flex;flex-direction:column;gap:6px}
.rng input{width:100%;height:32px;border-radius:8px;border:1px solid var(--sb-sec);background:transparent;color:var(--sb-strong);font:13px var(--font);padding:0 10px}
.chips{display:flex;flex-wrap:wrap;gap:6px}
.chip{border:1px solid var(--sb-sec);background:transparent;color:var(--sb-text);border-radius:999px;font:12px var(--font);padding:4px 10px;cursor:pointer}
.chip:hover{color:var(--sb-strong);border-color:var(--sb-text)}
.chip.on{background:var(--accent);border-color:var(--accent);color:var(--on-accent)}
.clear{margin-top:4px;height:34px;border-radius:8px;border:1px solid var(--sb-sec);background:transparent;color:var(--sb-strong);font:600 13px var(--font);cursor:pointer}
.clear:disabled{opacity:.35;cursor:default}
.hd{left:${SBW}px;top:0;right:0;height:${SHELL.header.height}px;background:var(--surface);border-bottom:1px solid var(--border)}
.hd .title{left:32px;top:8px;font-size:24px;line-height:30px;font-weight:600;letter-spacing:-.01em}
.hd .headline{left:32px;top:40px;right:420px;font-size:14px;line-height:24px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hd .tag{right:32px;top:24px;font-size:12px;line-height:24px;color:var(--subtle);text-align:right}
.hd .tag .on{color:var(--accent);font-weight:600}
.tile{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow);overflow:hidden}
.tile.bare{background:none;border:0;box-shadow:none}
.kv{display:flex;flex-direction:column;gap:4px}.kv .lbl{font-size:12px;line-height:16px;color:var(--muted)}
.kv .val{font-size:28px;line-height:34px;font-weight:700;letter-spacing:-.01em}
.ref{font-size:12px;line-height:24px;color:var(--muted)}
.ctitle{left:24px;top:16px;font-size:16px;line-height:24px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.legend{right:24px;top:18px;display:flex;gap:16px;font-size:12px;line-height:20px;color:var(--muted)}
.legend span{display:inline-flex;align-items:center;gap:6px}.legend i{width:10px;height:10px;border-radius:2px;display:inline-block}
.empty{left:0;right:0;top:50%;text-align:center;color:var(--subtle);font-size:14px}
svg text{font-family:var(--font);font-size:12px;fill:var(--subtle)}
svg .grid{stroke:var(--border)}
svg .hit{fill:transparent;cursor:pointer}svg .hit:hover{fill:var(--ink);fill-opacity:.04}
.tbl{overflow:auto}.tbl table{width:100%;border-collapse:collapse;font-size:13px}
.tbl th{position:sticky;top:0;background:var(--surface);text-align:left;color:var(--muted);font-weight:600;padding:8px;border-bottom:1px solid var(--border)}
.tbl td{padding:8px;border-bottom:1px solid var(--border)}.tbl .r{text-align:right}
#tip{position:fixed;display:none;pointer-events:none;background:var(--ink);color:#fff;border-radius:8px;padding:10px 12px;font:12px/18px var(--font);box-shadow:0 4px 16px rgba(0,0,0,.2);min-width:180px;z-index:10}
#tip b{display:block;margin-bottom:4px;font-size:13px}#tip div{display:flex;align-items:center;gap:6px}
#tip i{width:8px;height:8px;border-radius:2px;display:inline-block}#tip span{margin-left:auto;padding-left:16px;font-weight:600}
#tip small{display:block;margin-top:6px;color:var(--subtle)}
</style>
</head>
<body>
<div id="stage"></div>
<div id="tip"></div>
<script>window.CFG=${json(cfg)};window.DATA=${json(data)};</script>
<script>
${read('html-engine.js')}
</script>
<script>
${read('html-ui.js')}
</script>
</body>
</html>
`;
}
