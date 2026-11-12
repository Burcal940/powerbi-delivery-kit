#!/usr/bin/env node
// pbi-delivery · draft-state.js
// Assembles a first state.json from what was shared: design tokens (extract-design.js) + model plan
// (profile-data.js). Proposes a KPI-overview page; Claude then reshapes pages from the shared
// mockup/design (references/intake.md). Everything business-specific is marked TBD/proposed.
//
// Usage: node draft-state.js --tokens <design-tokens.json> --plan <model-plan.json> --name <project>
//                            [--theme <theme.json path for state>] [--brand "<wordmark>"] [--out <state.json>]
//                            [--base <project folder>]  (intake paths are written relative to it)
'use strict';
const fs = require('fs');
const path = require('path');

const a = {};
for (let i = 2; i < process.argv.length; i += 2) a[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
if (!a.name || (!a.tokens && !a.plan)) { console.error('Usage: node draft-state.js --tokens <design-tokens.json> --plan <model-plan.json> --name <project> [--theme <path>] [--brand <text>] [--out <state.json>]'); process.exit(2); }
const rj = (f) => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, ''));
const tk = a.tokens ? rj(a.tokens) : { colors: {}, layout: {}, font: {} };
const plan = a.plan ? rj(a.plan) : { tables: [], relationships: [], dateTable: null };
const c = tk.colors || {}; const L = tk.layout || {};
const baseDir = path.resolve(a.base || (a.out ? path.dirname(a.out) : '.'));
const relP = (p) => (p ? path.relative(baseDir, path.resolve(p)).replace(/\\/g, '/') : null);

// ---------- measures (technical aggregations only; definitions to confirm) ----------
const facts = plan.tables.filter((t) => t.role === 'fact');
const dims = plan.tables.filter((t) => t.role === 'dimension');
const measures = []; const kpis = [];
// headline-like amounts first (revenue, sales, amount…), ratios last
const PRIORITY = /(revenue|sales|amount|value|total|importe|ventas|ingreso|monto|valor|gross|net)/i;
for (const f of facts) {
  const ratios = new Set(f.ratioColumns || []);
  const cols = [...f.measureCandidates].sort((x, y) => (ratios.has(x) - ratios.has(y)) || (PRIORITY.test(y) - PRIORITY.test(x)));
  for (const col of cols) {
    const isRatio = ratios.has(col);
    const name = isRatio ? `Avg ${col}` : `Total ${col}`;
    measures.push({ name, definition: `PROPOSED: ${isRatio ? 'AVERAGE' : 'SUM'}(${f.name}[${col}]) — confirm definition and exclusions${isRatio ? ' (ratio column: averaged, consider a weighted average)' : ''}`, format: isRatio ? '0.0%' : '#,##0' });
    kpis.push({ name, fact: f, format: isRatio ? '0.0%' : '#,##0' });
  }
  const cnt = `${f.name.replace(/^Fact /, '')} Count`;
  measures.push({ name: cnt, definition: `PROPOSED: COUNTROWS(${f.name}) — confirm what is counted`, format: '#,##0' });
  kpis.push({ name: cnt, fact: f });
}
const chosen = kpis.slice(0, 4);
const hasDate = !!(plan.dateTable && facts.some((f) => f.dateColumns.length));
for (const k of chosen) {
  if (hasDate) {
    measures.push({ name: `${k.name} PY`, definition: `${k.name} for the same period of the previous year`, format: k.format || '#,##0' });
    measures.push({ name: `${k.name} YoY %`, definition: `(${k.name} − PY) / PY`, format: '+0.0%;-0.0%;0.0%' });
    measures.push({ name: `_Delta Label ${k.name}`, definition: "text: '▲ x.x% vs PY' / '▼ …' / '—' when no PY", hidden: true });
  }
  measures.push({ name: `_Status Color ${k.name}`, definition: 'TBD — ask: polarity (is up good?) → good/bad/neutral hex from the design tokens', hidden: true });
}
measures.push({ name: '_Headline Overview', definition: 'TBD — insight sentence for the page (from the mockup headline or the brief)', hidden: true });

