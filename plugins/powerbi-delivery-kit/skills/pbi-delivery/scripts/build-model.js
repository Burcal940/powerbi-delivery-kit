#!/usr/bin/env node
// pbi-delivery · build-model.js
// The semantic model as code: state.json `model` <-> the PBIP's TMDL, without the modeling MCP.
//
//   node build-model.js --project <folder> --check     (default) compare state.json with the TMDL on disk:
//                                                       missing / extra / different measures, columns,
//                                                       partitions (M) and relationships. Exit 1 on drift.
//   node build-model.js --project <folder> --import    copy what the TMDL has into state.json (dax, folder,
//                                                       doc, formatString per measure; columns + M per table).
//                                                       Use once on a model built by hand / MCP, then keep
//                                                       state.json as the source.
//   node build-model.js --project <folder> --write [--prune]
//                                                       write the TMDL from state.json. Lineage tags and
//                                                       relationship ids are kept from disk. Never touches
//                                                       .platform, definition.pbism, database.tmdl, cultures/
//                                                       or parameter values. Refuses to drop a measure, table
//                                                       or relationship that is on disk but not in state.json
//                                                       unless --prune.
//   Afterwards: node pbi-desktop.js --project <folder> --fresh   (Desktop reads TMDL only when it opens).
//
// Tables without a `tmdl` block are generated: fact tables from intake/generated/model-plan.json +
// queries.pq (+ derivedColumns[].m), `Dim Date` from the fact date column, static tables from `rows`.
// Measures without `dax` get one from a simple `calc` (sum / avg / min / max / count / distinct / divide).
// Output is plain ASCII.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const a = { mode: 'check' };
for (let i = 2; i < process.argv.length; i++) {
  const k = process.argv[i].replace(/^--/, '');
  if (['check', 'import', 'write', 'prune'].includes(k)) { if (k === 'prune') a.prune = true; else a.mode = k; } else a[k] = process.argv[++i];
}
if (!a.project) { console.error('Usage: node build-model.js --project <folder> [--check | --import | --write [--prune]]'); process.exit(2); }

const PROJ = path.resolve(a.project);
const STATE = path.join(PROJ, 'state.json');
const read = (p) => { try { return fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''); } catch { return null; } };
const state = JSON.parse(read(STATE) || 'null');
if (!state || !state.model) { console.error(`ERROR ${STATE} has no model`); process.exit(2); }
const model = state.model;
model.tables = model.tables || [];
model.measures = model.measures || [];
model.relationships = model.relationships || [];
const MT = model.measureTable || '_Measures';

function findDir(dir, suffix, depth = 2) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory() || /^(\.git|node_modules|data|html|intake|mockups)$/.test(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.name.endsWith(suffix)) return p;
    if (depth > 0) { const r = findDir(p, suffix, depth - 1); if (r) return r; }
  }
  return null;
}
const SM = findDir(PROJ, '.SemanticModel');
if (!SM) { console.error('ERROR no *.SemanticModel folder: save the empty PBIP from Power BI Desktop first'); process.exit(2); }
const DEF = path.join(SM, 'definition');
const TABLES = path.join(DEF, 'tables');

// ---------- TMDL reader (the subset Power BI Desktop writes) ----------
const unq = (s) => (s && s[0] === "'" ? s.slice(1, -1).replace(/''/g, "'") : s);
const q = (n) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(n) ? n : `'${n.replace(/'/g, "''")}'`);

