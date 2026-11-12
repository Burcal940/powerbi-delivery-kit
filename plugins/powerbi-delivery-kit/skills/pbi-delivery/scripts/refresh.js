#!/usr/bin/env node
// pbi-delivery · scripts/refresh.js — new data for an existing project (e.g. the monthly file).
//
//   node refresh.js --project <folder> [--no-html] [--desktop] [--no-write]
//
// 1. Checks the files in data/ against what the model expects (state.json + intake model plan):
//    - BLOCKING: a data file is missing; a column the model reads is missing (in any combined file);
//      duplicate keys in a dimension (Power BI refuses a many-to-one relationship on them).
//    - WARNINGS: values that no longer convert to the column type (text in a number/date column);
//      fact keys with no match in their dimension (they show as blank in Power BI); blanks in a column
//      that had none; fewer rows than the previous refresh; new columns the model ignores.
//    - Facts: rows and files per table, fact date range and the months added since the previous refresh.
// 2. Rebuilds the interactive HTML (build-html.js) unless --no-html.
// 3. --desktop (Windows): refreshes Power BI Desktop (pbi-desktop.js --refresh) and runs reconcile.js.
// Writes docs/validations/refresh-<date>.md and appends docs/validations/refresh-log.json
// (counts and date ranges only, no data values) unless --no-write.
// Exit 1 when a blocking problem is found (nothing after step 1 runs), 0 otherwise.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { readTableSource } = require('./lib/read-data');

const A = {};
for (let i = 2; i < process.argv.length; i++) {
  const k = process.argv[i].replace(/^--/, '');
  const v = process.argv[i + 1];
  if (v === undefined || v.startsWith('--')) A[k] = true; else { A[k] = v; i++; }
}
if (!A.project) { console.error('Usage: node refresh.js --project <folder> [--no-html] [--desktop] [--no-write]'); process.exit(2); }
const PROJ = path.resolve(A.project);
const statePath = path.join(PROJ, 'state.json');
if (!fs.existsSync(statePath)) { console.error(`ERROR no state.json in ${PROJ}`); process.exit(2); }
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
const planPath = state.intake && state.intake.plan ? path.resolve(PROJ, state.intake.plan) : null;
const plan = planPath && fs.existsSync(planPath) ? JSON.parse(fs.readFileSync(planPath, 'utf8')) : { tables: [] };
const dataDir = path.join(PROJ, 'data');
const valDir = path.join(PROJ, 'docs', 'validations');
const logPath = path.join(valDir, 'refresh-log.json');
const log = fs.existsSync(logPath) ? JSON.parse(fs.readFileSync(logPath, 'utf8')) : [];
const prev = log.length ? log[log.length - 1] : null;
const today = new Date().toISOString().slice(0, 10);
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();

const blocking = []; const warnings = []; const info = [];
const model = state.model || {};
const tables = (model.tables || []).filter((t) => !Array.isArray(t.rows));
const rels = model.relationships || [];
const fact = tables.find((t) => t.role === 'fact') || tables[0];

// ---------- value checks ----------
const isBlank = (v) => v == null || String(v).trim() === '';
function toDate(v, order) {
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  if (m) { const [d, mo] = order === 'DMY' ? [m[1], m[2]] : [m[2], m[1]]; if (+mo >= 1 && +mo <= 12 && +d >= 1 && +d <= 31) return `${m[3]}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`; }
  return null;
}
function toNumber(v, culture) {
  const s = String(v).trim().replace(/[$€£\s]/g, '');
  const n = culture === 'comma-decimal' ? Number(s.replace(/\./g, '').replace(',', '.')) : Number(/^-?\d+,\d+$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, ''));
  return isNaN(n) ? null : n;
}
const okFor = (type, v, c) => {
  if (type === 'int' || type === 'decimal') return toNumber(v, c.culture) != null;
  if (type === 'date' || type === 'datetime') return toDate(v, c.dateOrder) != null;
  if (type === 'bool') return /^(true|false|1|0|yes|no|si|sí|y|n)$/i.test(String(v).trim());
  return true;
};

