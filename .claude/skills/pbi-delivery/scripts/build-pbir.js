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
  // 'Table[Column]' sorts by a column; a bare name sorts by that measure.
  sort: [{ field: /\[.+\]$/.test(sort.field) ? columnExpr(sort.field) : measureExpr(sort.field), direction: sort.direction || 'Ascending' }],
  isDefaultSort: true,
};

// Deterministic ids: regenerating an unchanged state.json produces identical files (clean git diffs).
const stableId = (...parts) => crypto.createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 20);

// ---------- visual builders (each pushes into `out`) ----------
function builder(out, pageId) {
  let z = 0;
  // `extra` = container-level properties next to `visual` (e.g. a visual-level filterConfig).
  const add = (x, y, w, h, visual, extra) => {
    z += 1000;
    out.push({ $schema: VSCHEMA, name: stableId(pageId, z, visual.visualType),
      position: { x: Math.round(x), y: Math.round(y), z, height: Math.round(h), width: Math.round(w), tabOrder: z }, visual, ...(extra || {}) });
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
  // o: size, bold, color | colorMeasure, label (false = none), labelColor, labelBelow, align ('left'|'center'|'right'), font.
  const card = (x, y, w, h, measure, o = {}) => add(x, y, w, h, {
    visualType: 'cardVisual',
    query: { queryState: { Data: { projections: [mProj(measure)] } } },
    objects: {
      value: def0({
        fontSize: num(o.size || 21), bold: bool(o.bold !== false), fontFamily: str(o.font || FONT),
        horizontalAlignment: str(o.align || 'left'), labelDisplayUnits: str('1'),
        fontColor: o.colorMeasure ? colorFromMeasure(o.colorMeasure) : color(o.color || C.ink),
      }),
      label: def0(o.label === false ? { show: bool(false) }
        : { show: bool(true), text: str(o.label || measure), position: str(o.labelBelow ? 'belowValue' : 'aboveValue'), fontSize: num(o.labelSize || 9), fontColor: color(o.labelColor || C.muted), horizontalAlignment: str(o.align || 'left') }),
      // Transparent card body: the default fill is white, which hides light text on a dark tile.
      fillCustom: def0({ show: bool(true), fillColor: color(C.surface), transparency: num(100) }),
      outline: def0({ show: bool(false) }),
      padding: def0({ paddingUniform: num(0) }),
      layout: def0({ paddingUniform: num(0), alignment: str(o.align || 'left') }),
    },
    visualContainerObjects: noChrome(),
  }, o.extra);
  // Dropdown slicer (page header). Field = 'Table[Column]'. The label is a textbox above it:
  // the slicer's own header needs 76px of height, more than a page header has.
  const slicer = (x, y, w, h, field, label) => {
    if (label) text(x, y, w, 18, label, { size: '8pt', color: C.muted });
    add(x, y + (label ? 18 : 0), w, h - (label ? 18 : 0), {
      visualType: 'slicer',
      query: { queryState: { Values: { projections: [Object.assign(cProj(field), { active: true })] } } },
      objects: {
        data: plain({ mode: str('Dropdown') }),
        header: plain({ show: bool(false) }),
        items: plain({ fontColor: color(C.ink), textSize: num(10), fontFamily: str(FONT) }),
      },
      visualContainerObjects: noChrome(),
    });
  };
  return { add, shape, text, card, slicer };
}

// Categorical filter: field IN values (page-level filterConfig or visual-level, e.g. one ring per value).
const literal = (v) => ({ Literal: { Value: typeof v === 'number' ? (Number.isInteger(v) ? `${v}L` : `${v}D`) : `'${String(v).replace(/'/g, "''")}'` } });
const inFilter = (name, field, values) => {
  const fld = parseField(field);
  return {
    name, field: columnExpr(field), type: 'Categorical',
    filter: { Version: 2, From: [{ Name: 'f', Entity: fld.table, Type: 0 }],
      Where: [{ Condition: { In: { Expressions: [{ Column: { Expression: { SourceRef: { Source: 'f' } }, Property: fld.column } }], Values: values.map((v) => [literal(v)]) } } }] },
    howCreated: 'User',
  };
};
// Fill per category/series value: { "<value>": "#hex" } on the given field.
const valueColors = (field, colors) => Object.entries(colors || {}).map(([v, hex]) => ({
  properties: { fill: color(hex) },
  selector: { data: [{ scopeId: { Comparison: { ComparisonKind: 0, Left: columnExpr(field), Right: literal(v) } } }] },
}));

// ---------- item renderers ----------
// Card title row: bold title on the left, optional `meta` (period / note) on the right.
function head(b, item, x, y, w, title, o = {}) {
  const metaW = item.meta ? Math.min(Math.max(70, item.meta.length * 7 + 10), Math.round(w * 0.4)) : 0;
  if (title) b.text(x + 20, y + 14, w - 40 - metaW, 30, title, { size: '12pt', color: o.color || C.ink, bold: true });
  if (item.meta) b.text(x + w - 20 - metaW, y + 19, metaW, 24, item.meta, { size: '9pt', color: o.metaColor || C.muted, align: 'right' });
}
// Perceived lightness of a hex color (0 = black, 1 = white): picks readable text on a fill.
const isLight = (hex) => { const n = parseInt(String(hex).replace('#', '').slice(0, 6), 16); return ((n >> 16) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114) / 255 > 0.6; };
// Top N rows of `field` ranked by SUM(column) — a visual-level TopN filter. The rank must be an
// aggregation of a column: Desktop rejects a measure reference in the TopN subquery.
const topNFilter = (name, field, n, by) => {
  const f = parseField(field); const m = parseField(by);
  return {
    name, field: columnExpr(field), type: 'TopN',
    filter: { Version: 2, From: [
      { Name: 'subquery', Type: 2, Expression: { Subquery: { Query: { Version: 2,
        From: [{ Name: 'f', Entity: f.table, Type: 0 }],
        Select: [{ Column: { Expression: { SourceRef: { Source: 'f' } }, Property: f.column }, Name: 'field' }],
        OrderBy: [{ Direction: 2, Expression: { Aggregation: { Expression: { Column: { Expression: { SourceRef: { Source: 'f' } }, Property: m.column } }, Function: 0 } } }],
        Top: n } } } },
      { Name: 't', Entity: f.table, Type: 0 }],
    Where: [{ Condition: { In: { Expressions: [{ Column: { Expression: { SourceRef: { Source: 't' } }, Property: f.column } }], Table: { SourceRef: { Source: 'subquery' } } } } }] },
    howCreated: 'User',
  };
};

function renderItem(b, item, x, y, w, h) {
  const tile = () => b.shape(x, y, w, h, C.surface, { rounded: canvas.radius, outline: C.border, shadow: true });
  const ref = (measure, status, ry) => measure && b.card(x + 24, ry || y + h - 44, w - 48, 24, measure,
    { label: false, size: 9, bold: false, ...(status ? { colorMeasure: status } : { color: C.muted }) });

  switch (item.type) {
    case 'kpi': {
      tile();
      head(b, item, x, y, w, item.label);
      // Value in the vertical middle of the tile, reference right under it (mockup layout).
      const sp = item.sparkline;
      const cw = sp ? Math.round((w - 48) * 0.55) : w - 48;
      const vy = Math.round(y + h / 2 - 28);
      b.card(x + 24, vy, cw, 44, item.measure, { label: false, size: item.size || 26, ...(item.valueStatus ? { colorMeasure: item.valueStatus } : {}) });
      ref(item.reference, item.status, vy + 46);
      // Optional sparkline: a bare area chart of the same measure on the right part of the tile.
      if (sp) {
        const sx = x + 24 + cw + 8; const sw = x + w - 24 - sx;
        b.add(sx, vy - 24, sw, 92, {
          visualType: 'areaChart',
          query: { queryState: { Category: { projections: [cProj(sp.category)] }, Y: { projections: [mProj(item.measure)] } },
            sortDefinition: sortDef({ field: sp.category, direction: 'Ascending' }) },
          objects: {
            categoryAxis: plain({ show: bool(false) }), valueAxis: plain({ show: bool(false) }),
            legend: plain({ show: bool(false) }), labels: plain({ show: bool(false) }),
            dataPoint: [{ properties: { fill: color(sp.color || C.accent) }, selector: { metadata: `${MT}.${item.measure}` } }],
            lineStyles: plain({ lineChartType: str('smooth'), strokeWidth: num(2), showMarker: bool(false) }),
          },
          visualContainerObjects: Object.assign(noChrome(), { padding: plain({ top: num(0), bottom: num(0), left: num(0), right: num(0) }) }),
        });
      }
      return;
    }
    case 'kpiGroup': {
      // panel: a white tile with a dark top band (band[] = text measures, left and right) over a
      // soft body that holds the items in a `columns` grid (highlighted record, e.g. "top item").
      if (item.panel) {
        const P = item.panel; tile(); head(b, item, x, y, w, item.label);
        const px = x + 22; const pw = w - 44; const py = y + 58; const ph = h - 58 - 22; const bandH = 42;
        b.shape(px, py, pw, ph, P.bodyFill || C.border, { rounded: 12 });
        b.shape(px, py, pw, bandH + 12, P.fill || C.ink, { rounded: 12 });
        b.shape(px, py + bandH, pw, 12, P.bodyFill || C.border); // square off the band's lower corners
        const bandInk = P.text || (isLight(P.fill || C.ink) ? C.ink : C.onAccent);
        // Band: first text gets 70% (long names), the second is right-aligned in the rest.
        const bw = pw - 36; const b1 = Math.round(bw * 0.7);
        (P.band || []).slice(0, 2).forEach((m, i) => b.card(i ? px + 18 + b1 : px + 18, py + 11, i ? bw - b1 : b1, 22, m,
          { label: false, size: 10.5, color: bandInk, align: i ? 'right' : 'left' }));
        // Columns: the first one is wider (P.split, default 0.55) so big values and ids are not truncated.
        const cols = item.columns || 2; const iw = pw - 36;
        const colW = cols > 1 ? [iw * (P.split || 0.55), ...Array(cols - 1).fill(iw * (1 - (P.split || 0.55)) / (cols - 1))] : [iw];
        const colX = colW.map((_, c) => colW.slice(0, c).reduce((a, v) => a + v, 0));
        const rows = Math.ceil(item.items.length / cols); const top = py + bandH + 14; const rh = (py + ph - 12 - top) / rows;
        item.items.forEach((k, i) => {
          const c = i % cols; const r = Math.floor(i / cols); const cw = colW[c];
          b.card(px + 18 + colX[c], top + r * rh, cw - 4, rh, k.measure, { label: k.label === undefined ? false : k.label, labelColor: C.ink,
            labelSize: 9, size: k.size || 12, color: C.ink, bold: k.bold !== false, align: c === cols - 1 && cols > 1 ? 'right' : 'left', ...(k.font ? { font: k.font } : {}) });
        });
        return;
      }
      // Optional: label (title on top), fill + textColor (highlight tile), columns (grid instead of one row).
      if (item.fill) b.shape(x, y, w, h, item.fill, { rounded: canvas.radius, shadow: true }); else tile();
      const ink = item.textColor || C.ink; const sub = item.textColor ? item.textColor : C.muted;
      let top = y + 20;
      if (item.label) { b.text(x + 20, y + 12, w - 40, 30, item.label, { size: '12pt', color: ink, bold: true }); top = y + 52; }
      const n = item.items.length; const cols = item.columns || n; const cw = (w - 48) / cols;
      const rh = Math.min(72, (y + h - 20 - (item.reference ? 28 : 0) - top) / Math.ceil(n / cols));
      item.items.forEach((k, i) => b.card(x + 24 + (i % cols) * cw, top + Math.floor(i / cols) * rh, cw - 8, rh, k.measure,
        { label: k.label, labelColor: sub, size: k.size || (rh < 60 ? 14 : 21), color: ink, ...(k.status ? { colorMeasure: k.status } : {}) }));
      ref(item.reference, item.status);
      return;
    }
    case 'rings': {
      // One gauge per category value (substitute for progress rings): item.values lists the values in order.
      if (!item.values || !item.values.length) throw new Error(`rings '${item.title}': 'values' (category values in order) is required`);
      tile();
      head(b, item, x, y, w, item.title || '');
      const n = item.values.length; const gw = (w - 48) / n; const footH = item.footer ? 40 : 0;
      const cols = item.colors || [];
      // Filter names must be unique across the report: one per (value, visual role).
      const filt = (v, role = '') => ({ filterConfig: { filters: [inFilter('Filter' + stableId(item.title, item.category, v, role).slice(0, 20), item.category, [v])] } });
      // style 'ring': one donut per value over ALL values of the category, that value colored and the
      // others in the track color → a progress ring of its share; value in the hole, caption + name below.
      if (item.style === 'ring') {
        const capH = item.caption ? 22 : 0;
        const d = Math.min(gw - 24, h - 60 - capH - 26 - footH - 16); const ry = y + 60;
        item.values.forEach((v, i) => {
          const gx = x + 24 + i * gw; const cx = gx + gw / 2; const fill = cols[i % cols.length] || C.accent;
          const ringColors = Object.fromEntries(item.values.map((o) => [o, o === v ? fill : (item.track || C.border)]));
          b.add(cx - d / 2, ry, d, d, {
            visualType: 'donutChart',
            query: { queryState: { Category: { projections: [cProj(item.category)] }, Y: { projections: [mProj(item.measure)] } },
              ...(item.order ? { sortDefinition: sortDef({ field: item.order, direction: 'Ascending' }) } : {}) },
            objects: {
              dataPoint: valueColors(item.category, ringColors),
              legend: plain({ show: bool(false) }), labels: plain({ show: bool(false) }),
              slices: plain({ innerRadiusRatio: num(item.innerRadius || 82) }),
              centerValue: plain({ show: bool(false) }), // newer Desktop prints the total in the hole
            },
            visualContainerObjects: noChrome(),
          });
          b.card(cx - d / 2 + 6, ry + d / 2 - 14, d - 12, 28, item.measure, { label: false, size: 13, align: 'center', extra: filt(v, 'value') });
          if (item.caption) b.card(gx, ry + d + 6, gw, capH, item.caption, { label: false, size: 9.5, bold: false, color: C.muted, align: 'center', extra: filt(v, 'caption') });
          b.text(gx, ry + d + 6 + capH, gw, 26, String(v), { size: '11pt', color: C.ink, bold: true, align: 'center' });
        });
        if (item.footer) b.card(x + 24, y + h - 12 - footH, w - 48, footH, item.footer, { label: false, size: 10, bold: false, color: C.muted, align: 'center' });
        return;
      }
      const gy = y + 52; const gh = h - 52 - 34 - footH - 12;
      item.values.forEach((v, i) => {
        const gx = x + 24 + i * gw;
        b.add(gx, gy, gw - 8, gh, {
          visualType: 'gauge',
          query: { queryState: { Y: { projections: [mProj(item.measure)] } } },
          objects: {
            axis: plain({ min: num(0), max: num(item.max || 1) }),
            dataPoint: plain({ fill: color(cols[i % cols.length] || C.accent), target: color(C.border) }),
            labels: plain({ show: bool(false) }),
            calloutValue: plain({ show: bool(true), color: color(C.ink), fontFamily: str(FONT) }),
          },
          visualContainerObjects: noChrome(),
        }, { filterConfig: { filters: [inFilter('Filter' + stableId(item.title, item.category, v).slice(0, 20), item.category, [v])] } });
        b.text(gx, gy + gh + 2, gw - 8, 28, String(v), { size: '10pt', color: C.muted, align: 'center' });
      });
      if (item.footer) b.card(x + 24, y + h - 12 - footH, w - 48, footH, item.footer, { label: false, size: 10, bold: false, color: C.muted });
      return;
    }
    case 'chart': {
      const visualType = item.visual || 'columnChart';
      const isCombo = visualType === 'lineClusteredColumnComboChart';
      const series = item.series || [];
      const lines = item.lines || [];
      const isPie = /^(donut|pie)Chart$/.test(visualType);
      const queryState = { Category: { projections: [cProj(item.category)] }, Y: { projections: series.map((s) => mProj(s.measure, s.label)) } };
      if (isCombo && lines.length) queryState.Y2 = { projections: lines.map((s) => mProj(s.measure, s.label)) };
      // seriesBy: split one measure by a column (legend); colors: { "<value>": "#hex" } on the seriesBy (else category) column.
      if (item.seriesBy) queryState.Series = { projections: [cProj(item.seriesBy)] };
      const byValue = valueColors(item.seriesBy || item.category, item.colors);
      // legendItems [{label, measure, color}]: donut on the left with value + centerCaption in the hole,
      // a hand-drawn legend on the right (dot · name · share measure), like a custom HTML legend.
      if (isPie && item.legendItems) {
        tile(); head(b, item, x, y, w, item.title);
        const d = Math.min(h - 80, Math.round(w * 0.44)); const dx = x + 24; const dy = y + 56 + (h - 56 - 16 - d) / 2;
        b.add(dx, dy, d, d, {
          visualType, query: { queryState },
          objects: { dataPoint: byValue, legend: plain({ show: bool(false) }), labels: plain({ show: bool(false) }),
            slices: plain({ innerRadiusRatio: num(item.innerRadius || 72) }), centerValue: plain({ show: bool(false) }) },
          visualContainerObjects: noChrome(),
        });
        if (item.center) {
          b.card(dx + d * 0.15, dy + d / 2 - (item.centerCaption ? 24 : 14), d * 0.7, 30, item.center, { label: false, size: item.centerSize || 16, align: 'center' });
          if (item.centerCaption) b.text(dx + d * 0.15, dy + d / 2 + 6, d * 0.7, 22, item.centerCaption, { size: '9pt', color: C.muted, align: 'center' });
        }
        const lx = dx + d + 24; const lw = x + w - 20 - lx; const lh = 30;
        const ly = dy + d / 2 - (item.legendItems.length * lh) / 2;
        item.legendItems.forEach((li, i) => {
          const yy = ly + i * lh;
          b.shape(lx, yy + 9, 10, 10, li.color || C.accent, { rounded: 5 });
          const nw = Math.min(48, lw * 0.4);
          b.text(lx + 14, yy + 2, nw, 26, li.label, { size: '10pt', color: C.muted });
          if (li.measure) b.card(lx + 10 + nw, yy + 4, lw - 10 - nw, 22, li.measure, { label: false, size: 10, bold: false, color: C.muted });
        });
        return;
      }
      if (isPie) {
        const objects = {
          dataPoint: byValue,
          legend: plain({ show: bool(item.legend !== false), position: str(item.legendPosition || 'Right') }),
          labels: plain({ show: bool(!!item.labels), ...(item.labels ? { labelStyle: str(item.labels) } : {}) }),
        };
        const query = { queryState };
        b.add(x, y, w, h, { visualType, query, objects, visualContainerObjects: chartChrome(item, true) });
        if (item.title) b.text(x + 20, y + 12, w - 40, 30, item.title, { size: '12pt', color: C.ink, bold: true });
        // Value in the hole: centred on the plot area (legend on the right takes ~35% of the width).
        if (item.center) {
          const legendW = item.legend !== false ? w * 0.35 : 0;
          const pw = w - 48 - legendW; const cx = x + 24 + pw / 2; const cy = y + 44 + (h - 60) / 2;
          b.card(cx - 60, cy - 16, 120, 32, item.center, { label: false, size: 14 });
        }
        return;
      }
      const objects = {
        dataPoint: [...[...series, ...lines].filter((s) => s.color).map((s) => ({ properties: { fill: color(s.color) }, selector: { metadata: `${MT}.${s.measure}` } })), ...byValue],
        // A card with `meta` keeps the top-right for it: the legend then goes top-left, under the title.
        legend: plain({ show: bool(item.legend !== false && (series.length + lines.length > 1 || !!item.seriesBy)), position: str(item.legendPosition || (item.meta ? 'Top' : 'TopRight')) }),
        // dataLabels: value at the bar end. Split by seriesBy (stacked) → the stack total label instead.
        ...(item.dataLabels && !item.seriesBy ? { labels: plain({ show: bool(true), color: color(C.ink), fontSize: num(9), labelPosition: str('OutsideEnd') }) } : {}),
        ...(item.dataLabels && item.seriesBy ? { labels: plain({ show: bool(false) }), totals: plain({ show: bool(true), color: color(C.ink), fontSize: num(9) }) } : {}),
        // Categorical axis = one label per category (every day / every STAKE) and no vertical gridlines.
        categoryAxis: plain({ showAxisTitle: bool(false), gridlineShow: bool(false),
          ...(item.axisFontSize ? { fontSize: num(item.axisFontSize) } : {}),
          ...(item.axisType ? { axisType: str(item.axisType) } : {}),
          ...(item.axisType === 'Categorical' ? { preferredCategoryWidth: num(item.categoryWidth || 20), concatenateLabels: bool(false) } : {}) }),
        valueAxis: plain({ ...(item.valueAxis === false ? { show: bool(false) } : {}), showAxisTitle: bool(false), gridlineShow: bool(item.valueAxis !== false), labelDisplayUnits: num(1),
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
      const chrome = chartChrome(item, overlay);
      // Title row above the plot (title + meta); the legend, if any, sits top-left under it.
      if (item.meta) chrome.padding = plain({ top: num(48), bottom: num(16), left: num(20), right: num(24) });
      b.add(x, y, w, h, { visualType, query, objects, visualContainerObjects: chrome });
      if (item.meta) { if (item.titleMeasure) b.card(x + 24, y + 14, w * 0.6, 28, item.titleMeasure, { label: false, size: 12 }); head(b, item, x, y, w, item.titleMeasure ? '' : item.title); return; }
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
      // columns[].width (px): fixed widths so the table fits its tile (long text wraps instead of scrolling).
      const widths = item.columns.map((c, i) => c.width && { properties: { value: num(c.width) }, selector: { metadata: projections[i].queryRef } }).filter(Boolean);
      const query = { queryState: { Values: { projections } } };
      if (item.sort) query.sortDefinition = sortDef(item.sort);
      // topN + topBy ('Table[Column]' summed): keep only the N largest values of the first column.
      const first = item.columns.find((c) => c.field);
      const extra = item.topN && item.topBy && first
        ? { filterConfig: { filters: [topNFilter('Filter' + stableId(item.title, 'topN').slice(0, 20), first.field, item.topN, item.topBy)] } } : undefined;
      const chrome = chartChrome(item, !!item.meta);
      if (item.meta) chrome.padding = plain({ top: num(52), bottom: num(12), left: num(20), right: num(20) });
      b.add(x, y, w, h, {
        visualType: 'tableEx', query,
        objects: {
          columnHeaders: plain({ ...(widths.length ? { autoSizeColumnWidth: bool(false), customColumnWidth: bool(true) } : { columnAdjustment: str('growToFit'), autoSizeColumnWidth: bool(true) }), fontColor: color(C.muted), wordWrap: bool(false) }),
          ...(widths.length ? { columnWidth: widths } : {}),
          values: plain({ wordWrap: bool(widths.length > 0), fontColorPrimary: color(C.ink), fontColorSecondary: color(C.ink), backColorPrimary: color(C.surface), backColorSecondary: color(C.surface) }),
          grid: plain({ gridHorizontal: bool(true), gridHorizontalColor: color(C.border), gridVertical: bool(false), rowPadding: num(item.rowPadding || 6), textSize: num(item.fontSize || 9) }),
          total: plain({ totals: bool(!!item.totals) }),
        },
        visualContainerObjects: chrome,
      }, extra);
      if (item.meta) head(b, item, x, y, w, item.title);
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
    // Brand: optional logo tile (one letter on the accent) + wordmark, readable on a light or dark sidebar.
    const brandInk = isLight(C.sidebar) ? C.ink : C.onAccent;
    const bx = SB.logo ? 72 : 24;
    if (SB.logo) { b.shape(32, 22, 32, 32, C.accent, { rounded: 8 }); b.text(32, 24, 32, 28, SB.logo, { size: '12pt', color: C.onAccent, bold: true, align: 'center' }); }
    if (SB.brand) b.text(bx, 20, sbw - bx - 16, 34, SB.brand, { size: '15pt', color: brandInk, bold: true });
    if (SB.subtitle) b.text(24, 52, sbw - 40, 20, SB.subtitle, { size: '9pt', color: C.sidebarText });
    if (SB.section) b.text(24, 104, sbw - 40, 18, SB.section, { size: '8.25pt', color: C.sidebarSection, bold: true });
    const active = page.navLabel || page.title;
    (SB.items || []).forEach((label, i) => {
      const y = (SB.navTop || 128) + i * 48; const on = label === active;
      if (on) b.shape(20, y, sbw - 40, 46, SB.activeFill || C.accent, { rounded: 8 });
      b.text(36, y + 12, sbw - 64, 24, label, { size: '10.5pt', color: on ? C.onAccent : C.sidebarText, bold: on });
    });
  }
  // Header
  const x0 = sbw + canvas.padding;
  const W = canvas.width - sbw - 2 * canvas.padding;
  // Header band: shell.header.fill ('page' = no band, the title sits on the page background).
  if (HD.fill !== 'page') b.shape(sbw, 0, canvas.width - sbw, HD.height, HD.fill || C.surface);
  b.text(x0, 4, 900, 36, page.title, { size: '18pt', color: C.ink, bold: true });
  // Header slicers (dropdowns), right-aligned before the tag.
  const slicers = page.slicers || [];
  const SLW = 170; const SLG = 12; const tagW = page.tag ? (slicers.length ? 140 : 260) : 0;
  const slRight = canvas.width - canvas.padding - tagW - (tagW ? SLG : 0);
  slicers.forEach((s, i) => b.slicer(slRight - (slicers.length - i) * (SLW + SLG) + SLG, 6, SLW, 18 + 48, s.field, s.label)); // label 18 + selector floor 48
  const headW = W - (slicers.length ? slicers.length * (SLW + SLG) + tagW + SLG : 260);
  if (page.headline && page.headline.measure) b.card(x0, 40, headW, 26, page.headline.measure, { label: false, size: 10.5, bold: false, color: C.muted });
  else if (page.headline && page.headline.text) b.text(x0, 42, headW, 24, page.headline.text, { size: '10.5pt', color: C.muted });
  if (page.tag) b.text(canvas.width - canvas.padding - tagW, 24, tagW, 24, page.tag, { size: '9pt', color: C.subtle, align: 'right' });

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
    filters: page.filters.map((f, i) => inFilter(
      'Filter' + stableId(page.id, 'filter', i, f.field).slice(0, 20) + stableId(page.id, f.field).slice(0, 4), f.field, f.values)),
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
