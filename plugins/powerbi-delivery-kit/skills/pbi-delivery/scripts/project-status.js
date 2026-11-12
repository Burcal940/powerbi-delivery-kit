#!/usr/bin/env node
// pbi-delivery · project-status.js
// Reads a project folder and says which phase it is in and what the next step is, from evidence on
// disk (files present, state.json, the model's TMDL, the report's pages) plus the approvals logged
// in decisions.md / state.md. Used by /dashboard and /status. Read-only.
// Usage: node project-status.js --project <folder>     (one project)
//        node project-status.js --root <repo>          (every projects/*/ with a state.md or state.json)
'use strict';
const fs = require('fs');
const path = require('path');

const a = {};
for (let i = 2; i < process.argv.length; i += 2) a[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
if (!a.project && !a.root) { console.error('Usage: node project-status.js --project <folder> | --root <repo>'); process.exit(2); }

const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };
const ls = (p) => { try { return fs.readdirSync(p, { withFileTypes: true }); } catch { return []; } };
const IGNORE = /^(README\.md|\.gitkeep|generated)$/i;
// is git on PATH? (one cheap check per run)
const GIT = (() => { try { return require('child_process').spawnSync('git', ['--version'], { encoding: 'utf8', timeout: 10000 }).status === 0; } catch { return false; } })();

// Phases in order. `who` = who acts next; `cmd` = the command/skill that does it.
const PHASES = [
  { id: 'material', who: 'user', cmd: null, todo: 'Share design material in intake/ and data in data/ (see intake/README.md)' },
  { id: 'intake', who: 'claude', cmd: 'new-project', todo: 'Run intake.js and reshape state.json to the shared image/mockup' },
  { id: 'spec', who: 'user', cmd: 'new-project', todo: 'Answer the confirmation round and approve state.json' },
  { id: 'mockup', who: 'claude', cmd: 'build-mockup', todo: 'Build the HTML mockup(s)' },
  { id: 'mockup-review', who: 'user', cmd: 'build-mockup', todo: 'Review and approve the mockup(s)' },
  { id: 'pbip', who: 'user', cmd: null, todo: 'Power BI Desktop: set regional settings, then File → Save as → Power BI Project (.pbip) into the project folder' },
  { id: 'pbi', who: 'claude', cmd: 'build-pbi', todo: 'Build model + pages in Power BI, validate, screenshot, review' },
  { id: 'html', who: 'claude', cmd: 'build-html', todo: 'Build the interactive HTML and check its numbers equal Power BI' },
  { id: 'close', who: 'claude', cmd: 'build-pbi', todo: 'Reconcile totals, run model-reviewer, update state.md / decisions.md, mark done' },
  { id: 'done', who: null, cmd: null, todo: 'Delivered. Changes: edit state.json and rebuild' },
];

function findUp(dir, test, depth = 2) {
  const out = [];
  for (const e of ls(dir)) {
    const p = path.join(dir, e.name);
    if (test(e, p)) out.push(p);
    else if (e.isDirectory() && depth > 0 && !/^(\.git|node_modules|data|html|intake|mockups)$/.test(e.name)) out.push(...findUp(p, test, depth - 1));
  }
  return out;
}

