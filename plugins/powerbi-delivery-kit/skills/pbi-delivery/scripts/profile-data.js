#!/usr/bin/env node
// pbi-delivery · profile-data.js
// Profiles whatever data is shared and drafts the model: types, keys, dates, fact/dimension roles,
// relationships, Power BI names, a data contract and Power Query (M) with parameters. No dependencies.
//
// Usage:
//   Files : node profile-data.js --in <file|dir> [--in ...] --out <dir>            (.xlsx .csv .tsv .txt .json)
//   DB    : node profile-data.js --schema <columns.csv> --source sqlserver|postgresql|mysql|snowflake|oracle \
//                                --server <host> --database <db> --out <dir>
//           (columns.csv = export of INFORMATION_SCHEMA.COLUMNS: table_schema,table_name,column_name,data_type)
// Outputs in <dir>: profile.json · model-plan.json · data-contract.draft.md · queries.pq
'use strict';
const fs = require('fs');
const path = require('path');
const { parseDelimited, readAny } = require('./lib/read-data');

const A = { in: [] };
for (let i = 2; i < process.argv.length; i += 2) {
  const k = process.argv[i].replace(/^--/, ''); const v = process.argv[i + 1];
  if (k === 'in') A.in.push(v); else A[k] = v;
}
if ((!A.in.length && !A.schema) || !A.out) {
  console.error('Usage: node profile-data.js --in <file|dir> ... --out <dir>   |   --schema <columns.csv> --source <engine> --server <s> --database <d> --out <dir>');
  process.exit(2);
}
const MAX_ROWS = +(A.maxRows || 20000);

// ======================= collect tables (readers in lib/read-data.js) =======================
let tables = [];
A.in.forEach((p) => tables.push(...readAny(p, MAX_ROWS)));

if (A.schema) {
  const s = parseDelimited(fs.readFileSync(A.schema, 'utf8'), A.schema);
  const ix = (n) => s.header.findIndex((h) => h.toLowerCase() === n);
  const [iS, iT, iC, iD] = ['table_schema', 'table_name', 'column_name', 'data_type'].map(ix);
  const by = {};
  for (const r of s.rows) { const key = `${r[iS] || 'dbo'}.${r[iT]}`; (by[key] = by[key] || { schema: r[iS] || 'dbo', name: r[iT], cols: [] }).cols.push({ name: r[iC], dbType: (r[iD] || '').toLowerCase() }); }
  for (const t of Object.values(by)) tables.push({ name: t.name, kind: 'db', schema: t.schema, header: t.cols.map((c) => c.name), dbTypes: t.cols.map((c) => c.dbType), rows: [], rowCount: null });
}
if (!tables.length) { console.error('No readable tables found.'); process.exit(1); }

// ======================= profiling =======================
const RE = {
  int: /^-?\d{1,18}$/,
  dec: /^-?\d+(\.\d+)?$/,
  decComma: /^-?\d{1,3}(\.\d{3})*,\d+$|^-?\d+,\d+$/,
  money: /^-?[$€£]\s?-?[\d.,]+$|^-?[\d.,]+\s?[$€£]$/,
  iso: /^\d{4}-\d{2}-\d{2}$/,
  isoT: /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z?$/,
  slash: /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/,
  bool: /^(true|false|yes|no|si|sí|y|n)$/i,
};
const dbTypeMap = (t) => (/int|serial/.test(t) ? 'int' : /dec|numeric|money|float|double|real|number/.test(t) ? 'decimal' : /timestamp|datetime/.test(t) ? 'datetime' : /date/.test(t) ? 'date' : /bit|bool/.test(t) ? 'bool' : 'text');

