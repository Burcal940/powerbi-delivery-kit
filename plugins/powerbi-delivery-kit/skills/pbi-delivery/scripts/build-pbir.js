#!/usr/bin/env node
// pbi-delivery · build-pbir.js
// Generates Power BI report pages (PBIR) from a project's state.json.
//
// Usage:
//   node build-pbir.js --state <projects/x/state.json> --report <projects/x/X.Report> [--page <id>] [--theme <theme.json>]
//
// Contract (see ../references/state-schema.md):
//   - Every page listed in state.json is OWNED by this generator: its visuals/ folder is
//     deleted and rebuilt on each run. Make layout changes in state.json, not in Desktop.
//   - Pages not listed in state.json are never touched.
//   - It never creates the PBIP shell (.pbip / definition.pbir / report.json); Power BI Desktop does.
//   - It does not create measures; it warns when a referenced measure is missing from the TMDL.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// JSON files written on Windows (PowerShell, some editors) may start with a UTF-8 BOM.
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));

// ---------- args ----------
const args = {};
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
if (!args.state || !args.report) {
  console.error('Usage: node build-pbir.js --state <state.json> --report <X.Report> [--page <id>] [--theme <theme.json>]');
  process.exit(2);
}
const statePath = path.resolve(args.state);
const reportDir = path.resolve(args.report);
const state = readJson(statePath);
const def = path.join(reportDir, 'definition');
if (!fs.existsSync(path.join(def, 'pages', 'pages.json'))) {
  console.error(`No PBIR found at ${reportDir}. Save the report from Power BI Desktop as .pbip first.`);
  process.exit(2);
}

// ---------- design tokens: ALWAYS come from the client design system via state.designSystem.colors ----------
// The fallbacks below are neutral placeholders only, so a missing token is visible but not branded.
const ds = state.designSystem || {};
const C = Object.assign({
  ink: '#222222', muted: '#666666', subtle: '#999999', surface: '#FFFFFF', border: '#E5E5E5',
  accent: '#0066CC', sidebar: '#222222', sidebarText: '#BBBBBB', sidebarSection: '#777777', onAccent: '#FFFFFF',
}, ds.colors || {});
const missingTokens = ['ink', 'muted', 'subtle', 'surface', 'border', 'accent'].filter((k) => !(ds.colors && ds.colors[k]));
const FONT = ds.font || 'Segoe UI';
const canvas = Object.assign({ width: 1920, height: 1080, padding: 32, gutter: 24, radius: 12 }, state.canvas || {});
const shell = state.shell || {};
const SB = shell.sidebar ? Object.assign({ width: 240 }, shell.sidebar) : null;
const HD = Object.assign({ height: 72 }, shell.header || {});
const MT = (state.model && state.model.measureTable) || '_Measures';
const VSCHEMA = 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/visualContainer/2.9.0/schema.json';

