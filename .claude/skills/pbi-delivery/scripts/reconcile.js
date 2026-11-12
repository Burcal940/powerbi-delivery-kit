#!/usr/bin/env node
// pbi-delivery · reconcile.js
// Proves the HTML twin and Power BI print the same numbers, and writes the evidence.
//   1. runs build-html.js --values (same state.json + data/) → the numbers the HTML computes
//   2. runs the same measures as DAX against the model open in Power BI Desktop (local Analysis
//      Services, through Desktop's own ADOMD client — Windows only, nothing to install), with the page
//      filters and, for disconnected tables (bands), one row per category
//   3. compares them and writes docs/validations/reconcile-<YYYY-MM-DD>.md
//
// Usage: node reconcile.js --project <folder> [--page <id>] [--port <n>] [--no-write]
// Needs: Desktop open on this project and refreshed (pbi-desktop.js --fresh). Exit 1 on any difference.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const A = {};
for (let i = 2; i < process.argv.length; i++) {
  const k = process.argv[i].replace(/^--/, '');
  if (k === 'no-write') A.noWrite = true; else A[k] = process.argv[++i];
}
if (!A.project) { console.error('Usage: node reconcile.js --project <folder> [--page <id>] [--port <n>] [--no-write]'); process.exit(2); }
if (process.platform !== 'win32') { console.error('reconcile.js needs Windows (Power BI Desktop).'); process.exit(2); }

const PROJ = path.resolve(A.project);
const statePath = path.join(PROJ, 'state.json');
const state = JSON.parse(fs.readFileSync(statePath, 'utf8').replace(/^﻿/, ''));
const model = state.model || {};
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pbi-reconcile-'));
const fail = (m) => { console.error('ERROR: ' + m); process.exit(2); };

// ---------- 1. HTML numbers ----------
const valuesFile = path.join(tmp, 'values.json');
const bh = spawnSync(process.execPath, [path.join(__dirname, 'build-html.js'), '--state', statePath, '--out', path.join(tmp, 'html'), '--values', valuesFile].concat(A.page ? ['--page', A.page] : []), { encoding: 'utf8' });
if (bh.status !== 0 || !fs.existsSync(valuesFile)) fail('build-html.js failed:\n' + (bh.stderr || bh.stdout));
const html = JSON.parse(fs.readFileSync(valuesFile, 'utf8'));
const htmlWarnings = (bh.stdout.split('\nWarnings:')[1] || '').trim();

// ---------- 2. DAX ----------
const q = (t) => `'${String(t).replace(/'/g, "''")}'`;
const colRef = (field) => { const m = String(field).match(/^(.+?)\[(.+)\]$/); if (!m) fail(`not a Table[Column] field: ${field}`); return `${q(m[1].replace(/^'|'$/g, ''))}[${m[2]}]`; };
const lit = (v) => {
  if (v == null) return 'BLANK()';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'TRUE()' : 'FALSE()';
  const d = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/); if (d) return `DATE(${+d[1]}, ${+d[2]}, ${+d[3]})`;
  return `"${String(v).replace(/"/g, '""')}"`;
};
const daxFilter = (f) => {
  const c = colRef(f.field);
  if (f.values) return `TREATAS({${f.values.map(lit).join(', ')}}, ${c})`;
  const cond = [`NOT ISBLANK(${c})`].concat(f.min != null ? [`${c} >= ${lit(f.min)}`] : [], f.max != null ? [`${c} <= ${lit(f.max)}`] : []);
  return `FILTER(ALL(${c}), ${cond.join(' && ')})`;
};
const factTable = ((model.tables || []).find((t) => t.role === 'fact' || t.combine || t.derivedColumns) || {}).name || ((model.relationships || [])[0] || {}).fromTable;
const calcOf = (expr, filters) => (filters.length ? `CALCULATE(${expr}, ${filters.map(daxFilter).join(', ')})` : expr);

