#!/usr/bin/env node
// pbi-delivery · intake.js — ONE command for the whole intake.
// Looks at what the user shared and runs every applicable step:
//   <project>/intake/  : images (.png), HTML/artifact mockups, CSS tokens, design-system folders, palette/theme JSON
//   <project>/data/    : .xlsx .csv .tsv .txt .json   (or --schema for a database)
// → <project>/intake/generated/: image tokens, design-tokens.json, theme.json, model-plan.json, queries.pq,
//   data-contract.draft.md, profile.json, state.draft.json (or <project>/state.json if none exists), INTAKE.md
//
// Usage: node intake.js --project <project folder> [--brand "<Brand>"]
//        [--schema <columns.csv> --source sqlserver|postgresql|mysql|snowflake|oracle --server <host> --database <db>]
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const A = {};
for (let i = 2; i < process.argv.length; i += 2) A[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
if (!A.project) { console.error('Usage: node intake.js --project <project folder> [--brand "<Brand>"] [--schema <columns.csv> --source <engine> --server <host> --database <db>]'); process.exit(2); }
const P = path.resolve(A.project);
const name = path.basename(P);
const brand = A.brand || name.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const IN = path.join(P, 'intake'); const DATA = path.join(P, 'data'); const GEN = path.join(IN, 'generated');
fs.mkdirSync(GEN, { recursive: true });
const S = (f) => path.join(__dirname, f);
const run = (script, args) => JSON.parse(execFileSync(process.execPath, [S(script), ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
const report = { project: P, steps: [], toConfirm: [], claudeTodo: [] };

// ---------- 1. classify shared design material ----------
const list = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => !f.startsWith('.') && f !== 'generated').map((f) => path.join(dir, f)) : []);
const shared = list(IN);
const images = shared.filter((f) => /\.png$/i.test(f));
const otherImages = shared.filter((f) => /\.(jpe?g|webp|gif|bmp|heic)$/i.test(f));
const designText = shared.filter((f) => fs.statSync(f).isDirectory() || /\.(html?|css|json|jsx?|tsx?)$/i.test(f));
const zips = shared.filter((f) => /\.zip$/i.test(f));
for (const z of zips) report.claudeTodo.push(`Unzip ${path.basename(z)} into intake/${path.basename(z, '.zip')}/ and re-run intake (design exports from Claude Design come as zip).`);
for (const f of otherImages) report.toConfirm.push(`${path.basename(f)} is not PNG — save it as PNG (Paint → Save as → PNG) for exact colors; Claude can still read its layout visually.`);

// ---------- 2. images → exact colors + sidebar/header ----------
const imageCss = [];
for (const img of images) {
  const base = path.basename(img, path.extname(img));
  const css = path.join(GEN, `image-${base}.css`);
  try {
    const r = run('read-image.js', ['--in', img, '--out-css', css, '--out-json', path.join(GEN, `image-${base}.json`)]);
    imageCss.push(css);
    report.steps.push({ step: 'read-image', file: path.basename(img), canvas: r.canvas, sidebar: r.sidebar && r.sidebar.widthCanvas, header: r.header && r.header.heightCanvas, roles: r.roles });
    report.toConfirm.push(...r.toConfirm.map((t) => `[${path.basename(img)}] ${t}`));
    report.claudeTodo.push(`Look at ${path.basename(img)} and reshape state pages to match it exactly (intake.md §4): header title + headline, every KPI card, every chart (type, axis, series), tables, slicers; identify the font.`);
  } catch (e) { report.toConfirm.push(`[${path.basename(img)}] ${String(e.message).split('\n').find((l) => /Error|not PNG|supported/.test(l)) || e.message}`); }
}

// ---------- 3. design tokens + theme ----------
let tokensPath = null; let themePath = null;
const designInputs = [...designText, ...imageCss]; // code-defined tokens first; image fills the gaps
if (designInputs.length) {
  tokensPath = path.join(GEN, 'design-tokens.json');
  const r = run('extract-design.js', [...designInputs.flatMap((f) => ['--in', f]), '--out', tokensPath]);
  report.steps.push({ step: 'extract-design', inputs: designInputs.map((f) => path.relative(P, f)), colors: r.colors, font: r.font, layout: r.layout });
  report.toConfirm.push(...r.toConfirm);
  themePath = path.join(GEN, 'theme.json');
  run('make-theme.js', ['--tokens', tokensPath, '--name', brand, '--out', themePath]);
  report.steps.push({ step: 'make-theme', out: path.relative(P, themePath) });
  for (const f of designText.filter((x) => /\.html?$/i.test(x))) report.claudeTodo.push(`Read ${path.basename(f)} and reshape state pages to match its blocks (intake.md §4).`);
} else {
  report.toConfirm.push('No design material shared (image, HTML, CSS, palette): the theme will use neutral defaults — share a design or confirm defaults.');
}

// ---------- 4. data ----------
let planPath = null;
const dataFiles = list(DATA).filter((f) => /\.(xlsx|csv|tsv|txt|json)$/i.test(f));
if (A.schema || dataFiles.length) {
  const args = A.schema
    ? ['--schema', A.schema, '--source', A.source || 'sqlserver', '--server', A.server || 'TBD-server', '--database', A.database || 'TBD-database', '--out', GEN]
    : ['--in', DATA, '--out', GEN];
  const r = run('profile-data.js', args);
  planPath = path.join(GEN, 'model-plan.json');
  report.steps.push({ step: 'profile-data', tables: r.tables.map((t) => `${t.name} (${t.role})`), relationships: r.relationships });
  report.toConfirm.push(...r.toConfirm);
  if (list(DATA).some((f) => /\.xls$/i.test(f))) report.toConfirm.push('Old .xls files found — save them as .xlsx to be profiled.');
} else {
  report.toConfirm.push('No data shared (data/ is empty and no --schema): the spec will start on sample data — share files or a DB schema export, or confirm sample data.');
}

// ---------- 5. spec ----------
const statePath = fs.existsSync(path.join(P, 'state.json')) ? path.join(GEN, 'state.draft.json') : path.join(P, 'state.json');
const dsArgs = ['--name', name, '--brand', brand, '--out', statePath, '--base', P];
if (tokensPath) dsArgs.push('--tokens', tokensPath);
if (planPath) dsArgs.push('--plan', planPath);
// theme path relative to the project folder (build-pbir resolves it next to state.json)
if (themePath) dsArgs.push('--theme', path.relative(P, themePath).replace(/\\/g, '/'));
if (tokensPath || planPath) {
  const r = run('draft-state.js', dsArgs);
  report.steps.push({ step: 'draft-state', out: path.relative(P, statePath), kpis: r.kpis, measures: r.measures });
  if (statePath.endsWith('state.draft.json')) report.claudeTodo.push('state.json already existed: merge intake/generated/state.draft.json into it deliberately (never overwrite confirmed content).');
}
report.claudeTodo.push('Send the user ONE message with every item under "To confirm" plus metric definitions, exclusions, polarity and grain; record answers; then mockup (phase 4) and Power BI (phases 5–7).');

// ---------- 6. INTAKE.md ----------
const md = [
  `# Intake — ${name}`, '',
  `Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} by \`pbi-delivery/scripts/intake.js\`. Outputs are in \`intake/generated/\`.`, '',
  '## What was derived', '',
  ...report.steps.map((s) => `- **${s.step}** — ${JSON.stringify(Object.fromEntries(Object.entries(s).filter(([k]) => k !== 'step'))).slice(0, 400)}`), '',
  '## To confirm with the user (one message)', '',
  ...[...new Set(report.toConfirm)].map((t) => `- [ ] ${t}`), '',
  '## Claude must still do', '',
  ...report.claudeTodo.map((t) => `- [ ] ${t}`), '',
];
fs.writeFileSync(path.join(GEN, 'INTAKE.md'), md.join('\n'));
console.log(JSON.stringify({ ok: true, intake: path.join(GEN, 'INTAKE.md'), state: statePath, steps: report.steps.map((s) => s.step), toConfirm: [...new Set(report.toConfirm)].length, claudeTodo: report.claudeTodo.length }, null, 2));