// ---------- expression helpers ----------
const lit = (v) => ({ expr: { Literal: { Value: v } } });
const str = (s) => lit(`'${String(s).replace(/'/g, "''")}'`);
const num = (n) => lit(`${n}D`);
const bool = (b) => lit(b ? 'true' : 'false');
const color = (hex) => ({ solid: { color: str(hex) } });
const parseField = (ref) => {
  const m = /^(.+)\[(.+)\]$/.exec(ref);
  if (!m) throw new Error(`Field must be 'Table[Column]': ${ref}`);
  return { table: m[1].replace(/^'|'$/g, ''), column: m[2] };
};
const measureExpr = (name) => ({ Measure: { Expression: { SourceRef: { Entity: MT } }, Property: name } });
const columnExpr = (ref) => { const f = parseField(ref); return { Column: { Expression: { SourceRef: { Entity: f.table } }, Property: f.column } }; };
const usedMeasures = new Set();
const mProj = (name, displayName) => {
  usedMeasures.add(name);
  const p = { field: measureExpr(name), queryRef: `${MT}.${name}`, nativeQueryRef: name };
  if (displayName) p.displayName = displayName;
  return p;
};
const cProj = (ref, displayName) => {
  const f = parseField(ref);
  const p = { field: columnExpr(ref), queryRef: `${f.table}.${f.column}`, nativeQueryRef: f.column };
  if (displayName) p.displayName = displayName;
  return p;
};
const colorFromMeasure = (name) => { usedMeasures.add(name); return { solid: { color: { expr: measureExpr(name) } } }; };
const def0 = (properties) => [{ properties, selector: { id: 'default' } }];
const plain = (properties) => [{ properties }];
const noChrome = () => ({
  background: plain({ show: bool(false) }),
  border: plain({ show: bool(false) }),
  dropShadow: plain({ show: bool(false) }),
  title: plain({ show: bool(false) }),
  padding: plain({ top: num(0), bottom: num(0), left: num(0), right: num(0) }),
});
const titleProp = (item) => (item.titleMeasure ? (usedMeasures.add(item.titleMeasure), { expr: measureExpr(item.titleMeasure) }) : str(item.title || ''));
// Optional soft card shadow from state.designSystem.cardShadow { color, transparency, blur, distance, spread }.
const SH = ds.cardShadow || null;
const shadowProps = () => SH && {
  dropShadow: plain({ show: bool(true), color: color(SH.color || C.ink), position: str('Outer'), preset: str('Custom'),
    shadowSpread: num(SH.spread || 0), shadowBlur: num(SH.blur || 6), angle: num(90), shadowDistance: num(SH.distance || 2),
    transparency: num(SH.transparency == null ? 88 : SH.transparency) }),
  border: plain({ show: bool(false), radius: num(canvas.radius) }),
};
// overlayTitle: the title is drawn as a separate card on the legend row (mockup layout), so the container title is hidden.
const chartChrome = (item, overlayTitle) => ({
  ...(SH ? { dropShadow: shadowProps().dropShadow } : {}),
  title: plain(overlayTitle ? { show: bool(false) }
    : { show: bool(!!(item.title || item.titleMeasure)), text: titleProp(item), fontSize: num(12), bold: bool(true), fontColor: color(C.ink) }),
  subTitle: plain({ show: bool(false) }),
  padding: plain({ top: num(16), bottom: num(16), left: num(24), right: num(24) }),
});
const sortDef = (sort) => sort && {
  sort: [{ field: columnExpr(sort.field), direction: sort.direction || 'Ascending' }],
  isDefaultSort: true,
};

// Deterministic ids: regenerating an unchanged state.json produces identical files (clean git diffs).
const stableId = (...parts) => crypto.createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 20);

// ---------- visual builders (each pushes into `out`) ----------
function builder(out, pageId) {
  let z = 0;
  const add = (x, y, w, h, visual) => {
    z += 1000;
    out.push({ $schema: VSCHEMA, name: stableId(pageId, z, visual.visualType),
      position: { x: Math.round(x), y: Math.round(y), z, height: Math.round(h), width: Math.round(w), tabOrder: z }, visual });
  };
  // Rectangles (tiles, header, sidebar) are empty textboxes painted by the visual container:
  // the 'shape' visual draws a theme-colored (blue) frame in Desktop even with outline off.
  const shape = (x, y, w, h, fill, o = {}) => add(x, y, w, h, {
    visualType: 'textbox',
    objects: { general: plain({ paragraphs: [{ textRuns: [{ value: '' }] }] }) },
    visualContainerObjects: Object.assign(noChrome(), o.shadow && SH ? shadowProps() : {}, {
      background: plain({ show: bool(true), color: color(fill), transparency: num(0) }),
      // Rounded corners need a visible border; without an outline it takes the fill color.
      border: plain(o.outline || o.rounded
        ? { show: bool(true), color: color(o.outline || fill), width: num(1), radius: num(o.rounded || 0) }
        : { show: bool(false) }),
    }),
  });
  const text = (x, y, w, h, value, s) => add(x, y, w, h, {
    visualType: 'textbox',
    objects: { general: plain({ paragraphs: [{ textRuns: [{ value, textStyle: { fontFamily: FONT, fontSize: s.size, color: s.color, ...(s.bold ? { fontWeight: 'bold' } : {}) } }], horizontalTextAlignment: s.align || 'left' }] }) },
    visualContainerObjects: noChrome(),
  });
  const card = (x, y, w, h, measure, o = {}) => add(x, y, w, h, {
    visualType: 'cardVisual',
    query: { queryState: { Data: { projections: [mProj(measure)] } } },
    objects: {
      value: def0({
        fontSize: num(o.size || 21), bold: bool(o.bold !== false), fontFamily: str(FONT),
        horizontalAlignment: str('left'), labelDisplayUnits: str('1'),
        fontColor: o.colorMeasure ? colorFromMeasure(o.colorMeasure) : color(o.color || C.ink),
      }),
      label: def0(o.label === false ? { show: bool(false) }
        : { show: bool(true), text: str(o.label || measure), position: str('aboveValue'), fontSize: num(9), fontColor: color(C.muted), horizontalAlignment: str('left') }),
      fillCustom: def0({ show: bool(false) }),
      outline: def0({ show: bool(false) }),
      padding: def0({ paddingUniform: num(0) }),
      layout: def0({ paddingUniform: num(0), alignment: str('left') }),
    },
    visualContainerObjects: noChrome(),
  });
  return { add, shape, text, card };
}