function profileColumn(values, dbType) {
  const nonEmpty = values.filter((v) => v !== '' && v != null);
  const n = values.length; const nn = nonEmpty.length;
  const sample = nonEmpty.slice(0, 2000);
  const share = (re) => (sample.length ? sample.filter((v) => re.test(String(v).trim())).length / sample.length : 0);
  let type = 'text'; let culture = null; let dateOrder = null;
  if (dbType) type = dbTypeMap(dbType);
  else if (!sample.length) type = 'text';
  else if (share(RE.bool) > 0.98) type = 'bool';
  else if (share(RE.int) > 0.98) type = 'int';
  else if (share(RE.dec) > 0.98) type = 'decimal';
  else if (share(RE.decComma) > 0.98) { type = 'decimal'; culture = 'comma-decimal'; }
  else if (share(RE.money) > 0.95) type = 'decimal';
  else if (share(RE.isoT) > 0.98) type = 'datetime';
  else if (share(RE.iso) > 0.98 || share(RE.isoT) + share(RE.iso) > 0.98) type = 'date';
  else if (share(RE.slash) > 0.98) {
    type = 'date';
    const firstBig = sample.some((v) => +String(v).match(RE.slash)?.[1] > 12);
    const secondBig = sample.some((v) => +String(v).match(RE.slash)?.[2] > 12);
    dateOrder = firstBig ? 'DMY' : secondBig ? 'MDY' : 'ambiguous';
  }
  const distinct = new Set(nonEmpty.slice(0, 100000)).size;
  let min = null, max = null;
  if (type === 'int' || type === 'decimal') {
    const nums = sample.map((v) => +String(v).replace(/[$€£\s]/g, '').replace(culture ? /\./g : /,/g, '').replace(',', '.')).filter((x) => !isNaN(x));
    if (nums.length) { min = Math.min(...nums); max = Math.max(...nums); }
  } else if (type === 'date' || type === 'datetime') {
    const toIso = (v) => {
      v = String(v).trim();
      const m = v.match(RE.slash);
      if (!m) return v.slice(0, 10);
      const y = m[3].length === 2 ? '20' + m[3] : m[3];
      const [d, mo] = dateOrder === 'MDY' ? [m[2], m[1]] : [m[1], m[2]];
      return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
    };
    const s = sample.map(toIso).filter((x) => /^\d{4}-\d{2}-\d{2}/.test(x)).sort();
    min = s[0] || null; max = s[s.length - 1] || null;
  }
  return { type, culture, dateOrder, nulls: n ? Math.round(((n - nn) / n) * 1000) / 10 : null, distinct: n ? distinct : null, unique: n > 0 && distinct === nn && nn === n, min, max, sample: [...new Set(nonEmpty)].slice(0, 3) };
}

// ======================= naming =======================
const words = (s) => s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_\-.]+/g, ' ').trim().split(/\s+/);
const title = (s) => words(s).map((w) => (w.length <= 3 && w === w.toUpperCase() ? w : w[0].toUpperCase() + w.slice(1).toLowerCase())).join(' ');
const singular = (s) => s.replace(/ies$/i, 'y').replace(/(ss)$/i, '$1').replace(/([^s])s$/i, '$1');
const stem = (s) => singular(words(s).filter((w) => !/^(tbl|dim|fact|fct|vw|v|stg)$/i.test(w)).join(' ')).toLowerCase();
const isKeyName = (c) => /(^|[_\s-])(id|key|code|cod|codigo|sku|nit)$/i.test(c) || /Id$|Key$|ID$/.test(c);
const isNonMeasure = (c) => /(year|month|day|week|quarter|period|phone|zip|postal|age|number|nro|no\.?)$/i.test(c) || isKeyName(c);