function parseTree(text) {
  const L = text.replace(/\r/g, '').split('\n');
  const root = { indent: -1, children: [] }; const stack = [root]; let desc = [];
  for (let i = 0; i < L.length; i++) {
    const raw = L[i]; if (!raw.trim()) continue;
    const ind = raw.match(/^\t*/)[0].length; const s = raw.trim();
    if (s.startsWith('///')) { desc.push(s.replace(/^\/\/\/ ?/, '')); continue; }
    while (stack[stack.length - 1].indent >= ind) stack.pop();
    const node = { indent: ind, line: s, desc: desc.join('\n') || null, children: [], expr: null, raw: [raw] };
    desc = [];
    stack[stack.length - 1].children.push(node); stack.push(node);
    if (/(^|\s)=$/.test(s)) { // multi-line expression: deeper lines (>= ind + 2), blank lines inside kept
      const ex = []; let j = i + 1;
      while (j < L.length) {
        const r = L[j];
        if (!r.trim()) { let k = j + 1; while (k < L.length && !L[k].trim()) k++; if (k < L.length && L[k].match(/^\t*/)[0].length >= ind + 2) { ex.push(''); j++; continue; } break; }
        if (r.match(/^\t*/)[0].length < ind + 2) break;
        ex.push(r); j++;
      }
      const min = Math.min(...ex.filter((x) => x.trim()).map((x) => x.match(/^\t*/)[0].length));
      node.expr = ex.map((x) => x.slice(min).replace(/\s+$/, '')).join('\n');
      node.raw.push(...ex);
      i = j - 1;
    }
  }
  return root.children;
}
function head(s) {
  const m = s.match(/^(\w+)\s+('(?:[^']|'')*'|[^\s=]+)(?:\s*=\s*(.*))?$/);
  return m ? { kind: m[1], name: unq(m[2]), rhs: m[3] === undefined ? null : m[3] } : { kind: s, name: null, rhs: null };
}
function props(node) {
  const p = {};
  for (const c of node.children) {
    const m = c.line.match(/^(\w+):\s?(.*)$/);
    if (m) p[m[1]] = m[2];
    else if (/^\w+$/.test(c.line)) p[c.line] = true;
  }
  return p;
}
const rawBlock = (n) => { const out = []; const walk = (x) => { if (x.desc) out.push(...x.desc.split('\n').map((d) => '\t'.repeat(x.indent) + '/// ' + d)); out.push(...x.raw); x.children.forEach(walk); }; walk(n); return out.join('\n'); };

function readTable(file) {
  const t = parseTree(read(file)).find((n) => head(n.line).kind === 'table');
  if (!t) return null;
  const tp = props(t); const lineage = tp.lineageTag; delete tp.lineageTag;
  const out = { name: head(t.line).name, doc: t.desc, props: tp, lineage, columns: [], measures: [], partitions: [], annotations: {}, other: [] };
  for (const c of t.children) {
    const h = head(c.line);
    if (h.kind === 'column') {
      const p = props(c); const lt = p.lineageTag; delete p.lineageTag;
      const col = { name: h.name, doc: c.desc, ...p, lineage: lt };
      if (h.rhs !== null) col.dax = h.rhs || c.expr; // calculated column
      out.columns.push(col);
    } else if (h.kind === 'measure') {
      const p = props(c); const lt = p.lineageTag; delete p.lineageTag;
      out.measures.push({ name: h.name, doc: c.desc, dax: h.rhs || c.expr, props: p, lineage: lt });
    } else if (h.kind === 'partition') {
      const p = props(c); const src = c.children.find((x) => /^source\s*=/.test(x.line));
      out.partitions.push({ name: h.name, type: h.rhs, mode: p.mode, m: src ? (src.expr != null ? src.expr : src.line.replace(/^source\s*=\s*/, '')) : null });
    } else if (h.kind === 'annotation') out.annotations[h.name] = h.rhs;
    else if (!/^\w+:/.test(c.line) && !/^\w+$/.test(c.line)) out.other.push(rawBlock(c).split('\n').map((l) => l.replace(/^\t/, '')).join('\n'));
  }
  return out;
}
function readDisk() {
  const tables = {};
  if (fs.existsSync(TABLES)) for (const f of fs.readdirSync(TABLES).filter((x) => x.endsWith('.tmdl'))) {
    const t = readTable(path.join(TABLES, f)); if (t) { t.file = f; tables[t.name] = t; }
  }
  const rels = [];
  const rt = read(path.join(DEF, 'relationships.tmdl'));
  if (rt) for (const n of parseTree(rt).filter((x) => head(x.line).kind === 'relationship')) {
    const p = props(n); const col = (s) => { const m = s.match(/^('(?:[^']|'')*'|[^.]+)\.('(?:[^']|'')*'|.+)$/); return [unq(m[1]), unq(m[2])]; };
    const [ft, fc] = col(p.fromColumn); const [tt, tc] = col(p.toColumn);
    const r = { id: head(n.line).name, fromTable: ft, fromColumn: fc, toTable: tt, toColumn: tc };
    if (p.crossFilteringBehavior === 'bothDirections') r.direction = 'both';
    if (p.isActive === 'false') r.active = false;
    if (p.fromCardinality === 'one' || p.toCardinality === 'many') r.cardinality = `${p.fromCardinality || 'many'}-to-${p.toCardinality || 'one'}`;
    const extra = Object.fromEntries(Object.entries(p).filter(([k]) => !['fromColumn', 'toColumn', 'crossFilteringBehavior', 'isActive', 'fromCardinality', 'toCardinality'].includes(k)));
    if (Object.keys(extra).length) r.tmdlProps = extra;
    rels.push(r);
  }
  return { tables, rels };
}