function queries(p) {
  const out = [];
  const names = Object.keys(p.values);
  const cols = [['__rows', factTable ? `COUNTROWS(${q(factTable)})` : '0']].concat(names.map((n, i) => [`m${i}`, `[${n.replace(/\]/g, ']]')}]`]));
  out.push({ kind: 'page', names, dax: `EVALUATE ROW(${cols.map(([k, e]) => `"${k}", ${calcOf(e, p.filters)}`).join(', ')})` });
  const byCat = {};
  for (const g of p.groups) {
    byCat[g.category] = byCat[g.category] || new Set();
    for (const n of Object.keys(g.values)) byCat[g.category].add(n);
  }
  for (const cat of Object.keys(byCat)) {
    const ms = [...byCat[cat]]; const tbl = cat.match(/^(.+?)\[/)[1].replace(/^'|'$/g, '');
    out.push({ kind: 'group', category: cat, names: ms, dax: `EVALUATE SELECTCOLUMNS(${q(tbl)}, "__key", ${colRef(cat)}, ${ms.map((n, i) => `"m${i}", ${calcOf(`[${n.replace(/\]/g, ']]')}]`, p.filters)}`).join(', ')})` });
  }
  return out;
}

function ports() {
  const roots = [path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Power BI Desktop', 'AnalysisServicesWorkspaces'),
    path.join(process.env.USERPROFILE || '', 'Microsoft', 'Power BI Desktop Store App', 'AnalysisServicesWorkspaces')];
  const found = [];
  for (const r of roots) {
    if (!fs.existsSync(r)) continue;
    for (const d of fs.readdirSync(r)) {
      const f = path.join(r, d, 'Data', 'msmdsrv.port.txt');
      if (fs.existsSync(f)) found.push({ port: +fs.readFileSync(f).toString('utf16le').replace(/\D/g, ''), mtime: fs.statSync(f).mtimeMs });
    }
  }
  return found.filter((x) => x.port).sort((a, b) => b.mtime - a.mtime).map((x) => x.port);
}

const PS1 = path.join(__dirname, 'lib', 'dax-query.ps1');
let qn = 0;
function runDax(port, dax) {
  const f = path.join(tmp, `q${++qn}.dax`); fs.writeFileSync(f, dax);
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', PS1, '-Port', String(port), '-QueryFile', f], { encoding: 'utf8', timeout: 360000 });
  try { return JSON.parse(r.stdout); } catch { return { ok: false, error: (r.stderr || r.stdout || 'no output').trim() }; }
}

const plan = html.pages.map((p) => ({ page: p, qs: queries(p) }));
const candidates = A.port ? [+A.port] : ports();
if (!candidates.length) fail('No Power BI Desktop model found. Open the project first: node pbi-desktop.js --project <folder> --fresh');
let port = null; let firstErr = null; const matched = [];
for (const c of candidates) {
  const r = runDax(c, plan[0].qs[0].dax);
  if (r.ok) { matched.push(c); if (!port) { port = c; plan[0].qs[0].result = r; } } else if (!firstErr) firstErr = `port ${c}: ${r.error}`;
}
if (!port) fail('No open Desktop model answers the page query (wrong project open, or a measure is missing — run build-model.js --check).\n' + firstErr);
for (const { qs } of plan) for (const x of qs) if (!x.result) { x.result = runDax(port, x.dax); if (!x.result.ok) fail(`DAX failed (${x.kind}${x.category ? ' ' + x.category : ''}): ${x.result.error}\n${x.dax}`); }

// ---------- 3. compare ----------
const same = (a, b) => {
  if (a == null || b == null) return a == null && b == null;
  if (typeof a === 'number' || typeof b === 'number') { const x = +a; const y = +b; return Math.abs(x - y) <= 1e-6 * Math.max(1, Math.abs(x), Math.abs(y)); }
  return String(a).trim() === String(b).trim();
};
const show = (v) => (v == null ? '(blank)' : typeof v === 'number' ? String(Math.round(v * 1e6) / 1e6) : `"${v}"`);
const lines = []; const diffs = []; let checked = 0;
for (const { page, qs } of plan) {
  const [pq, ...gq] = qs; const row = pq.result.rows[0] || []; const at = (k) => row[pq.result.columns.findIndex((c) => c.replace(/^\[|\]$/g, '') === k)];
  lines.push(`\n## ${page.id}\n\n| Check | Power BI (DAX) | HTML | |\n|---|---:|---:|---|`);
  const add = (label, pbi, h, text) => { checked++; const ok = same(pbi, h); if (!ok) diffs.push({ page: page.id, label, pbi, html: h, text }); lines.push(`| ${label} | ${show(pbi)} | ${show(h)} | ${ok ? 'OK' : text ? 'TEXT DIFFERS' : '**DIFFERENT**'} |`); };
  add(`Rows (${factTable || '?'}) after page filters`, at('__rows'), page.rows);
  pq.names.forEach((n, i) => add(n, at(`m${i}`), page.values[n], typeof page.values[n] === 'string'));
  for (const g of gq) {
    const ci = (k) => g.result.columns.findIndex((c) => c.replace(/^.*\[|\]$/g, '') === k);
    for (const r of g.result.rows) {
      const key = r[ci('__key')];
      g.names.forEach((n, i) => {
        const hg = page.groups.find((x) => x.category === g.category && same(x.key, key) && n in x.values); if (!hg) return;
        add(`${n} · ${key}`, r[ci(`m${i}`)], hg.values[n], typeof hg.values[n] === 'string');
      });
    }
  }
}
const numDiffs = diffs.filter((d) => !d.text);
const today = new Date().toISOString().slice(0, 10);
const md = `# Reconciliation — ${today}\n\nPower BI Desktop model (DAX, local Analysis Services) vs. the interactive HTML (\`build-html.js\`, \`calc\`),\nsame \`state.json\` and the same files in \`data/\` (${html.rows} rows read by the HTML).\nGenerated by \`reconcile.js\`; numbers are compared with a relative tolerance of 1e-6.\n\n**Result:** ${checked - diffs.length}/${checked} equal${numDiffs.length ? ` — **${numDiffs.length} numeric difference(s)**` : ''}${diffs.length - numDiffs.length ? ` — ${diffs.length - numDiffs.length} text difference(s) (labels/formatting: review)` : ''}.\n${lines.join('\n')}\n${htmlWarnings ? `\n## build-html warnings\n\n${htmlWarnings}\n` : ''}`;
let out = null;
if (!A.noWrite) { const dir = path.join(PROJ, 'docs', 'validations'); fs.mkdirSync(dir, { recursive: true }); out = path.join(dir, `reconcile-${today}.md`); fs.writeFileSync(out, md); }
fs.rmSync(tmp, { recursive: true, force: true });
console.log(JSON.stringify({ ok: numDiffs.length === 0, port, otherMatchingModels: matched.length > 1 ? matched.slice(1) : undefined, checked, equal: checked - diffs.length, differences: diffs, written: out && path.relative(process.cwd(), out) }, null, 2));
if (matched.length > 1) console.error(`Several open Desktop models answered (ports ${matched.join(', ')}); used ${port}. Close the others or pass --port.`);
process.exit(numDiffs.length ? 1 : 0);
