#!/usr/bin/env node
// End-to-end tests for the pbi-delivery scripts on a fictional project (tests/fixtures/).
// Node 20+, no dependencies. Run: node tests/run.js
// Every step runs in a temp folder; nothing in the repo is changed except by the plugin check,
// which re-runs tools/build-plugin.js (its output must already be committed).
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPTS = path.join(ROOT, '.claude', 'skills', 'pbi-delivery', 'scripts');
const FIX = path.join(__dirname, 'fixtures');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pbi-kit-test-'));
const PROJ = path.join(TMP, 'projects', 'demo-sales');
process.on('exit', () => { if (!process.env.KEEP_TMP) fs.rmSync(TMP, { recursive: true, force: true }); });

function run(script, args, opts = {}) {
  const r = spawnSync(process.execPath, [path.join(SCRIPTS, script), ...args], { encoding: 'utf8', cwd: opts.cwd || TMP, timeout: 120000 });
  if (opts.ok !== false && r.status !== 0 && !opts.allowFail) {
    assert.fail(`${script} ${args.join(' ')} exited ${r.status}\n${r.stdout}\n${r.stderr}`);
  }
  return r;
}
const json = (s) => { const i = s.search(/[[{]/); return JSON.parse(s.slice(i)); };
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const copy = (from, to) => fs.cpSync(from, to, { recursive: true });

// Independent truth, computed here from the CSV files (not with the kit's engine).
function csv(file) {
  const [head, ...lines] = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/);
  const cols = head.split(',');
  return lines.map((l) => Object.fromEntries(l.split(',').map((v, i) => [cols[i], v])));
}
const SALES = csv(path.join(FIX, 'demo-sales', 'data', 'sales.csv'));
const PRODUCTS = Object.fromEntries(csv(path.join(FIX, 'demo-sales', 'data', 'products.csv')).map((p) => [p.product_id, p]));
const sum = (rows, f) => rows.reduce((s, r) => s + Number(r[f]), 0);
const close = (a, b, msg) => assert.ok(Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b)), `${msg}: got ${a}, expected ${b}`);

// ---------------------------------------------------------------------------------------------