function status(dir) {
  const P = (...x) => path.join(dir, ...x);
  const stateMd = read(P('state.md'));
  const decisions = read(P('decisions.md'));
  const log = stateMd + '\n' + decisions;
  const statusLine = (stateMd.match(/\*\*Status:\*\*\s*(.+)/) || [])[1] || '';
  const updated = (stateMd.match(/\*\*Last updated:\*\*\s*(\S+)/) || [])[1] || null;

  let state = null; let stateError = null;
  if (fs.existsSync(P('state.json'))) { try { state = JSON.parse(read(P('state.json'))); } catch (e) { stateError = e.message; } }
  const pages = (state && state.pages) || [];
  const measures = (state && state.model && state.model.measures) || [];

  const material = {
    design: ls(P('intake')).filter((e) => !IGNORE.test(e.name)).map((e) => e.name),
    data: ls(P('data')).filter((e) => !IGNORE.test(e.name)).map((e) => e.name),
  };
  const intakeDone = fs.existsSync(P('intake', 'generated', 'INTAKE.md'));

  // approvals are logged by the commands (decisions.md "Spec approved", "approved … mockup")
  const specApproved = /spec approved|approved (the )?state\.json|state\.json approved/i.test(log);
  const mockupApproved = /mockup approved|approved the (static )?mockup|approved (the )?mockups?\b/i.test(log);
  const done = /^done\b/i.test(statusLine.trim());

  const mockups = pages.map((p) => ({ id: p.id, ok: fs.existsSync(P('mockups', `${p.id}.html`)) }));
  const pbip = findUp(dir, (e) => e.isFile() && e.name.endsWith('.pbip')).map((p) => path.relative(dir, p));
  const reportDir = findUp(dir, (e) => e.isDirectory() && e.name.endsWith('.Report'))[0];
  const modelDir = findUp(dir, (e) => e.isDirectory() && e.name.endsWith('.SemanticModel'))[0];

  const reportPages = [];
  if (reportDir) for (const e of ls(path.join(reportDir, 'definition', 'pages'))) {
    if (!e.isDirectory()) continue;
    try { reportPages.push(JSON.parse(read(path.join(reportDir, 'definition', 'pages', e.name, 'page.json'))).displayName); } catch { /* skip */ }
  }
  const modelMeasures = new Set();
  if (modelDir) for (const e of ls(path.join(modelDir, 'definition', 'tables'))) {
    for (const m of read(path.join(modelDir, 'definition', 'tables', e.name)).matchAll(/^\s*measure\s+(?:'((?:[^']|'')+)'|([^\s=]+))/gm)) modelMeasures.add((m[1] || m[2]).replace(/''/g, "'"));
  }
  const missingInModel = modelDir ? measures.map((m) => m.name).filter((n) => !modelMeasures.has(n)) : measures.map((m) => m.name);
  const pagesBuilt = pages.length > 0 && pages.every((p) => reportPages.includes(p.title));
  const missingCalc = measures.filter((m) => !m.calc).map((m) => m.name);
  const html = pages.map((p) => ({ id: p.id, ok: fs.existsSync(P('html', `${p.id}.html`)) }));
  const validations = ls(P('docs', 'validations')).filter((e) => e.isFile() && !IGNORE.test(e.name)).map((e) => e.name);
  const reconciled = validations.some((n) => /reconcil/i.test(n));

  const blockers = (stateMd.split(/^## /m).find((s) => /^Blockers/i.test(s)) || '').split('\n').filter((l) => /^\s*-\s+\S/.test(l)).map((l) => l.replace(/^\s*-\s+/, ''));
  const tbd = measures.filter((m) => /^(TBD|PROPOSED)/i.test(m.definition || '')).map((m) => m.name);

  let phase;
  if (done) phase = 'done';
  else if (!state && !intakeDone && !material.design.length && !material.data.length) phase = 'material';
  else if (!intakeDone && (material.design.length || material.data.length) && !specApproved) phase = 'intake';
  else if (!specApproved) phase = 'spec';
  else if (!mockups.length || mockups.some((m) => !m.ok)) phase = 'mockup';
  else if (!mockupApproved) phase = 'mockup-review';
  else if (!pbip.length) phase = 'pbip';
  else if (!pagesBuilt || missingInModel.length) phase = 'pbi';
  else if (html.some((h) => !h.ok)) phase = 'html';
  else phase = 'close';

  const ph = PHASES.find((x) => x.id === phase);
  const warnings = [];
  if (stateError) warnings.push(`state.json does not parse: ${stateError}`);
  if (phase === 'html' && missingCalc.length) warnings.push(`measures without calc (build-html needs them): ${missingCalc.join(', ')}`);
  if (['pbi', 'html', 'close'].includes(phase) && tbd.length) warnings.push(`measures still TBD/PROPOSED: ${tbd.join(', ')}`);
  if (phase === 'close' && !reconciled) warnings.push('no reconciliation file in docs/validations/');
  // every project is its own git repo (the kit ignores projects/*): without it nothing is versioned
  if (phase !== 'material') {
    if (!GIT) warnings.push('git is not installed: nothing is versioned or pushed (winget install Git.Git, then restart VS Code)');
    else if (!fs.existsSync(P('.git'))) warnings.push('project folder is not a git repo: run git init in it (the kit repo ignores projects/*)');
  }

  return {
    project: path.basename(dir), folder: dir, statusLine, updated,
    phase, step: `${PHASES.indexOf(ph) + 1}/${PHASES.length}`, next: { who: ph.who, command: ph.cmd, todo: ph.todo },
    evidence: {
      material, intakeDone, specApproved, mockups, mockupApproved, pbip,
      report: reportDir ? path.relative(dir, reportDir) : null, reportPages, pagesBuilt,
      model: modelDir ? path.relative(dir, modelDir) : null, missingInModel, missingCalc, html, validations, reconciled,
    },
    blockers, warnings,
  };
}

if (a.project) {
  const dir = path.resolve(a.project);
  if (!fs.existsSync(dir)) { console.log(JSON.stringify({ project: path.basename(dir), exists: false, phase: 'none', next: { who: 'claude', command: 'new-project', todo: 'Create the project' } }, null, 2)); process.exit(0); }
  console.log(JSON.stringify(status(dir), null, 2));
} else {
  const root = path.resolve(a.root, 'projects');
  const all = ls(root).filter((e) => e.isDirectory() && (fs.existsSync(path.join(root, e.name, 'state.md')) || fs.existsSync(path.join(root, e.name, 'state.json'))))
    .map((e) => { const s = status(path.join(root, e.name)); return { project: s.project, phase: s.phase, step: s.step, next: s.next.todo, statusLine: s.statusLine, updated: s.updated }; });
  console.log(JSON.stringify(all, null, 2));
}