// ======================= build profile =======================
for (const t of tables) {
  t.columns = t.header.map((h, i) => ({ source: h, ...profileColumn(t.rows.map((r) => r[i] ?? ''), t.dbTypes && t.dbTypes[i]) }));
  t.dateCols = t.columns.filter((c) => c.type === 'date' || c.type === 'datetime').map((c) => c.source);
  t.keyCols = t.columns.filter((c) => isKeyName(c.source)).map((c) => c.source);
  t.measureCols = t.columns.filter((c) => (c.type === 'decimal' || c.type === 'int') && !isNonMeasure(c.source) && !(c.unique && c.type === 'int')).map((c) => c.source);
  t.textCols = t.columns.filter((c) => c.type === 'text' && !isKeyName(c.source)).map((c) => c.source);
  t.stem = stem(t.name);
  // With rows: a unique key-named column. Schema only (no rows): the key column named after the table
  // (employee_id in employees, id), else the first key-named column.
  const keyStem = (c) => stem(c.replace(/[_\s-]?(id|key|code|cod|codigo)$/i, '').replace(/(Id|Key|ID)$/, '')).replace(/[^a-z0-9]/g, '');
  const tstem = t.stem.replace(/[^a-z0-9]/g, '');
  let pk = null;
  if (t.rows.length) pk = t.columns.find((c) => c.unique && isKeyName(c.source) && (keyStem(c.source) === tstem || keyStem(c.source) === '')) || t.columns.find((c) => c.unique && isKeyName(c.source));
  else pk = t.columns.find((c) => isKeyName(c.source) && (keyStem(c.source) === tstem || keyStem(c.source) === '')) || null;
  t.primaryKey = pk ? pk.source : null;
}
// role: fact = has a date + numeric measures (or many FK-like keys); dim = has a unique key / mostly text
const maxRows = Math.max(...tables.map((t) => t.rowCount || 0));
for (const t of tables) {
  const fk = t.keyCols.filter((k) => k !== t.primaryKey).length;
  const factScore = (t.dateCols.length ? 2 : 0) + Math.min(t.measureCols.length, 3) + Math.min(fk, 3) + ((t.rowCount || 0) === maxRows && maxRows > 0 ? 1 : 0) - (t.primaryKey && !t.dateCols.length ? 2 : 0);
  t.role = factScore >= 4 ? 'fact' : t.primaryKey || t.textCols.length >= t.measureCols.length ? 'dimension' : 'fact';
  t.pbiName = (t.role === 'fact' ? 'Fact ' : 'Dim ') + title(t.role === 'fact' ? words(t.name).filter((w) => !/^(tbl|fact|fct|vw|v|stg)$/i.test(w)).join(' ') : singular(words(t.name).filter((w) => !/^(tbl|dim|vw|v|stg)$/i.test(w)).join(' ')));
}
// relationships: fact.fk ↔ dim.pk by same name, or <dimstem>_id ↔ dim.id.
// Dimension → dimension links are kept but flagged as snowflake (star schema prefers flattening).
const rels = [];
const snowflakes = [];
for (const f of tables) {
  for (const col of f.keyCols.filter((k) => k !== f.primaryKey)) {
    const norm = col.toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const d of tables.filter((t) => t.role === 'dimension' && t.primaryKey)) {
      const pk = d.primaryKey.toLowerCase().replace(/[^a-z0-9]/g, '');
      const dstem = d.stem.replace(/[^a-z0-9]/g, '');
      if (d === f) continue;
      if (norm === pk || (pk.replace(/(id|key|code)$/, '') === '' && norm.replace(/(id|key|code)$/, '') === dstem) || norm === dstem + pk || norm === dstem + 'id') {
        rels.push({ fromTable: f.pbiName, fromColumn: col, toTable: d.pbiName, toColumn: d.primaryKey, cardinality: 'many-to-one', direction: 'single' });
        if (f.role === 'dimension') snowflakes.push(`${f.pbiName} → ${d.pbiName}`);
      }
    }
  }
}
// column Power BI names: keys → "<Entity> Key", others Title Case
const pbiCol = (t, c) => {
  if (isKeyName(c)) {
    const base = title(c.replace(/[_\s-]?(id|key|code|cod|codigo)$/i, '').replace(/(Id|Key|ID)$/, '')) || title(t.stem);
    return `${base} Key`;
  }
  return title(c);
};
for (const t of tables) for (const c of t.columns) c.pbi = pbiCol(t, c.source);
for (const r of rels) {
  const ft = tables.find((t) => t.pbiName === r.fromTable); const dt = tables.find((t) => t.pbiName === r.toTable);
  r.fromColumn = ft.columns.find((c) => c.source === r.fromColumn).pbi; r.toColumn = dt.columns.find((c) => c.source === r.toColumn).pbi;
}