// ---------- read and check every table with a data file ----------
const result = {}; const keySets = {};
for (const t of tables) {
  const pt = plan.tables.find((p) => norm(p.source) === norm(t.source)) || plan.tables.find((p) => p.name === t.name);
  if (!t.source && !(pt && pt.source)) continue; // generated in M (e.g. a calendar)
  let src;
  try { src = readTableSource(dataDir, t, pt); } catch (e) { blocking.push(e.message); continue; }
  const cols = pt ? pt.columns : [];
  const r = { files: src.files.map((f) => path.basename(f)), rows: src.rows.length };
  result[t.name] = r;

  // columns the model reads, in every combined file
  for (const p of src.parts) {
    const hdr = new Set(p.header.map(norm));
    const missing = cols.filter((c) => !hdr.has(norm(c.source))).map((c) => `${c.name} ("${c.source}")`);
    if (missing.length) blocking.push(`${t.name}: ${path.basename(p.file)} has no column ${missing.join(', ')} — rename it back in the file, or change the model (state.json + build-model.js)`);
  }
  const known = new Set(cols.map((c) => norm(c.source)));
  const extra = src.header.filter((h) => !known.has(norm(h)));
  if (cols.length && extra.length) info.push(`${t.name}: new column(s) not in the model: ${extra.join(', ')}`);

  const idx = (c) => src.header.findIndex((h) => norm(h) === norm(c.source));
  for (const c of cols) {
    const i = idx(c); if (i < 0) continue;
    const vals = src.rows.map((row) => row[i]);
    const bad = vals.filter((v) => !isBlank(v) && !okFor(c.type, v, c));
    if (bad.length) warnings.push(`${t.name}[${c.name}]: ${bad.length} value(s) are not ${c.type} (e.g. ${[...new Set(bad)].slice(0, 3).map((v) => JSON.stringify(v)).join(', ')}) — Power BI loads them as errors/blank`);
    const blanks = vals.filter(isBlank).length;
    if (blanks && c.nulls === 0) warnings.push(`${t.name}[${c.name}]: ${blanks} blank value(s); the column had none at intake`);
  }

  // dimension keys
  const keyRel = rels.find((x) => x.toTable === t.name);
  if (keyRel && t !== fact) {
    const kc = cols.find((c) => c.name === keyRel.toColumn); const i = kc ? idx(kc) : -1;
    if (i >= 0) {
      const seen = new Set(); const dups = new Set();
      for (const row of src.rows) { const k = norm(row[i]); if (seen.has(k)) dups.add(row[i]); seen.add(k); }
      if (dups.size) blocking.push(`${t.name}[${keyRel.toColumn}]: ${dups.size} duplicate key(s) (e.g. ${[...dups].slice(0, 3).join(', ')}) — the many-to-one relationship will fail to refresh`);
      keySets[t.name] = seen;
    }
  }

  // fact date range
  if (t === fact) {
    const dateRel = rels.find((x) => x.fromTable === t.name && /date/i.test(x.toTable));
    const dc = cols.find((c) => dateRel ? c.name === dateRel.fromColumn : c.type === 'date' || c.type === 'datetime');
    const i = dc ? idx(dc) : -1;
    if (i >= 0) {
      const ds = src.rows.map((row) => (isBlank(row[i]) ? null : toDate(row[i], dc.dateOrder))).filter(Boolean).sort();
      if (ds.length) {
        r.dateColumn = dc.name; r.from = ds[0]; r.to = ds[ds.length - 1];
        r.months = [...new Set(ds.map((d) => d.slice(0, 7)))];
      }
    }
  }
}

// fact keys without a dimension row
if (fact && result[fact.name]) {
  const pt = plan.tables.find((p) => norm(p.source) === norm(fact.source)) || plan.tables.find((p) => p.name === fact.name);
  let src = null; try { src = readTableSource(dataDir, fact, pt); } catch { /* reported above */ }
  for (const rel of rels.filter((x) => x.fromTable === fact.name && keySets[x.toTable])) {
    const c = pt && pt.columns.find((x) => x.name === rel.fromColumn);
    const i = src && c ? src.header.findIndex((h) => norm(h) === norm(c.source)) : -1;
    if (i < 0) continue;
    const orphans = new Set(src.rows.map((row) => row[i]).filter((v) => !isBlank(v) && !keySets[rel.toTable].has(norm(v))));
    if (orphans.size) warnings.push(`${fact.name}[${rel.fromColumn}]: ${orphans.size} key(s) not in ${rel.toTable} (e.g. ${[...orphans].slice(0, 3).join(', ')}) — they show as blank in Power BI`);
  }
}