// ---------- state.json -> canonical model ----------
const TYPE = { int: 'int64', integer: 'int64', int64: 'int64', text: 'string', string: 'string', datetime: 'dateTime', date: 'dateTime', decimal: 'double', number: 'double', double: 'double', bool: 'boolean', boolean: 'boolean', currency: 'decimal' };
const MTYPE = { int64: 'Int64.Type', string: 'type text', dateTime: 'type datetime', double: 'type number', boolean: 'type logical', decimal: 'Currency.Type' };
const warnings = [];
const plan = JSON.parse(read(path.join(PROJ, 'intake', 'generated', 'model-plan.json')) || 'null');
const pq = read(path.join(PROJ, 'intake', 'generated', 'queries.pq')) || '';
const pqBlock = (name) => { const m = pq.match(new RegExp(`^// ${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b.*\\n([\\s\\S]*?)(?=\\n// |(?![\\s\\S]))`, 'm')); return m ? m[1].trim() : null; };
const fmtToTmdl = (f) => (f == null ? null : f.replace(/"([^"]*)"/g, (_, s) => s.replace(/[$€£]/g, '\\$&')));
const colRef = (s) => { const m = String(s).match(/^(.+?)\[(.+)\]$/); return m ? `${q(m[1].replace(/^'|'$/g, ''))}[${m[2]}]` : s; };

function daxFromCalc(c) {
  if (!c) return null;
  if (c.agg && !c.where) {
    if (c.agg === 'count') return c.column ? `COUNT(${colRef(c.column)})` : null;
    const f = { sum: 'SUM', avg: 'AVERAGE', min: 'MIN', max: 'MAX', distinct: 'DISTINCTCOUNTNOBLANK' }[c.agg];
    return f && c.column ? `${f}(${colRef(c.column)})` : null;
  }
  if (c.divide) return c.blankAsZero ? `DIVIDE([${c.divide[0]}] + 0, [${c.divide[1]}])` : `DIVIDE([${c.divide[0]}], [${c.divide[1]}])`;
  return null;
}