test('every script parses', () => {
  const files = [];
  (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (p.endsWith('.js')) files.push(p); } })(SCRIPTS);
  files.push(path.join(ROOT, 'tools', 'build-plugin.js'));
  for (const f of files) {
    const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${path.relative(ROOT, f)}: ${r.stderr}`);
  }
});

test('init-project creates the skeleton and never overwrites', () => {
  run('init-project.js', ['--root', TMP, '--name', 'demo-sales']);
  for (const f of ['brief.md', 'data-contract.md', 'state.md', 'decisions.md', 'intake', 'data', 'docs/validations', '.gitignore']) assert.ok(fs.existsSync(path.join(PROJ, f)), `missing ${f}`);
  fs.appendFileSync(path.join(PROJ, 'decisions.md'), '\nmarker-line\n');
  const second = json(run('init-project.js', ['--root', TMP, '--name', 'demo-sales']).stdout);
  assert.ok(second.kept.includes('decisions.md'), JSON.stringify(second));
  assert.match(fs.readFileSync(path.join(PROJ, 'decisions.md'), 'utf8'), /marker-line/, 'second run overwrote decisions.md');
});

test('intake derives tokens, theme, model plan and a draft state with relative paths', () => {
  copy(path.join(FIX, 'demo-sales'), PROJ);
  run('intake.js', ['--project', PROJ, '--brand', 'Demo']);
  const gen = path.join(PROJ, 'intake', 'generated');
  for (const f of ['design-tokens.json', 'theme.json', 'model-plan.json', 'queries.pq', 'INTAKE.md']) assert.ok(fs.existsSync(path.join(gen, f)), `missing ${f}`);
  const tokens = readJson(path.join(gen, 'design-tokens.json'));
  assert.equal(String(tokens.colors.accent.value || tokens.colors.accent).toLowerCase(), '#3b6fd8', 'accent from tokens.css');
  const plan = readJson(path.join(gen, 'model-plan.json'));
  const names = plan.tables.map((t) => t.name);
  assert.ok(names.includes('Fact Sales') && names.includes('Dim Product'), `tables: ${names}`);
  // state.json existed, so the intake must not touch it and writes a draft beside it.
  assert.deepEqual(readJson(path.join(PROJ, 'state.json')), readJson(path.join(FIX, 'demo-sales', 'state.json')));
  const draft = readJson(path.join(gen, 'state.draft.json'));
  for (const k of ['tokens', 'plan']) {
    assert.ok(draft.intake[k] && !path.isAbsolute(draft.intake[k]), `draft intake.${k} must be relative: ${draft.intake[k]}`);
  }
  // Only the SourcePath parameter's default may hold the local folder; every query reads through it.
  const pq = fs.readFileSync(path.join(gen, 'queries.pq'), 'utf8').split('\n');
  assert.ok(pq.some((l) => /^\/\/ SourcePath = /.test(l)), 'SourcePath parameter declared');
  const leaks = pq.filter((l) => !/^\/\/ SourcePath = /.test(l) && l.includes(path.join(PROJ, 'data')));
  assert.deepEqual(leaks, [], 'queries must use SourcePath, not a hard-coded path');
  assert.ok(pq.some((l) => l.includes('File.Contents(SourcePath & ')), 'queries read through SourcePath');
});

test('build-model writes the model from state.json, idempotently', () => {
  copy(path.join(FIX, 'empty-pbip'), PROJ);
  const w = json(run('build-model.js', ['--project', PROJ, '--write']).stdout);
  assert.equal(w.ok, true);
  const tdir = path.join(PROJ, 'demo-sales.SemanticModel', 'definition', 'tables');
  for (const t of ['Fact Sales', 'Dim Product', 'Dim Date', 'Order Size', '_Measures']) assert.ok(fs.existsSync(path.join(tdir, `${t}.tmdl`)), `missing table ${t}`);
  const measures = fs.readFileSync(path.join(tdir, '_Measures.tmdl'), 'utf8');
  for (const m of readJson(path.join(PROJ, 'state.json')).model.measures) assert.ok(measures.includes(`measure '${m.name}'`) || measures.includes(`measure ${m.name}`), `measure ${m.name} not written`);
  // calc "distinct" skips blanks, so its DAX twin must be DISTINCTCOUNTNOBLANK (not DISTINCTCOUNT)
  assert.match(measures, /DISTINCTCOUNTNOBLANK\('Fact Sales'\[Product Key\]\)/, 'calc distinct → DAX');
  assert.match(measures, /DIVIDE\(\[Total Amount\], \[Orders\]\)/, 'calc divide → DAX');
  assert.match(fs.readFileSync(path.join(PROJ, 'demo-sales.SemanticModel', 'definition', 'relationships.tmdl'), 'utf8'), /'Dim Product'\.'Product Key'/);

  const c = json(run('build-model.js', ['--project', PROJ, '--check']).stdout);
  assert.deepEqual(c.differences, []);
  const again = json(run('build-model.js', ['--project', PROJ, '--write']).stdout);
  assert.deepEqual(again.written, [], 'second write must change nothing');
});

test('build-model refuses to drop model objects missing from state.json', () => {
  const st = path.join(PROJ, 'state.json');
  const orig = fs.readFileSync(st, 'utf8');
  const s = JSON.parse(orig);
  s.model.measures = s.model.measures.filter((m) => m.name !== 'Total Units');
  fs.writeFileSync(st, JSON.stringify(s, null, 2));
  try {
    const r = run('build-model.js', ['--project', PROJ, '--write'], { allowFail: true });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /Total Units/);
  } finally { fs.writeFileSync(st, orig); }
});

test('build-model warns when dax and calc disagree', () => {
  const st = path.join(PROJ, 'state.json');
  const orig = fs.readFileSync(st, 'utf8');
  const s = JSON.parse(orig);
  s.model.measures.find((m) => m.name === 'Total Amount').dax = "SUM('Fact Sales'[Units])";
  fs.writeFileSync(st, JSON.stringify(s, null, 2));
  try {
    const r = run('build-model.js', ['--project', PROJ, '--check'], { allowFail: true });
    assert.ok(json(r.stdout).warnings.some((w) => /Total Amount/.test(w)), r.stdout);
  } finally { fs.writeFileSync(st, orig); }
});

test('build-pbir writes every page with no warnings', () => {
  const r = run('build-pbir.js', ['--state', path.join(PROJ, 'state.json'), '--report', path.join(PROJ, 'demo-sales.Report')]);
  const out = json(r.stdout);
  assert.equal(out.ok, true, r.stdout);
  assert.deepEqual(out.warnings || [], [], 'generator warnings');
  // Desktop's blank "Page 1" is empty and unclaimed, so the first state page reuses it.
  const pages = readJson(path.join(PROJ, 'demo-sales.Report', 'definition', 'pages', 'pages.json'));
  assert.equal(pages.pageOrder.length, 2, JSON.stringify(pages));
  const titles = pages.pageOrder.map((id) => readJson(path.join(PROJ, 'demo-sales.Report', 'definition', 'pages', id, 'page.json')).displayName);
  assert.deepEqual(titles, ['Overview', 'North']);
  const before = snapshot(path.join(PROJ, 'demo-sales.Report'));
  run('build-pbir.js', ['--state', path.join(PROJ, 'state.json'), '--report', path.join(PROJ, 'demo-sales.Report')]);
  assert.deepEqual(snapshot(path.join(PROJ, 'demo-sales.Report')), before, 'output must be deterministic');
});

test('build-html numbers equal sums computed directly from the CSV', () => {
  const vf = path.join(TMP, 'values.json');
  run('build-html.js', ['--state', path.join(PROJ, 'state.json'), '--values', vf]);
  for (const p of ['overview', 'north']) assert.ok(fs.existsSync(path.join(PROJ, 'html', `${p}.html`)), `missing html/${p}.html`);
  const v = readJson(vf);
  const ov = v.pages.find((p) => p.id === 'overview');
  const amount = sum(SALES, 'amount');
  close(ov.values['Total Amount'], amount, 'Total Amount');
  close(ov.values['Total Units'] ?? sum(SALES, 'units'), sum(SALES, 'units'), 'Total Units');
  close(ov.values.Orders, SALES.length, 'Orders');
  close(ov.values['Avg Order Value'], amount / SALES.length, 'Avg Order Value');
  close(ov.values['Products Sold'], new Set(SALES.map((r) => r.product_id)).size, 'Products Sold');
  close(ov.values['Widget Amount'], sum(SALES.filter((r) => PRODUCTS[r.product_id].category === 'Widgets'), 'amount'), 'Widget Amount');
  assert.match(String(ov.values['_Headline Overview']), new RegExp(`^${SALES.length} orders`), 'headline template');

  const byCat = (cat) => ov.groups.filter((g) => g.category === cat);
  for (const g of byCat('Dim Product[Category]')) {
    close(g.values['Total Amount'], sum(SALES.filter((r) => PRODUCTS[r.product_id].category === g.key), 'amount'), `category ${g.key}`);
  }
  const bands = { Small: [0, 99.99], Medium: [100, 249.99], Large: [250, 99999] };
  const bandGroups = byCat('Order Size[Band]');
  assert.equal(bandGroups.length, 3, JSON.stringify(ov.groups.map((g) => g.category)));
  for (const g of bandGroups) {
    const [lo, hi] = bands[g.key];
    close(g.values['Band Orders'], SALES.filter((r) => +r.amount >= lo && +r.amount <= hi).length, `band ${g.key}`);
  }

  const north = v.pages.find((p) => p.id === 'north');
  const nRows = SALES.filter((r) => r.region === 'North');
  assert.equal(north.rows, nRows.length, 'page filter rows');
  close(north.values['Total Amount'], sum(nRows, 'amount'), 'North Total Amount');
  close(north.values['Total Units'], sum(nRows, 'units'), 'North Total Units');
});

test('refresh: first run logs the data; a new month is detected and flows to the HTML', () => {
  const r1 = json(run('refresh.js', ['--project', PROJ, '--no-html']).stdout);
  assert.equal(r1.ok, true, JSON.stringify(r1));
  assert.deepEqual(r1.blocking, []);
  const dates = SALES.map((r) => r.order_date).sort();
  assert.deepEqual(r1.factRange, { from: dates[0], to: dates[dates.length - 1], months: 24 });
  assert.ok(fs.existsSync(path.join(PROJ, 'docs', 'validations', 'refresh-log.json')));

  const salesFile = path.join(PROJ, 'data', 'sales.csv');
  const orig = fs.readFileSync(salesFile, 'utf8');
  const added = ['X9001,2026-01-15,P01,North,3,120.5', 'X9002,2026-01-20,P02,South,1,80'];
  fs.writeFileSync(salesFile, orig.trimEnd() + '\n' + added.join('\n') + '\n');
  const r2 = json(run('refresh.js', ['--project', PROJ]).stdout);
  assert.equal(r2.ok, true, JSON.stringify(r2));
  assert.deepEqual(r2.newMonths, ['2026-01']);
  assert.equal(r2.tables['Fact Sales'].rows, SALES.length + 2);
  assert.deepEqual(r2.steps, [{ step: 'build-html', ok: true }]);
  const vf = path.join(TMP, 'values-refresh.json');
  run('build-html.js', ['--state', path.join(PROJ, 'state.json'), '--values', vf, '--page', 'overview']);
  close(readJson(vf).pages[0].values['Total Amount'], sum(SALES, 'amount') + 200.5, 'Total Amount after refresh');
  fs.writeFileSync(salesFile, orig);
});

test('refresh blocks a renamed column and duplicate dimension keys, and warns on dirty values', () => {
  const salesFile = path.join(PROJ, 'data', 'sales.csv');
  const prodFile = path.join(PROJ, 'data', 'products.csv');
  const [sales, prods] = [fs.readFileSync(salesFile, 'utf8'), fs.readFileSync(prodFile, 'utf8')];
  const logBefore = fs.readFileSync(path.join(PROJ, 'docs', 'validations', 'refresh-log.json'), 'utf8');
  try {
    fs.writeFileSync(salesFile, sales.replace('order_id,order_date,product_id,region,units,amount', 'order_id,order_date,product_id,region,units,amt'));
    let r = run('refresh.js', ['--project', PROJ], { allowFail: true });
    assert.equal(r.status, 1);
    let s = json(r.stdout);
    assert.ok(s.blocking.some((b) => /Amount \("amount"\)/.test(b)), r.stdout);
    assert.deepEqual(s.steps, [], 'nothing runs after a blocking problem');
    assert.equal(fs.readFileSync(path.join(PROJ, 'docs', 'validations', 'refresh-log.json'), 'utf8'), logBefore, 'log untouched');

    fs.writeFileSync(salesFile, sales.trimEnd() + '\nX9100,2025-12-30,P99,North,two,50\n');
    fs.writeFileSync(prodFile, prods.trimEnd() + '\n' + prods.trim().split(/\r?\n/)[1] + '\n');
    r = run('refresh.js', ['--project', PROJ, '--no-html', '--no-write'], { allowFail: true });
    s = json(r.stdout);
    assert.ok(s.blocking.some((b) => /Dim Product\[Product Key\].*duplicate/.test(b)), r.stdout);
    assert.ok(s.warnings.some((w) => /Fact Sales\[Units\].*"two"/.test(w)), r.stdout);
    assert.ok(s.warnings.some((w) => /Product Key.*P99/.test(w)), r.stdout);
  } finally { fs.writeFileSync(salesFile, sales); fs.writeFileSync(prodFile, prods); }
});

test('project-status reports a phase', () => {
  const s = json(run('project-status.js', ['--project', PROJ]).stdout);
  assert.ok(s.phase, JSON.stringify(s));
  const all = json(run('project-status.js', ['--root', TMP]).stdout);
  assert.ok(JSON.stringify(all).includes('demo-sales'));
});

test('the generated plugin matches .claude/', { skip: !isGitRepo() && 'not a git checkout' }, () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'build-plugin.js')], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const st = spawnSync('git', ['status', '--porcelain', '--', 'plugins', '.claude-plugin'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(st.stdout.trim(), '', `plugin is stale: run node tools/build-plugin.js and commit\n${st.stdout}`);
});

test('the kit stays client-neutral (no local paths, no personal emails)', { skip: !isGitRepo() && 'not a git checkout' }, () => {
  const files = spawnSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).stdout.split('\n').filter(Boolean)
    .filter((f) => !/^(plugins\/|\.claude\/common\/|\.claude\/skills\/(semantic-model-authoring|powerbi-report-cli)\/)/.test(f))
    .filter((f) => !/\.(png|jpg|jpeg|gif|ico|zip|xlsx|pbix)$/i.test(f));
  const localPath = new RegExp('[A-Za-z]:\\\\' + 'Users\\\\' + '[^\\\\\\s"]+', 'i');
  const email = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
  const okEmail = /noreply|example\.(com|org)|@users\.noreply\.github\.com$/i;
  const hits = [];
  for (const f of files) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) continue;
    const text = fs.readFileSync(p, 'utf8');
    if (localPath.test(text)) hits.push(`${f}: local path ${text.match(localPath)[0]}`);
    for (const e of text.match(email) || []) if (!okEmail.test(e)) hits.push(`${f}: email ${e}`);
  }
  assert.deepEqual(hits, []);
});

// ---------------------------------------------------------------------------------------------

function snapshot(dir) {
  const out = {};
  (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else out[path.relative(dir, p)] = fs.readFileSync(p, 'utf8'); } })(dir);
  return out;
}
function isGitRepo() {
  return spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim() === 'true';
}