// ======================= M generation =======================
const mType = (c) => ({ int: 'Int64.Type', decimal: 'type number', date: 'type date', datetime: 'type datetime', bool: 'type logical', text: 'type text' })[c.type];
// Culture is decided per column from what was detected (override all with --culture).
const colCulture = (c) => A.culture || (c.culture === 'comma-decimal' ? 'es-CO' : c.dateOrder === 'DMY' ? 'en-GB' : 'en-US');
const culture = A.culture || 'per column (en-US default; en-GB for DMY dates; es-CO for comma decimals)';
const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
const mId = (s) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(s) ? s : `#${q(s)}`);
const engines = {
  sqlserver: (t) => `Sql.Database(Server, Database){[Schema = ${q(t.schema)}, Item = ${q(t.name)}]}[Data]`,
  postgresql: (t) => `PostgreSQL.Database(Server, Database){[Schema = ${q(t.schema)}, Item = ${q(t.name)}]}[Data]`,
  mysql: (t) => `MySQL.Database(Server, Database){[Schema = ${q(t.schema)}, Item = ${q(t.name)}]}[Data]`,
  snowflake: (t) => `Snowflake.Databases(Server, Warehouse){[Name = Database]}[Data]{[Name = ${q(t.schema)}]}[Data]{[Name = ${q(t.name)}]}[Data]`,
  oracle: (t) => `Oracle.Database(Server){[Schema = ${q(t.schema)}, Name = ${q(t.name)}]}[Data]`,
};
// SourcePath = --dataRoot, else the shared folder itself, else the folder of the first shared file.
const firstIn = A.in[0] ? path.resolve(A.in[0]) : process.cwd();
const dataRoot = A.dataRoot ? path.resolve(A.dataRoot) : fs.existsSync(firstIn) && fs.statSync(firstIn).isDirectory() ? firstIn : path.dirname(firstIn);
const relPath = (f) => path.relative(dataRoot, f).replace(/\//g, '\\');
function mFor(t) {
  let src;
  if (t.kind === 'xlsx') src = `Excel.Workbook(File.Contents(SourcePath & ${q('\\' + relPath(t.file))}), null, true){[Item = ${q(t.sheet)}, Kind = "Sheet"]}[Data],\n    Promoted = Table.PromoteHeaders(Source, [PromoteAllScalars = true])`;
  else if (t.kind === 'csv') src = `Csv.Document(File.Contents(SourcePath & ${q('\\' + relPath(t.file))}), [Delimiter = ${q(t.delimiter)}, Encoding = 65001, QuoteStyle = QuoteStyle.Csv]),\n    Promoted = Table.PromoteHeaders(Source, [PromoteAllScalars = true])`;
  else if (t.kind === 'json') src = `Table.FromRecords(Json.Document(File.Contents(SourcePath & ${q('\\' + relPath(t.file))}))),\n    Promoted = Source`;
  else src = `${(engines[A.source] || engines.sqlserver)(t)},\n    Promoted = Source`;
  // One type-conversion step per culture actually needed (a CSV can mix DMY dates with dot decimals).
  const groups = {};
  for (const c of t.columns) {
    const cul = t.kind === 'db' || t.kind === 'xlsx' ? 'en-US' : colCulture(c);
    (groups[cul] = groups[cul] || []).push(`{${q(c.source)}, ${mType(c)}}`);
  }
  const steps = []; let prev = 'Promoted';
  Object.entries(groups).forEach(([cul, list], i) => {
    const name = `Typed${i + 1}`;
    steps.push(`    ${name} = Table.TransformColumnTypes(${prev}, {${list.join(', ')}}, ${q(cul)})`);
    prev = name;
  });
  const renames = t.columns.filter((c) => c.pbi !== c.source).map((c) => `{${q(c.source)}, ${q(c.pbi)}}`).join(', ');
  return `// ${t.pbiName} — ${t.role}; ${t.rowCount == null ? 'rows: n/a' : t.rowCount + ' rows'}\nlet\n    Source = ${src},\n${steps.join(',\n')},\n    Renamed = ${renames ? `Table.RenameColumns(${prev}, {${renames}})` : prev}\nin\n    Renamed`;
}
const isDb = tables.some((t) => t.kind === 'db');
const params = [
  isDb ? `Server = ${q(A.server || 'TBD-server')} meta [IsParameterQuery = true, Type = "Text", IsParameterQueryRequired = true]` : null,
  isDb ? `Database = ${q(A.database || 'TBD-database')} meta [IsParameterQuery = true, Type = "Text", IsParameterQueryRequired = true]` : null,
  isDb && A.source === 'snowflake' ? `Warehouse = ${q(A.warehouse || 'TBD-warehouse')} meta [IsParameterQuery = true, Type = "Text", IsParameterQueryRequired = true]` : null,
  !isDb || tables.some((t) => t.kind !== 'db') ? `SourcePath = ${q(dataRoot)} meta [IsParameterQuery = true, Type = "Text", IsParameterQueryRequired = true]` : null,
].filter(Boolean);
const allDates = tables.filter((t) => t.role === 'fact').flatMap((t) => t.columns.filter((c) => c.type === 'date' || c.type === 'datetime').map((c) => [c.min, c.max])).flat().filter(Boolean).map((d) => String(d).slice(0, 10)).sort();
const yr0 = allDates.length ? +allDates[0].slice(0, 4) : new Date().getFullYear() - 1;
const yr1 = allDates.length ? +allDates[allDates.length - 1].slice(0, 4) : new Date().getFullYear();
const dimDateM = `// Dim Date — generated calendar covering the fact dates (${yr0}–${yr1}); mark as date table\nlet\n    Start = #date(${yr0}, 1, 1), End = #date(${yr1}, 12, 31),\n    Dates = List.Dates(Start, Duration.Days(End - Start) + 1, #duration(1, 0, 0, 0)),\n    T = Table.FromList(Dates, Splitter.SplitByNothing(), {"Date"}),\n    Typed = Table.TransformColumnTypes(T, {{"Date", type date}}),\n    Y = Table.AddColumn(Typed, "Year", each Date.Year([Date]), Int64.Type),\n    Q = Table.AddColumn(Y, "Quarter", each "Q" & Text.From(Date.QuarterOfYear([Date])), type text),\n    MN = Table.AddColumn(Q, "Month Number", each Date.Month([Date]), Int64.Type),\n    M = Table.AddColumn(MN, "Month", each Date.ToText([Date], [Format = "MMM", Culture = "en-US"]), type text),\n    YM = Table.AddColumn(M, "Year Month", each Date.Year([Date]) * 100 + Date.Month([Date]), Int64.Type)\nin\n    YM`;

// ======================= outputs =======================
fs.mkdirSync(A.out, { recursive: true });
const plan = {
  $schema: 'pbi-delivery/model-plan/1',
  sourceType: isDb ? (A.source || 'sqlserver') : [...new Set(tables.map((t) => t.kind))].join('+'),
  parameters: params.map((p) => p.split(' = ')[0]),
  culture,
  tables: tables.map((t) => ({
    name: t.pbiName, source: t.kind === 'xlsx' ? `${path.basename(t.file)} › ${t.sheet}` : t.kind === 'db' ? `${t.schema}.${t.name}` : path.basename(t.file),
    role: t.role, rows: t.rowCount, primaryKey: t.primaryKey ? t.columns.find((c) => c.source === t.primaryKey).pbi : null,
    grain: t.role === 'fact' ? `TBD — confirm: one row = one ${singular(t.stem)}${t.dateCols.length ? ' (dated)' : ''}` : `one row = one ${singular(t.stem)}`,
    columns: t.columns.map((c) => ({ name: c.pbi, source: c.source, type: c.type, hidden: isKeyName(c.source) || (t.role === 'fact' && t.measureCols.includes(c.source)), nulls: c.nulls, distinct: c.distinct,
      // numeric range only (no text values): lets build-html --sample generate realistic sample numbers
      ...((c.type === 'int' || c.type === 'decimal') && typeof c.min === 'number' ? { min: c.min, max: c.max } : {}) })),
    dateColumns: t.dateCols.map((s) => t.columns.find((c) => c.source === s).pbi),
    measureCandidates: t.measureCols.map((s) => t.columns.find((c) => c.source === s).pbi),
    // decimals that live in [0,1] (or named rate/pct/%) are ratios: average them, never sum
    ratioColumns: t.measureCols.filter((s) => { const c = t.columns.find((x) => x.source === s); return /(rate|ratio|pct|percent|porcentaje|%|discount|descuento|margin)$/i.test(s) || (c.type === 'decimal' && c.min != null && c.min >= 0 && c.max <= 1); }).map((s) => t.columns.find((c) => c.source === s).pbi),
    attributes: t.textCols.map((s) => t.columns.find((c) => c.source === s).pbi),
  })),
  relationships: [
    ...rels,
    ...tables.filter((t) => t.role === 'fact' && t.dateCols.length).map((t) => ({ fromTable: t.pbiName, fromColumn: t.columns.find((c) => c.source === t.dateCols[0]).pbi, toTable: 'Dim Date', toColumn: 'Date', cardinality: 'many-to-one', direction: 'single' })),
  ],
  dateTable: { name: 'Dim Date', from: yr0, to: yr1 },
  toConfirm: [
    ...tables.filter((t) => t.role === 'fact').map((t) => `Grain of ${t.pbiName}: what does one row represent?`),
    ...tables.flatMap((t) => t.columns.filter((c) => c.dateOrder === 'ambiguous').map((c) => `${t.pbiName}[${c.pbi}]: date order DMY or MDY?`)),
    ...tables.filter((t) => t.role === 'fact' && t.dateCols.length > 1).map((t) => `${t.pbiName}: which date drives analysis? (${t.dateCols.join(', ')}) — others become inactive relationships`),
    ...(isDb ? ['Row counts unknown (schema only) — confirm volumes to choose Import vs DirectQuery'] : []),
    ...snowflakes.map((s) => `Snowflake ${s}: merge the outer dimension's attributes into the inner one (star schema) or keep the chain?`),
    ...tables.filter((t) => t.role === 'dimension' && !t.primaryKey).map((t) => `${t.pbiName}: no primary key detected — which column identifies a row?`),
    'Exclusions and business definitions for every measure candidate',
  ],
};
fs.writeFileSync(path.join(A.out, 'model-plan.json'), JSON.stringify(plan, null, 2));
fs.writeFileSync(path.join(A.out, 'profile.json'), JSON.stringify(tables.map(({ rows, ...t }) => t), null, 2));
fs.writeFileSync(path.join(A.out, 'queries.pq'),
  `// Power Query (M) generated by pbi-delivery/profile-data.js — paste each block as a table partition.\n// Parameters (Model → Manage parameters):\n${params.map((p) => '// ' + p).join('\n')}\n\n` +
  tables.map(mFor).join('\n\n') + '\n\n' + dimDateM + '\n');

const md = [];
md.push(`# Data contract — DRAFT (generated)\n\n> Generated by \`pbi-delivery/scripts/profile-data.js\`. Confirm every \`TBD\`, then move into \`data-contract.md\`.\n`);
md.push(`## Sources\n\n| Source | Type | Parameters | Culture |\n|---|---|---|---|\n| ${isDb ? `${A.server || 'TBD'} / ${A.database || 'TBD'}` : 'files under SourcePath'} | ${plan.sourceType} | ${plan.parameters.join(', ')} | ${culture} |\n`);
md.push('## Logical tables\n');
for (const t of plan.tables) {
  md.push(`### ${t.name}  _(${t.role}${t.rows != null ? `, ${t.rows} rows` : ''})_\n- **Source:** ${t.source}\n- **Grain:** ${t.grain}${t.primaryKey ? `\n- **Key:** ${t.primaryKey}` : ''}${t.measureCandidates.length ? `\n- **Measure candidates:** ${t.measureCandidates.join(', ')}` : ''}\n\n| Column | Source column | Type | Nulls % | Distinct | Hidden |\n|---|---|---|---|---|---|\n` +
    t.columns.map((c) => `| ${c.name} | ${c.source} | ${c.type} | ${c.nulls ?? '—'} | ${c.distinct ?? '—'} | ${c.hidden ? 'yes' : ''} |`).join('\n') + '\n');
}
md.push(`### Dim Date\nGenerated in M, ${yr0}-01-01 to ${yr1}-12-31; mark as date table; Month sorted by Month Number.\n`);
md.push('## Relationships\n\n| From (many) | To (one) | Direction |\n|---|---|---|\n' + plan.relationships.map((r) => `| ${r.fromTable}[${r.fromColumn}] | ${r.toTable}[${r.toColumn}] | ${r.direction} |`).join('\n') + '\n');
md.push('## To confirm\n\n' + plan.toConfirm.map((x) => `- TBD — ask: ${x}`).join('\n') + '\n');
fs.writeFileSync(path.join(A.out, 'data-contract.draft.md'), md.join('\n'));

console.log(JSON.stringify({ ok: true, out: A.out, culture, tables: plan.tables.map((t) => ({ name: t.name, role: t.role, rows: t.rows, key: t.primaryKey, dates: t.dateColumns, measures: t.measureCandidates })), relationships: plan.relationships.map((r) => `${r.fromTable}[${r.fromColumn}] → ${r.toTable}[${r.toColumn}]`), toConfirm: plan.toConfirm }, null, 2));