// ---------- item renderers ----------
function renderItem(b, item, x, y, w, h) {
  const tile = () => b.shape(x, y, w, h, C.surface, { rounded: canvas.radius, outline: C.border, shadow: true });
  const ref = (measure, status) => measure && b.card(x + 24, y + h - 44, w - 48, 24, measure,
    { label: false, size: 9, bold: false, ...(status ? { colorMeasure: status } : { color: C.muted }) });

  switch (item.type) {
    case 'kpi': {
      tile();
      b.card(x + 24, y + 20, w - 48, 72, item.measure, { label: item.label, ...(item.valueStatus ? { colorMeasure: item.valueStatus } : {}) });
      ref(item.reference, item.status);
      return;
    }
    case 'kpiGroup': {
      tile();
      const n = item.items.length; const cw = (w - 48) / n;
      item.items.forEach((k, i) => b.card(x + 24 + i * cw, y + 20, cw, 72, k.measure, { label: k.label, ...(k.status ? { colorMeasure: k.status } : {}) }));
      ref(item.reference, item.status);
      return;
    }
    case 'chart': {
      const visualType = item.visual || 'columnChart';
      const isCombo = visualType === 'lineClusteredColumnComboChart';
      const series = item.series || [];
      const lines = item.lines || [];
      const queryState = { Category: { projections: [cProj(item.category)] }, Y: { projections: series.map((s) => mProj(s.measure, s.label)) } };
      if (isCombo && lines.length) queryState.Y2 = { projections: lines.map((s) => mProj(s.measure, s.label)) };
      const objects = {
        dataPoint: [...series, ...lines].filter((s) => s.color).map((s) => ({ properties: { fill: color(s.color) }, selector: { metadata: `${MT}.${s.measure}` } })),
        legend: plain({ show: bool(item.legend !== false && series.length + lines.length > 1), position: str('TopRight') }),
        // Categorical axis = one label per category (every day / every STAKE) and no vertical gridlines.
        categoryAxis: plain({ showAxisTitle: bool(false), gridlineShow: bool(false),
          ...(item.axisFontSize ? { fontSize: num(item.axisFontSize) } : {}),
          ...(item.axisType ? { axisType: str(item.axisType) } : {}),
          ...(item.axisType === 'Categorical' ? { preferredCategoryWidth: num(item.categoryWidth || 20), concatenateLabels: bool(false) } : {}) }),
        valueAxis: plain({ showAxisTitle: bool(false), gridlineShow: bool(true), labelDisplayUnits: num(1),
          ...(item.yMin != null ? { start: num(item.yMin) } : {}), ...(item.yMax != null ? { end: num(item.yMax) } : {}),
          ...(isCombo ? { secShow: bool(false), alignZeros: bool(true) } : {}) }),
      };
      const styled = lines.filter((s) => s.style);
      if (isCombo && styled.length) objects.lineStyles = styled.map((s) => ({ properties: { lineStyle: str(s.style), strokeWidth: num(2), showMarker: bool(false) }, selector: { metadata: `${MT}.${s.measure}` } }));
      // Straight segments like the mockup (the Fluent2 base theme defaults line/area charts to smooth).
      if (/^(line|area|stackedArea)Chart$/.test(visualType)) objects.lineStyles = [{ properties: { lineChartType: str(item.lineType || 'linear') } }, ...(objects.lineStyles || [])];
      const query = { queryState };
      const sd = sortDef(item.sort || { field: item.category, direction: 'Ascending' });
      if (sd) query.sortDefinition = sd;
      const overlay = !!(item.title || item.titleMeasure);
      b.add(x, y, w, h, { visualType, query, objects, visualContainerObjects: chartChrome(item, overlay) });
      // Title on the legend row, left-aligned (the legend sits TopRight of the plot area).
      if (overlay) {
        const tw = w - 24 - (item.legendWidth || 190); // leave room for the TopRight legend
        if (item.titleMeasure) b.card(x + 24, y + 14, tw, 28, item.titleMeasure, { label: false, size: 12 });
        else b.text(x + 20, y + 12, tw, 30, item.title, { size: '12pt', color: C.ink, bold: true });
      }
      return;
    }
    case 'table': {
      const projections = item.columns.map((c) => (c.measure ? mProj(c.measure, c.label) : cProj(c.field, c.label)));
      const query = { queryState: { Values: { projections } } };
      if (item.sort) query.sortDefinition = sortDef(item.sort);
      b.add(x, y, w, h, {
        visualType: 'tableEx', query,
        objects: { columnHeaders: plain({ columnAdjustment: str('growToFit'), autoSizeColumnWidth: bool(true) }) },
        visualContainerObjects: chartChrome(item),
      });
      return;
    }
    case 'text': {
      b.text(x, y, w, h, item.text, { size: item.size || '10.5pt', color: item.color || C.muted, bold: item.bold, align: item.align });
      return;
    }
    default:
      throw new Error(`Unknown item type '${item.type}' (page item ${JSON.stringify(item).slice(0, 80)})`);
  }
}

