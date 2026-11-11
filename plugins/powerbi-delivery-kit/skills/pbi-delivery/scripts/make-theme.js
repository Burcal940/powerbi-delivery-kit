#!/usr/bin/env node
// pbi-delivery · make-theme.js
// Builds a Power BI report theme from design-tokens.json (output of extract-design.js).
// Usage: node make-theme.js --tokens <design-tokens.json> --name "<Theme Name>" --out <theme.json>
'use strict';
const fs = require('fs');
const path = require('path');

const a = {};
for (let i = 2; i < process.argv.length; i += 2) a[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
if (!a.tokens || !a.out) { console.error('Usage: node make-theme.js --tokens <design-tokens.json> --name "<Theme Name>" --out <theme.json>'); process.exit(2); }
const t = JSON.parse(fs.readFileSync(a.tokens, 'utf8').replace(/^﻿/, ''));
const c = Object.assign({
  ink: '#222222', muted: '#666666', subtle: '#999999', surface: '#FFFFFF', page: '#F5F5F5', border: '#E5E5E5',
  accent: '#0066CC', secondary: '#66AADD', good: '#1E8E3E', bad: '#D93025', warning: '#E37400',
}, t.colors || {});
const ty = t.typography || {};
const pt = (k, d) => (ty[k] && ty[k].pt) || d;
const font = (t.font && t.font.stack) || 'Segoe UI, sans-serif';
const radius = (t.layout && t.layout.radius) || 8;
const pad = (t.layout && t.layout.cardPadding) || 16;
const fill = (h) => ({ solid: { color: h } });
const dataColors = (t.dataColors && t.dataColors.length ? t.dataColors : [c.accent, c.secondary]).slice(0, 12);
while (dataColors.length < 8) dataColors.push([c.subtle, c.muted, c.border, c.ink][dataColors.length % 4]);

const theme = {
  name: a.name || 'Report Theme',
  dataColors,
  background: c.surface, secondaryBackground: c.page, foreground: c.ink,
  foregroundNeutralSecondary: c.muted, foregroundNeutralTertiary: c.subtle,
  backgroundLight: c.page, backgroundNeutral: c.border, tableAccent: c.accent,
  good: c.good, neutral: c.warning, bad: c.bad,
  maximum: c.accent, center: c.secondary, minimum: c.page,
  hyperlink: c.accent, visitedHyperlink: c.accent,
  textClasses: {
    callout: { fontSize: pt('kpi', 21), fontFace: font, color: c.ink },
    title: { fontSize: pt('cardTitle', 12), fontFace: font, color: c.ink },
    header: { fontSize: pt('body', 10.5), fontFace: font, color: c.ink },
    label: { fontSize: pt('label', 9), fontFace: font, color: c.muted },
  },
  visualStyles: {
    '*': {
      '*': {
        background: [{ show: true, color: fill(c.surface), transparency: 0 }],
        border: [{ show: true, color: fill(c.border), radius }],
        dropShadow: [{ show: false }],
        padding: [{ top: pad, bottom: pad, left: pad, right: pad }],
        title: [{ show: true, fontColor: fill(c.ink), fontSize: pt('cardTitle', 12), fontFamily: font, bold: true, alignment: 'left' }],
        subTitle: [{ fontColor: fill(c.muted), fontSize: pt('body', 10.5), fontFamily: font }],
        categoryAxis: [{ labelColor: fill(c.subtle), fontSize: pt('label', 9), gridlineColor: fill(c.border), showAxisTitle: false }],
        valueAxis: [{ labelColor: fill(c.subtle), fontSize: pt('label', 9), gridlineShow: true, gridlineColor: fill(c.border), gridlineStyle: 'solid', showAxisTitle: false }],
        legend: [{ show: true, position: 'TopRight', labelColor: fill(c.muted), fontSize: pt('label', 9), showTitle: false }],
        labels: [{ color: fill(c.muted), fontSize: pt('label', 9) }],
        visualTooltip: [{ background: fill(c.ink), titleFontColor: fill(c.subtle), valueFontColor: fill('#FFFFFF'), fontSize: pt('label', 9) }],
      },
    },
    page: { '*': {
      background: [{ color: fill(c.page), transparency: 0 }],
      outspace: [{ color: fill(c.page), transparency: 0 }],
    } },
    tableEx: { '*': {
      grid: [{ gridHorizontal: true, gridHorizontalColor: fill(c.border), gridVertical: false, rowPadding: 6 }],
      columnHeaders: [{ fontColor: fill(c.subtle), fontSize: pt('label', 9), backColor: fill(c.surface) }],
      values: [{ fontColorPrimary: fill(c.ink), fontSize: pt('body', 10.5), backColorPrimary: fill(c.surface), backColorSecondary: fill(c.surface) }],
      total: [{ fontColor: fill(c.ink), backColor: fill(c.page) }],
    } },
    pivotTable: { '*': {
      columnHeaders: [{ fontColor: fill(c.subtle), fontSize: pt('label', 9), backColor: fill(c.surface) }],
      rowHeaders: [{ fontColor: fill(c.ink), fontSize: pt('body', 10.5) }],
      values: [{ fontColorPrimary: fill(c.ink), fontSize: pt('body', 10.5) }],
      total: [{ fontColor: fill(c.ink), backColor: fill(c.page) }],
    } },
    slicer: { '*': {
      border: [{ show: true, color: fill(c.border), radius: Math.max(4, radius - 4) }],
      dropShadow: [{ show: false }],
    } },
    textbox: { '*': { background: [{ show: false }], border: [{ show: false }], padding: [{ top: 0, bottom: 0, left: 0, right: 0 }] } },
    image: { '*': { background: [{ show: false }], border: [{ show: false }] } },
    shape: { '*': { border: [{ show: false }], dropShadow: [{ show: false }] } },
  },
};
fs.mkdirSync(path.dirname(path.resolve(a.out)), { recursive: true });
fs.writeFileSync(a.out, JSON.stringify(theme, null, 2));
console.log(JSON.stringify({ ok: true, out: a.out, name: theme.name, dataColors: theme.dataColors.length }));