function generateTable(t) {
  // static table from rows
  if (Array.isArray(t.rows) && t.rows.length) {
    const keys = Object.keys(t.rows[0]);
    const typ = (k) => (t.rows.every((r) => Number.isInteger(r[k])) ? ['int64', 'Int64.Type'] : t.rows.every((r) => typeof r[k] === 'number') ? ['double', 'number'] : ['string', 'text']);
    const lit = (v) => (typeof v === 'number' ? String(v) : `"${String(v).replace(/"/g, '""')}"`);
    const m = `let\n    Source = #table(\n        type table [${keys.map((k) => `${q(k).replace(/^'(.*)'$/, '#"$1"')} = ${typ(k)[1]}`).join(', ')}],\n        {\n${t.rows.map((r) => `            {${keys.map((k) => lit(r[k])).join(', ')}}`).join(',\n')}\n        })\nin\n    Source`;
    return { props: {}, columns: keys.map((k) => ({ name: k, dataType: typ(k)[0], summarizeBy: 'none', sourceColumn: k })), partition: { mode: 'import', m } };
  }
  // Dim Date from the fact date column that relates to it
  const rel = model.relationships.find((r) => r.toTable === t.name);
  if (/^Dim Date$/i.test(t.name) || t.role === 'date') {
    if (!rel) { warnings.push(`${t.name}: no relationship from a fact date column, cannot generate it`); return null; }
    const m = `let\n    FactDates = ${q(rel.fromTable).replace(/^'(.*)'$/, '#"$1"')}[${rel.fromColumn}],\n    Start = Date.StartOfYear(Date.From(List.Min(FactDates))),\n    End = Date.EndOfYear(Date.From(List.Max(FactDates))),\n    Dates = List.Dates(Start, Duration.Days(End - Start) + 1, #duration(1, 0, 0, 0)),\n    T = Table.FromList(Dates, Splitter.SplitByNothing(), {"${rel.toColumn}"}),\n    Typed = Table.TransformColumnTypes(T, {{"${rel.toColumn}", type date}}),\n    Y = Table.AddColumn(Typed, "Year", each Date.Year([${rel.toColumn}]), Int64.Type),\n    Q = Table.AddColumn(Y, "Quarter", each "Q" & Text.From(Date.QuarterOfYear([${rel.toColumn}])), type text),\n    MN = Table.AddColumn(Q, "Month Number", each Date.Month([${rel.toColumn}]), Int64.Type),\n    M = Table.AddColumn(MN, "Month", each Date.ToText([${rel.toColumn}], [Format = "MMM", Culture = "${state.locale || 'en-US'}"]), type text),\n    YM = Table.AddColumn(M, "Year Month", each Date.Year([${rel.toColumn}]) * 100 + Date.Month([${rel.toColumn}]), Int64.Type),\n    MY = Table.AddColumn(YM, "Month Year", each Date.ToText([${rel.toColumn}], [Format = "MMM yyyy", Culture = "${state.locale || 'en-US'}"]), type text),\n    AsDateTime = Table.TransformColumnTypes(MY, {{"${rel.toColumn}", type datetime}})\nin\n    AsDateTime`;
    const c = (name, dataType, extra = {}) => ({ name, dataType, ...extra, summarizeBy: 'none', sourceColumn: name });
    return { props: { dataCategory: 'Time' }, columns: [c(rel.toColumn, 'dateTime', { isKey: true, formatString: 'Short Date' }), c('Year', 'int64', { formatString: '0' }), c('Quarter', 'string'), c('Month Number', 'int64', { isHidden: true, formatString: '0' }), c('Month', 'string', { sortByColumn: q('Month Number') }), c('Year Month', 'int64', { isHidden: true, formatString: '0' }), c('Month Year', 'string', { sortByColumn: q('Year Month') })], partition: { mode: 'import', m } };
  }
  // fact / dimension from the intake plan + queries.pq
  const pt = plan && (plan.tables || []).find((x) => x.name === t.name);
  let m = pqBlock(t.name);
  if (!pt || !m) { warnings.push(`${t.name}: not in intake/generated/model-plan.json + queries.pq and no tmdl block; run --import or add it`); return null; }
  const drop = new Set(t.dropColumns || []);
  const columns = pt.columns.filter((c) => !drop.has(c.name)).map((c) => ({ name: c.name, dataType: TYPE[c.type] || 'string', ...(c.hidden ? { isHidden: true } : {}), ...(c.type === 'datetime' || c.type === 'date' ? { formatString: 'Short Date' } : {}), summarizeBy: 'none', sourceColumn: c.name }));
  const lines = m.split('\n'); const last = lines[lines.length - 1].trim(); let prev = last; const steps = [];
  if (drop.size) { steps.push(`Dropped = Table.RemoveColumns(${prev}, {${[...drop].map((d) => `"${d}"`).join(', ')}})`); prev = 'Dropped'; }
  (t.derivedColumns || []).forEach((d, i) => {
    if (!d.m) { warnings.push(`${t.name}[${d.name}]: derived column without "m" (Power Query expression after "each"), skipped`); return; }
    const dt = TYPE[d.type] || 'string'; const step = `Derived${i + 1}`;
    steps.push(`${step} = Table.AddColumn(${prev}, "${d.name}", each ${d.m}, ${MTYPE[dt]})`); prev = step;
    columns.push({ name: d.name, doc: d.from || null, dataType: dt, summarizeBy: 'none', sourceColumn: d.name });
  });
  if (steps.length) {
    const inAt = lines.findIndex((l) => l.trim() === 'in');
    lines[inAt - 1] += ','; lines.splice(inAt, 0, ...steps.map((s, i) => '    ' + s + (i < steps.length - 1 ? ',' : '')));
    lines[lines.length - 1] = '    ' + prev; m = lines.join('\n');
  }
  return { doc: t.grain && !/^TBD/i.test(t.grain) ? t.grain : null, props: {}, columns, partition: { mode: 'import', m } };
}