function renderPage(page) {
  const out = []; const b = builder(out, page.id);
  const sbw = SB ? SB.width : 0;
  // Sidebar
  if (SB) {
    b.shape(0, 0, sbw, canvas.height, C.sidebar);
    if (SB.brand) b.text(24, 20, sbw - 40, 32, SB.brand, { size: '18pt', color: C.onAccent, bold: true });
    if (SB.subtitle) b.text(24, 52, sbw - 40, 20, SB.subtitle, { size: '9pt', color: C.sidebarText });
    if (SB.section) b.text(24, 104, sbw - 40, 18, SB.section, { size: '8.25pt', color: C.sidebarSection, bold: true });
    const active = page.navLabel || page.title;
    (SB.items || []).forEach((label, i) => {
      const y = 128 + i * 48; const on = label === active;
      if (on) b.shape(16, y, sbw - 32, 40, C.accent, { rounded: 8 });
      b.text(32, y + 10, sbw - 60, 22, label, { size: '10.5pt', color: on ? C.onAccent : C.sidebarText, bold: on });
    });
  }
  // Header
  const x0 = sbw + canvas.padding;
  const W = canvas.width - sbw - 2 * canvas.padding;
  b.shape(sbw, 0, canvas.width - sbw, HD.height, C.surface);
  b.text(x0, 4, 900, 36, page.title, { size: '18pt', color: C.ink, bold: true });
  if (page.headline && page.headline.measure) b.card(x0, 40, W - 260, 26, page.headline.measure, { label: false, size: 10.5, bold: false, color: C.muted });
  else if (page.headline && page.headline.text) b.text(x0, 42, W - 260, 24, page.headline.text, { size: '10.5pt', color: C.muted });
  if (page.tag) b.text(canvas.width - canvas.padding - 260, 24, 260, 24, page.tag, { size: '9pt', color: C.subtle, align: 'right' });

  // Rows
  const rows = page.rows || [];
  const G = canvas.gutter;
  const fixed = rows.filter((r) => r.height !== 'fill').reduce((s, r) => s + r.height, 0) + G * Math.max(0, rows.length - 1);
  const fills = rows.filter((r) => r.height === 'fill').length;
  const fillH = fills ? (canvas.height - HD.height - 2 * canvas.padding - fixed) / fills : 0;
  if (fills && fillH < 120) throw new Error(`Page '${page.id}': rows overflow the canvas (fill height ${Math.round(fillH)}px)`);
  if (!fills && HD.height + 2 * canvas.padding + fixed > canvas.height) throw new Error(`Page '${page.id}': rows overflow the ${canvas.height}px canvas`);
  let y = HD.height + canvas.padding;
  for (const row of rows) {
    const h = row.height === 'fill' ? fillH : row.height;
    const spans = row.items.map((it) => it.span || 1);
    const total = spans.reduce((a, s) => a + s, 0);
    const avail = W - G * (row.items.length - 1);
    let x = x0;
    row.items.forEach((item, i) => {
      const w = i === row.items.length - 1 ? x0 + W - x : Math.round((avail * spans[i]) / total);
      renderItem(b, item, x, y, w, h);
      x += w + G;
    });
    y += h + G;
  }
  return out;
}