// ---------- page proposal ----------
const kpiItems = chosen.map((k) => ({
  type: 'kpi', label: k.name.replace(/^(Total|Avg) /, ''), measure: k.name,
  ...(hasDate ? { reference: `_Delta Label ${k.name}` } : {}), status: `_Status Color ${k.name}`,
}));
const firstDim = dims.find((d) => d.attributes.length);
const rows = [];
if (kpiItems.length) rows.push({ height: 140, items: kpiItems });
const charts = [];
if (chosen[0] && hasDate) charts.push({ type: 'chart', visual: 'lineChart', title: `TBD — insight: ${chosen[0].name} trend vs PY`, category: 'Dim Date[Month]',
  series: [{ measure: chosen[0].name, color: c.accent }, { measure: `${chosen[0].name} PY`, label: 'PY', color: c.secondary || c.subtle }] });
if (chosen[0] && firstDim) charts.push({ type: 'chart', visual: 'clusteredBarChart', title: `TBD — insight: ${chosen[0].name} by ${firstDim.attributes[0]}`,
  category: `${firstDim.name}[${firstDim.attributes[0]}]`, series: [{ measure: chosen[0].name, color: c.accent }],
  sort: { field: `${firstDim.name}[${firstDim.attributes[0]}]`, direction: 'Ascending' } });
if (charts.length) rows.push({ height: 380, items: charts });
if (firstDim && chosen.length) rows.push({ height: 'fill', items: [{ type: 'table', title: `TBD — insight: detail by ${firstDim.attributes[0]}`,
  columns: [{ field: `${firstDim.name}[${firstDim.attributes[0]}]` }, ...chosen.map((k) => ({ measure: k.name }))] }] });
const year = plan.dateTable && plan.dateTable.to;

const state = {
  $schema: 'pbi-delivery/state/1',
  project: a.name,
  updated: new Date().toISOString().slice(0, 10),
  dataStatus: plan.tables.length ? 'real' : 'sample',
  // paths relative to the project folder (--base, default: the folder of --out) — never machine paths in state.json
  intake: { tokens: relP(a.tokens), plan: relP(a.plan), toConfirm: [...(tk.toConfirm || []), ...(plan.toConfirm || [])] },
  designSystem: {
    name: a.brand || a.name,
    theme: a.theme || null,
    themeName: (a.brand || a.name).replace(/[^A-Za-z0-9]+/g, ''),
    font: (tk.font && tk.font.stack) || 'Segoe UI, sans-serif',
    colors: {
      ink: c.ink, muted: c.muted, subtle: c.subtle, surface: c.surface, border: c.border, accent: c.accent,
      sidebar: c.sidebar, sidebarText: c.sidebarText, sidebarSection: c.sidebarSection, onAccent: c.onAccent || '#FFFFFF',
      good: c.good, bad: c.bad, warning: c.warning, secondary: c.secondary,
    },
  },
  canvas: { width: L.canvasWidth || 1920, height: L.canvasHeight || 1080, padding: L.padding || 32, gutter: L.gutter || 24, radius: L.radius || 12 },
  shell: {
    ...(L.sidebarWidth ? { sidebar: { width: L.sidebarWidth, brand: a.brand || a.name, subtitle: 'TBD — report name', section: 'MAIN MENU', items: ['Overview'] } } : {}),
    header: { height: L.headerHeight || 72 },
  },
  model: {
    measureTable: '_Measures',
    tables: plan.tables.map((t) => ({ name: t.name, role: t.role, source: t.source, grain: t.grain })),
    relationships: plan.relationships,
    measures,
  },
  pages: [{
    id: 'overview', title: 'Overview', mockup: 'mockups/overview.html',
    headline: { measure: '_Headline Overview' },
    tag: year ? `FY ${year}` : 'TBD — period',
    filters: year ? [{ field: 'Dim Date[Year]', values: [year] }] : [],
    rows,
  }],
  pbiNotFeasible: [],
};
const out = a.out || 'state.json';
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(out, JSON.stringify(state, null, 2));
console.log(JSON.stringify({ ok: true, out, kpis: chosen.map((k) => k.name), measures: measures.length, rows: rows.length, toConfirm: state.intake.toConfirm.length }, null, 2));