// compare with the previous refresh
let newMonths = [];
if (prev) {
  for (const [name, r] of Object.entries(result)) {
    const p = prev.tables && prev.tables[name];
    if (p && r.rows < p.rows) warnings.push(`${name}: ${r.rows} rows, fewer than the ${p.rows} of the previous refresh (${prev.date}) — was a file replaced instead of added?`);
    if (p && p.months && r.months) newMonths = r.months.filter((m) => !p.months.includes(m));
  }
}

const f = fact && result[fact.name];
const summary = {
  ok: blocking.length === 0,
  project: path.basename(PROJ),
  date: today,
  tables: result,
  factRange: f && f.from ? { from: f.from, to: f.to, months: f.months.length } : null,
  newMonths: prev ? newMonths : undefined,
  previous: prev ? prev.date : null,
  blocking, warnings, info,
};

// ---------- downstream steps ----------
const steps = [];
const node = (script, args) => spawnSync(process.execPath, [path.join(__dirname, script), ...args], { encoding: 'utf8', timeout: 900000 });
if (summary.ok && !A['no-html']) {
  const r = node('build-html.js', ['--state', statePath]);
  steps.push({ step: 'build-html', ok: r.status === 0, output: (r.status === 0 ? r.stdout : r.stderr || r.stdout).trim().split(/\r?\n/).slice(-40).join('\n') });
}
if (summary.ok && A.desktop) {
  if (process.platform !== 'win32') steps.push({ step: 'desktop', ok: false, output: 'Power BI Desktop runs on Windows only' });
  else {
    const d = node('pbi-desktop.js', ['--project', PROJ, '--refresh']);
    steps.push({ step: 'pbi-desktop --refresh', ok: d.status === 0, output: (d.stdout + d.stderr).trim().split(/\r?\n/).slice(-15).join('\n') });
    if (d.status === 0) {
      const rc = node('reconcile.js', ['--project', PROJ]);
      steps.push({ step: 'reconcile', ok: rc.status === 0, output: (rc.stdout + rc.stderr).trim().split(/\r?\n/).slice(-15).join('\n') });
    }
  }
}
summary.steps = steps.map((s) => ({ step: s.step, ok: s.ok }));

// ---------- evidence ----------
if (!A['no-write']) {
  fs.mkdirSync(valDir, { recursive: true });
  const md = [`# Data refresh — ${today}`, '',
    `Generated by \`refresh.js\` from the files in \`data/\`. ${summary.ok ? 'No blocking problem.' : `**${blocking.length} blocking problem(s): the refresh stopped.**`}`, '',
    '| Table | Files | Rows | Previous | Date range |', '|---|---|---|---|---|',
    ...Object.entries(result).map(([n, r]) => `| ${n} | ${r.files.length > 3 ? `${r.files.length} files` : r.files.join(', ')} | ${r.rows} | ${prev && prev.tables && prev.tables[n] ? prev.tables[n].rows : '—'} | ${r.from ? `${r.from} → ${r.to} (${r.months.length} months)` : ''} |`), '',
    prev ? `New months since ${prev.date}: ${newMonths.length ? newMonths.join(', ') : 'none'}` : 'First refresh logged.', ''];
  const sect = (title, list) => { if (list.length) md.push(`## ${title}`, '', ...list.map((x) => `- ${x}`), ''); };
  sect('Blocking', blocking); sect('Warnings', warnings); sect('Info', info);
  for (const s of steps) md.push(`## ${s.step} — ${s.ok ? 'ok' : 'FAILED'}`, '', '```', s.output, '```', '');
  fs.writeFileSync(path.join(valDir, `refresh-${today}.md`), md.join('\n'));
  if (summary.ok) {
    const entry = { date: today, tables: Object.fromEntries(Object.entries(result).map(([n, r]) => [n, { rows: r.rows, files: r.files.length, from: r.from, to: r.to, months: r.months }])) };
    fs.writeFileSync(logPath, JSON.stringify(log.filter((e) => e.date !== today).concat(entry), null, 2) + '\n');
  }
  summary.report = path.relative(PROJ, path.join(valDir, `refresh-${today}.md`)).replace(/\\/g, '/');
}

const ascii = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[—–]/g, '-').replace(/→/g, '->').replace(/[^\x00-\x7f]/g, '?');
console.log(ascii(JSON.stringify(summary, null, 2)));
process.exit(summary.ok && steps.every((s) => s.ok) ? 0 : 1);