// ---------- page filters ----------
function pageFilters(page) {
  if (!page.filters || !page.filters.length) return undefined;
  return {
    filters: page.filters.map((f, i) => {
      const fld = parseField(f.field);
      const values = f.values.map((v) => [{ Literal: { Value: typeof v === 'number' ? (Number.isInteger(v) ? `${v}L` : `${v}D`) : `'${String(v).replace(/'/g, "''")}'` } }]);
      return {
        name: 'Filter' + stableId(page.id, 'filter', i, f.field).slice(0, 20) + stableId(page.id, f.field).slice(0, 4),
        field: columnExpr(f.field),
        type: 'Categorical',
        filter: { Version: 2, From: [{ Name: 'f', Entity: fld.table, Type: 0 }],
          Where: [{ Condition: { In: { Expressions: [{ Column: { Expression: { SourceRef: { Source: 'f' } }, Property: fld.column } }], Values: values } } }] },
        howCreated: 'User',
      };
    }),
  };
}

// ---------- write pages ----------
const pagesJsonPath = path.join(def, 'pages', 'pages.json');
const pagesMeta = readJson(pagesJsonPath);
const readPage = (id) => readJson(path.join(def, 'pages', id, 'page.json'));
const pageSchema = readPage(pagesMeta.pageOrder[0]).$schema;
const isEmpty = (id) => { const d = path.join(def, 'pages', id, 'visuals'); return !fs.existsSync(d) || fs.readdirSync(d).length === 0; };
const claimed = new Set();
const results = [];

for (const page of state.pages || []) {
  if (args.page && page.id !== args.page) continue;
  // Resolve: explicit pbiName → same displayName → an empty unclaimed page → new page
  let id = page.pbiName && pagesMeta.pageOrder.includes(page.pbiName) ? page.pbiName : null;
  if (!id) id = pagesMeta.pageOrder.find((p) => !claimed.has(p) && readPage(p).displayName === page.title) || null;
  if (!id) id = pagesMeta.pageOrder.find((p) => !claimed.has(p) && isEmpty(p) && !(state.pages || []).some((sp) => sp.title === readPage(p).displayName)) || null;
  if (!id) {
    id = stableId(state.project, 'page', page.id);
    fs.mkdirSync(path.join(def, 'pages', id), { recursive: true });
    fs.writeFileSync(path.join(def, 'pages', id, 'page.json'), JSON.stringify({ $schema: pageSchema, name: id, displayName: page.title, displayOption: 'FitToPage', height: canvas.height, width: canvas.width }, null, 2));
    pagesMeta.pageOrder.push(id);
  }
  claimed.add(id);
  const pj = readPage(id);
  pj.displayName = page.title;
  pj.width = canvas.width; pj.height = canvas.height;
  const fc = pageFilters(page);
  if (fc) pj.filterConfig = fc; else delete pj.filterConfig;
  // Page canvas + wallpaper color set on the page itself: Desktop does not always apply the theme's page background.
  if (ds.colors && ds.colors.page) {
    pj.objects = Object.assign({}, pj.objects, {
      background: plain({ color: color(C.page), transparency: num(0) }),
      outspace: plain({ color: color(C.pageFrame || C.page), transparency: num(0) }),
    });
  }
  fs.writeFileSync(path.join(def, 'pages', id, 'page.json'), JSON.stringify(pj, null, 2));

  const visuals = renderPage(page);
  const vdir = path.join(def, 'pages', id, 'visuals');
  fs.rmSync(vdir, { recursive: true, force: true });
  for (const v of visuals) {
    fs.mkdirSync(path.join(vdir, v.name), { recursive: true });
    fs.writeFileSync(path.join(vdir, v.name, 'visual.json'), JSON.stringify(v, null, 2));
  }
  results.push({ page: page.id, pbiName: id, visuals: visuals.length });
}
// Keep state.json page order in the report
const ordered = results.map((r) => r.pbiName);
pagesMeta.pageOrder = [...ordered, ...pagesMeta.pageOrder.filter((p) => !ordered.includes(p))];
if (!pagesMeta.pageOrder.includes(pagesMeta.activePageName)) pagesMeta.activePageName = pagesMeta.pageOrder[0];
fs.writeFileSync(pagesJsonPath, JSON.stringify(pagesMeta, null, 2));