function wanted(disk) {
  const tables = [];
  const names = model.tables.map((t) => t.name);
  for (const r of model.relationships) for (const n of [r.fromTable, r.toTable]) if (!names.includes(n) && n !== MT) { names.push(n); model.tables.push({ name: n }); }
  for (const t of model.tables) {
    if (t.name === MT) continue;
    let w = t.tmdl ? { doc: t.tmdl.doc || null, props: { ...(t.tmdl.props || {}) }, columns: t.tmdl.columns || [], partition: t.tmdl.partition, annotations: t.tmdl.annotations, other: t.tmdl.other } : null;
    if (!w) { w = generateTable(t); if (w) w.generated = true; }
    if (!w) continue;
    tables.push({ name: t.name, ...w });
  }
  const measures = model.measures.map((m) => {
    const fromCalc = daxFromCalc(m.calc);
    const dax = m.dax || fromCalc;
    // the HTML twin computes calc, Power BI computes dax: a simple calc must say the same thing
    const norm = (s) => String(s).replace(/\s+/g, '').replace(/'/g, '').toUpperCase();
    if (m.dax && fromCalc && norm(m.dax) !== norm(fromCalc)) warnings.push(`measure ${m.name}: dax and calc differ (dax: ${m.dax.trim()} | calc means: ${fromCalc}); align them so HTML and Power BI print the same number`);
    if (!dax) warnings.push(`measure ${m.name}: no "dax" in state.json (and calc is not a simple aggregation), skipped`);
    const p = { ...(m.tmdlProps || {}) };
    const f = m.formatString || fmtToTmdl(m.format); if (f) p.formatString = f;
    if (m.hidden) p.isHidden = true;
    if (m.folder) p.displayFolder = m.folder;
    return { name: m.name, doc: m.doc || null, dax, props: p };
  }).filter((m) => m.dax);
  // a measure that uses a skipped measure would break the model in Desktop: skip it too (cascades)
  const refs = (dax) => [...dax.replace(/"(?:[^"]|"")*"/g, '').matchAll(/(?<![\]\w'])\[([^\]]+)\]/g)].map((x) => x[1]);
  const known = new Set(model.measures.map((m) => m.name));
  let ok = measures; let changed = true;
  while (changed) {
    const have = new Set(ok.map((m) => m.name));
    const next = ok.filter((m) => { const miss = refs(m.dax).filter((r) => known.has(r) && !have.has(r)); if (miss.length) warnings.push(`measure ${m.name}: uses ${miss.join(', ')} (skipped), skipped too`); return !miss.length; });
    changed = next.length !== ok.length; ok = next;
  }
  return { tables, measures: ok, rels: model.relationships };
}

// ---------- canonical TMDL writer ----------
const ORDER = ['dataType', 'isHidden', 'isKey', 'formatString', 'displayFolder', 'lineageTag', 'summarizeBy', 'isNameInferred', 'sourceColumn', 'sortByColumn', 'dataCategory'];
const M_ORDER = ['formatString', 'isHidden', 'displayFolder', 'lineageTag']; // measures: Desktop's order
const ordered = (o, ord = ORDER) => Object.keys(o).sort((x, y) => (ord.indexOf(x) + 1 || 99) - (ord.indexOf(y) + 1 || 99));
const docLines = (doc, ind) => (doc ? doc.split('\n').map((d) => `${ind}/// ${d}`) : []);
const exprLines = (expr, ind) => expr.split('\n').map((l) => (l ? ind + l : ''));
const uuid = () => crypto.randomUUID();

function tableTmdl(t, old) {
  const L = [...docLines(t.doc, ''), `table ${q(t.name)}`, `\tlineageTag: ${(old && old.lineage) || uuid()}`];
  for (const k of ordered(t.props || {})) L.push(t.props[k] === true ? `\t${k}` : `\t${k}: ${t.props[k]}`);
  L.push('');
  for (const m of t.measures || []) {
    const om = old && old.measures.find((x) => x.name === m.name);
    L.push(...docLines(m.doc, '\t'));
    if (m.dax.includes('\n')) L.push(`\tmeasure ${q(m.name)} =`, ...exprLines(m.dax, '\t\t\t')); else L.push(`\tmeasure ${q(m.name)} = ${m.dax}`);
    const p = { ...m.props, lineageTag: (om && om.lineage) || uuid() };
    for (const k of ordered(p, M_ORDER)) L.push(p[k] === true ? `\t\t${k}` : `\t\t${k}: ${p[k]}`);
    L.push('');
  }
  for (const c of t.columns) {
    const oc = old && old.columns.find((x) => x.name === c.name);
    const { name, doc, dax, lineage, ...p } = c;
    L.push(...docLines(doc, '\t'));
    if (dax) { if (dax.includes('\n')) L.push(`\tcolumn ${q(name)} =`, ...exprLines(dax, '\t\t\t')); else L.push(`\tcolumn ${q(name)} = ${dax}`); } else L.push(`\tcolumn ${q(name)}`);
    p.lineageTag = (oc && oc.lineage) || uuid();
    for (const k of ordered(p)) L.push(p[k] === true ? `\t\t${k}` : `\t\t${k}: ${p[k]}`);
    L.push('');
  }
  for (const o of t.other || []) L.push(...o.split('\n').map((l) => '\t' + l), '');
  if (t.partition) {
    L.push(`\tpartition ${q(t.name)} = m`, `\t\tmode: ${t.partition.mode || 'import'}`);
    if (t.partition.m.includes('\n')) L.push('\t\tsource =', ...exprLines(t.partition.m, '\t\t\t\t')); else L.push(`\t\tsource = ${t.partition.m}`);
    L.push('');
  }
  for (const [k, v] of Object.entries(t.annotations || (t.generated ? { PBI_ResultType: 'Table' } : {}))) L.push(`\tannotation ${k} = ${v}`, '');
  return L.join('\n') + '\n';
}
function measureTable(ms, old) {
  return tableTmdl({ name: MT, props: {}, measures: ms, columns: [{ name: '_Key', dataType: 'string', isHidden: true, summarizeBy: 'none', sourceColumn: '_Key' }], partition: { mode: 'import', m: '#table(type table [_Key = text], {})' }, annotations: {} }, old);
}
function relTmdl(rels, oldRels) {
  const key = (r) => `${r.fromTable}|${r.fromColumn}|${r.toTable}|${r.toColumn}`;
  return rels.map((r) => {
    const o = oldRels.find((x) => key(x) === key(r));
    const L = [`relationship ${(o && o.id) || r.id || uuid()}`];
    if (r.direction === 'both') L.push('\tcrossFilteringBehavior: bothDirections');
    if (r.active === false) L.push('\tisActive: false');
    const [fc, tc] = (r.cardinality || 'many-to-one').split('-to-');
    if (fc !== 'many') L.push(`\tfromCardinality: ${fc}`);
    if (tc !== 'one') L.push(`\ttoCardinality: ${tc}`);
    for (const [k, v] of Object.entries(r.tmdlProps || {})) L.push(`\t${k}: ${v}`);
    L.push(`\tfromColumn: ${q(r.fromTable)}.${q(r.fromColumn)}`, `\ttoColumn: ${q(r.toTable)}.${q(r.toColumn)}`, '');
    return L.join('\n');
  }).join('\n') + '\n';
}
// keep the order already on disk (small diffs); new objects go last in state.json order
const byDisk = (list, diskNames) => [...list].sort((x, y) => { const i = diskNames.indexOf(x.name); const j = diskNames.indexOf(y.name); return (i < 0 ? 1e6 : i) - (j < 0 ? 1e6 : j); });

// ---------- compare ----------
const norm = (s) => (s == null ? '' : String(s).replace(/\r/g, '').split('\n').map((l) => l.replace(/\s+$/, '')).join('\n').trim());
function compare(w, disk) {
  const d = [];
  const dm = disk.tables[MT] || { measures: [] };
  for (const m of w.measures) {
    const o = dm.measures.find((x) => x.name === m.name);
    if (!o) { d.push(`measure missing in model: ${m.name}`); continue; }
    if (norm(o.dax) !== norm(m.dax)) d.push(`measure DAX differs: ${m.name}`);
    for (const k of ['formatString', 'isHidden', 'displayFolder']) if (String(o.props[k] || '') !== String(m.props[k] || '')) d.push(`measure ${k} differs: ${m.name} (model "${o.props[k] || ''}", state "${m.props[k] || ''}")`);
  }
  for (const o of dm.measures) if (!w.measures.find((m) => m.name === o.name)) d.push(`measure in model but not in state.json: ${o.name}`);
  for (const t of w.tables) {
    const o = disk.tables[t.name];
    if (!o) { d.push(`table missing in model: ${t.name}`); continue; }
    if (t.generated) continue; // generated tables are compared once imported
    const p = t.partition && o.partitions[0];
    if (t.partition && (!p || norm(p.m) !== norm(t.partition.m))) d.push(`partition M differs: ${t.name}`);
    for (const c of t.columns) {
      const oc = o.columns.find((x) => x.name === c.name);
      if (!oc) { d.push(`column missing in model: ${t.name}[${c.name}]`); continue; }
      for (const k of new Set([...Object.keys(c), ...Object.keys(oc)])) if (!['name', 'lineage', 'doc'].includes(k) && norm(c[k]) !== norm(oc[k])) d.push(`column ${k} differs: ${t.name}[${c.name}]`);
    }
    for (const oc of o.columns) if (!t.columns.find((c) => c.name === oc.name)) d.push(`column in model but not in state.json: ${t.name}[${oc.name}]`);
  }
  for (const n of Object.keys(disk.tables)) if (n !== MT && !w.tables.find((t) => t.name === n)) d.push(`table in model but not in state.json: ${n}`);
  const key = (r) => `${r.fromTable}[${r.fromColumn}] -> ${r.toTable}[${r.toColumn}]`;
  for (const r of w.rels) { const o = disk.rels.find((x) => key(x) === key(r)); if (!o) d.push(`relationship missing in model: ${key(r)}`); else if ((o.direction || 'single') !== (r.direction || 'single') || (o.active !== false) !== (r.active !== false)) d.push(`relationship differs: ${key(r)}`); }
  for (const o of disk.rels) if (!w.rels.find((r) => key(r) === key(o))) d.push(`relationship in model but not in state.json: ${key(o)}`);
  return d;
}

// ---------- modes ----------
const disk = readDisk();
const ascii = (s) => String(s).replace(/[^\x20-\x7E\n]/g, '?');

if (a.mode === 'import') {
  const added = []; const updated = [];
  const dm = disk.tables[MT];
  if (dm) for (const o of dm.measures) {
    let m = model.measures.find((x) => x.name === o.name);
    if (!m) { m = { name: o.name, definition: 'TBD - ask: imported from the model, confirm the business definition' }; model.measures.push(m); added.push(o.name); } else updated.push(o.name);
    m.dax = o.dax;
    if (o.doc) m.doc = o.doc;
    if (o.props.displayFolder) m.folder = o.props.displayFolder;
    if (o.props.formatString) m.formatString = o.props.formatString;
    if (o.props.isHidden) m.hidden = true;
    const extra = Object.fromEntries(Object.entries(o.props).filter(([k]) => !['displayFolder', 'formatString', 'isHidden'].includes(k)));
    if (Object.keys(extra).length) m.tmdlProps = extra; else delete m.tmdlProps;
  }
  for (const o of Object.values(disk.tables)) {
    if (o.name === MT) continue;
    let t = model.tables.find((x) => x.name === o.name);
    if (!t) { t = { name: o.name }; model.tables.push(t); added.push(`table ${o.name}`); }
    t.tmdl = { ...(o.doc ? { doc: o.doc } : {}), props: o.props, columns: o.columns.map(({ lineage, ...c }) => Object.fromEntries(Object.entries(c).filter(([, v]) => v != null))) };
    if (o.partitions[0]) t.tmdl.partition = { mode: o.partitions[0].mode, m: o.partitions[0].m };
    t.tmdl.annotations = o.annotations;
    if (o.other.length) t.tmdl.other = o.other;
  }
  for (const r of disk.rels) {
    const s = model.relationships.find((x) => x.fromTable === r.fromTable && x.fromColumn === r.fromColumn && x.toTable === r.toTable && x.toColumn === r.toColumn);
    if (!s) { const { id, ...rest } = r; model.relationships.push(rest); added.push(`relationship ${r.fromTable}[${r.fromColumn}]`); }
  }
  fs.writeFileSync(STATE, JSON.stringify(state, null, 2) + '\n');
  console.log(ascii(JSON.stringify({ ok: true, mode: 'import', measuresUpdated: updated.length, added, note: added.some((x) => !/^(table|relationship) /.test(x)) ? 'added measures have TBD definitions: confirm them with the user' : undefined }, null, 2)));
  process.exit(0);
}

const w = wanted(disk);

if (a.mode === 'check') {
  const diffs = compare(w, disk);
  console.log(ascii(JSON.stringify({ ok: diffs.length === 0, mode: 'check', model: path.relative(PROJ, SM), differences: diffs, warnings }, null, 2)));
  process.exit(diffs.length ? 1 : 0);
}

if (a.mode === 'write') {
  const lost = [];
  const dm = disk.tables[MT];
  if (dm) for (const o of dm.measures) if (!w.measures.find((m) => m.name === o.name)) lost.push(`measure ${o.name}`);
  for (const n of Object.keys(disk.tables)) if (n !== MT && !w.tables.find((t) => t.name === n) && !model.tables.find((t) => t.name === n)) lost.push(`table ${n}`);
  const key = (r) => `${r.fromTable}|${r.fromColumn}|${r.toTable}|${r.toColumn}`;
  for (const o of disk.rels) if (!w.rels.find((r) => key(r) === key(o))) lost.push(`relationship ${o.fromTable}[${o.fromColumn}] -> ${o.toTable}[${o.toColumn}]`);
  if (lost.length && !a.prune) { console.log(ascii(JSON.stringify({ ok: false, mode: 'write', error: 'these are in the model but not in state.json: run --import first, or pass --prune to delete them', lost }, null, 2))); process.exit(1); }

  fs.mkdirSync(TABLES, { recursive: true });
  const written = []; const removed = [];
  const fileOf = (n) => (disk.tables[n] && disk.tables[n].file) || `${n}.tmdl`;
  // line endings follow the file on disk (Desktop writes CRLF)
  const eol = (p, s) => { const cur = read(p); return cur == null || cur.includes('\r\n') ? s.replace(/\r?\n/g, '\r\n') : s; };
  const put = (f, s) => { const p = path.join(TABLES, f); s = eol(p, s); if (read(p) !== s) { fs.writeFileSync(p, s); written.push(f); } };
  for (const t of w.tables) put(fileOf(t.name), tableTmdl(t, disk.tables[t.name]));
  put(fileOf(MT), measureTable(byDisk(w.measures, dm ? dm.measures.map((m) => m.name) : []), dm));
  if (a.prune) for (const n of Object.keys(disk.tables)) if (n !== MT && !w.tables.find((t) => t.name === n) && !model.tables.find((t) => t.name === n)) { fs.unlinkSync(path.join(TABLES, disk.tables[n].file)); removed.push(disk.tables[n].file); }
  const rel = relTmdl(w.rels, disk.rels);
  const relPath = path.join(DEF, 'relationships.tmdl');
  const relOut = eol(relPath, rel);
  if (w.rels.length) { if (read(relPath) !== relOut) { fs.writeFileSync(relPath, relOut); written.push('relationships.tmdl'); } } else if (fs.existsSync(relPath) && a.prune) { fs.unlinkSync(relPath); removed.push('relationships.tmdl'); }

  // model.tmdl: only the `ref table` list and PBI_QueryOrder (culture and the rest stay as Desktop wrote them)
  const mp = path.join(DEF, 'model.tmdl'); let mt = read(mp);
  if (mt) {
    const diskRefs = [...mt.matchAll(/^ref table ('(?:[^']|'')*'|\S+)/gm)].map((x) => unq(x[1]));
    const names = byDisk([...w.tables, { name: MT }], diskRefs).map((t) => t.name);
    const refs = names.map((n) => `ref table ${q(n)}`).join('\n');
    const nl = mt.includes('\r\n') ? '\r\n' : '\n';
    mt = mt.replace(/\r/g, '');
    mt = /^ref table .*$/m.test(mt) ? mt.replace(/(^ref table .*\n?)+/m, refs + '\n') : mt.replace(/\n*$/, '\n\n' + refs + '\n');
    const params = ((read(path.join(DEF, 'expressions.tmdl')) || '').match(/^expression\s+('(?:[^']|'')*'|\S+)/gm) || []).map((x) => unq(x.replace(/^expression\s+/, '')));
    mt = mt.replace(/^annotation PBI_QueryOrder = .*$/m, `annotation PBI_QueryOrder = ${JSON.stringify([...names, ...params])}`);
    mt = mt.replace(/\n/g, nl);
    if (read(mp) !== mt) { fs.writeFileSync(mp, mt); written.push('model.tmdl'); }
  }
  // parameters: create SourcePath only when the model has none (values are per machine, never overwritten)
  const ep = path.join(DEF, 'expressions.tmdl');
  const needs = (plan && plan.parameters) || [];
  const have = read(ep) || '';
  const add = needs.filter((p) => !new RegExp(`^expression\\s+${q(p).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=`, 'm').test(have));
  if (add.length) {
    const val = (p) => (p === 'SourcePath' ? path.join(PROJ, 'data') : 'TBD');
    const blk = add.map((p) => `expression ${q(p)} = "${val(p).replace(/"/g, '""')}" meta [IsParameterQuery = true, Type = "Text", IsParameterQueryRequired = true]\n\tlineageTag: ${uuid()}\n\n\tannotation PBI_ResultType = Text\n`).join('\n');
    fs.writeFileSync(ep, (have ? have.replace(/\n*$/, '\n\n') : '') + blk); written.push('expressions.tmdl');
    for (const p of add) if (p !== 'SourcePath') warnings.push(`parameter ${p} created with value TBD: set it in Desktop (Transform data > Manage parameters)`);
  }
  const after = compare(w, readDisk()).filter((x) => !/^table missing/.test(x));
  console.log(ascii(JSON.stringify({ ok: after.length === 0, mode: 'write', model: path.relative(PROJ, SM), written, removed, check: after, warnings, next: written.length ? 'node pbi-desktop.js --project <folder> --fresh  (reopen Desktop without saving, then refresh)' : 'nothing changed' }, null, 2)));
  process.exit(after.length ? 1 : 0);
}
console.error(`Unknown mode ${a.mode}`); process.exit(2);