// ---------- theme (cache-busting name, registered as RegisteredResources) ----------
let themeFile = null;
const themeSrc = args.theme || ds.theme;
if (themeSrc) {
  const src = [path.resolve(themeSrc), path.resolve(path.dirname(statePath), themeSrc)].find((p) => fs.existsSync(p));
  if (!src) throw new Error(`Theme not found: ${themeSrc}`);
  const base = (ds.themeName || path.basename(src, '.json')).replace(/[^A-Za-z0-9]+/g, '');
  const regDir = path.join(reportDir, 'StaticResources', 'RegisteredResources');
  fs.mkdirSync(regDir, { recursive: true });
  // Name = content hash: changes only when the theme changes (still busts Desktop's theme cache).
  const theme = readJson(src);
  themeFile = `${base}-${crypto.createHash('sha1').update(JSON.stringify(theme)).digest('hex').slice(0, 8)}.json`;
  for (const f of fs.readdirSync(regDir)) if (f.startsWith(`${base}-`) && f.endsWith('.json') && f !== themeFile) fs.rmSync(path.join(regDir, f));
  theme.name = themeFile; // must equal report.json registration, including .json
  fs.writeFileSync(path.join(regDir, themeFile), JSON.stringify(theme, null, 2));
  const reportJsonPath = path.join(def, 'report.json');
  const report = readJson(reportJsonPath);
  report.themeCollection.customTheme = { name: themeFile, reportVersionAtImport: report.themeCollection.baseTheme.reportVersionAtImport, type: 'RegisteredResources' };
  report.resourcePackages = (report.resourcePackages || []).filter((p) => p.type !== 'RegisteredResources');
  report.resourcePackages.push({ name: 'RegisteredResources', type: 'RegisteredResources', items: [{ name: themeFile, path: themeFile, type: 'CustomTheme' }] });
  fs.writeFileSync(reportJsonPath, JSON.stringify(report, null, 2));
}

// ---------- $schema on Desktop-saved shell files (Fabric requires it) ----------
const addSchema = (file, url) => {
  if (!fs.existsSync(file)) return;
  const j = readJson(file);
  if (!j.$schema) fs.writeFileSync(file, JSON.stringify({ $schema: url, ...j }, null, 2));
};
addSchema(path.join(reportDir, 'definition.pbir'), 'https://developer.microsoft.com/json-schemas/fabric/item/report/definitionProperties/2.0.0/schema.json');
addSchema(path.join(path.dirname(reportDir), path.basename(reportDir).replace(/\.Report$/, '') + '.pbip'), 'https://developer.microsoft.com/json-schemas/fabric/pbip/pbipProperties/1.0.0/schema.json');

// ---------- measure check against TMDL ----------
const warnings = missingTokens.length ? [`designSystem.colors missing (neutral fallback used): ${missingTokens.join(', ')}`] : [];
const smDir = path.join(path.dirname(reportDir), path.basename(reportDir).replace(/\.Report$/, '.SemanticModel'), 'definition', 'tables');
if (fs.existsSync(smDir)) {
  const tmdl = fs.readdirSync(smDir).map((f) => fs.readFileSync(path.join(smDir, f), 'utf8')).join('\n');
  const defined = new Set([...tmdl.matchAll(/^\s*measure\s+(?:'((?:[^']|'')+)'|([^\s=]+))\s*=/gm)].map((m) => (m[1] || m[2]).replace(/''/g, "'")));
  for (const m of usedMeasures) if (!defined.has(m)) warnings.push(`Measure not found in TMDL: ${m}`);
} else {
  warnings.push('No sibling .SemanticModel/definition/tables found; measures not checked.');
}

console.log(JSON.stringify({ ok: true, pages: results, theme: themeFile, warnings }, null, 2));
