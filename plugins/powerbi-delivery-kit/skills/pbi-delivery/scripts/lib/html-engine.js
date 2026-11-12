// pbi-delivery · lib/html-engine.js
// Measure engine for the interactive HTML. Runs the same in Node (build-html.js verification) and in
// the browser (inlined into the page). No dependencies.
//
//   const E = createEngine(cfg, data)
//   E.m(name, rows)        → value of a measure over a row set (null = BLANK, like DAX)
//   E.fmt(name|format, v)  → formatted text in cfg.locale
//   E.filter(rows, f)      → rows matching {field, values[]} or {field, min?, max?}
//   E.groupBy(field, rows) → [{ key, rows }] sorted by key
//
// Measure specs (state.model.measures[].calc):
//   { "agg": "count" | "sum" | "avg" | "min" | "max" | "distinct", "column"?: "T[C]", "where"?: { "T[C]": [values] } }
//   { "divide": ["A", "B"], "blankAsZero"?: true }      // DIVIDE(A (+0), B)
//   { "template": "Text {Measure} text" }               // {Measure} → formatted value
//   { "js": "(c) => ..." }                              // c.m c.fmt c.rows c.groupBy c.filter c.max c.min c.distinct c.locale
//                                                       // c.ctx (row of a disconnected table) c.statics c.unfiltered(table?)
(function (root) {
  'use strict';

  function createEngine(cfg, data) {
    const locale = cfg.locale || 'es-CO';
    const N = data.n;
    const cols = {};
    for (const k in data.cols) {
      const c = data.cols[k];
      cols[k] = c.dict ? Array.from(c.idx, (i) => (i < 0 ? null : c.dict[i])) : c.vals;
    }

    // ---- derived date dimension (same columns as the Dim Date partition) ----
    const proper = (s) => s.charAt(0).toUpperCase() + s.slice(1);
    const MON = Array.from({ length: 12 }, (_, i) => proper(new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }).format(Date.UTC(2000, i, 1)).replace('.', '')));
    const PART = {
      Date: (d) => d.slice(0, 10),
      Year: (d) => +d.slice(0, 4),
      Quarter: (d) => 'T' + Math.ceil(+d.slice(5, 7) / 3),
      'Month Number': (d) => +d.slice(5, 7),
      Month: (d) => MON[+d.slice(5, 7) - 1],
      'Year Month': (d) => +d.slice(0, 4) * 100 + +d.slice(5, 7),
      'Month Year': (d) => MON[+d.slice(5, 7) - 1] + ' ' + d.slice(0, 4),
    };
    // Text date parts sort in calendar order (their sortByColumn in the model).
    const SORT_PART = { Month: 'Month Number', 'Month Year': 'Year Month', Quarter: 'Month Number' };
    const sortKey = {};
    for (const k in cfg.derived || {}) {
      const d = cfg.derived[k]; const src = cols[d.from]; const f = PART[d.part];
      if (!src || !f) throw new Error('Cannot derive ' + k);
      cols[k] = src.map((v) => (v == null ? null : f(String(v))));
      const sp = SORT_PART[d.part];
      if (sp) { const g = PART[sp]; sortKey[k] = src.map((v) => (v == null ? null : g(String(v)))); }
    }
    // Disconnected tables (cfg.statics = { "Table": [ {col: value, ...}, ... ] }): their rows do not filter
    // the fact; a chart on one of their columns evaluates each measure with that row as context (c.ctx).
    const statics = cfg.statics || {};
    const tableOf = (field) => field.replace(/\[.*$/, '');
    const isStatic = (field) => !!statics[tableOf(field)];

    const col = (k) => { const c = cols[k]; if (!c) throw new Error('Column not embedded: ' + k); return c; };
    const all = Array.from({ length: N }, (_, i) => i);

    function filter(rows, f) {
      const c = col(f.field);
      if (f.values) { const s = new Set(f.values.map((v) => (v == null ? null : v))); return rows.filter((i) => s.has(c[i])); }
      return rows.filter((i) => c[i] != null && (f.min == null || c[i] >= f.min) && (f.max == null || c[i] <= f.max));
    }
    const cmp = (a, b) => (a == null ? -1 : b == null ? 1 : typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), locale));
    function groupBy(field, rows) {
      if (isStatic(field)) { // one group per static row, all fact rows, row as context (order as listed)
        const c = field.match(/\[(.*)\]$/)[1];
        return statics[tableOf(field)].map((r) => ({ key: r[c], rows, ctx: r }));
      }
      let memo = gcache.get(rows); if (!memo) gcache.set(rows, (memo = {}));
      if (memo[field]) return memo[field];
      const c = col(field); const g = new Map(); const sk = sortKey[field]; const ord = new Map();
      for (const i of rows) { const k = c[i]; if (!g.has(k)) { g.set(k, []); if (sk) ord.set(k, sk[i]); } g.get(k).push(i); }
      return (memo[field] = [...g.entries()].sort((a, b) => (sk ? cmp(ord.get(a[0]), ord.get(b[0])) : cmp(a[0], b[0]))).map(([key, r]) => ({ key, rows: r })));
    }
    const gcache = new WeakMap(); // groupBy results per row set (row sets are never mutated)
    const distinct = (field, rows) => groupBy(field, rows).map((g) => g.key);
    const nums = (field, rows) => { const c = col(field); return rows.map((i) => c[i]).filter((v) => v != null); };
    const max = (field, rows) => { const v = nums(field, rows); return v.length ? v.reduce((a, b) => (cmp(a, b) > 0 ? a : b)) : null; };
    const min = (field, rows) => { const v = nums(field, rows); return v.length ? v.reduce((a, b) => (cmp(a, b) < 0 ? a : b)) : null; };

    // ---- formatting ----
    const NF = {};
    const nf = (o) => NF[JSON.stringify(o)] || (NF[JSON.stringify(o)] = new Intl.NumberFormat(locale, o));
    const decimals = (code) => { const m = code.match(/\.(0+)/); return m ? m[1].length : 0; };
    function formatNumber(v, code) {
      if (/%/.test(code)) return nf({ style: 'percent', minimumFractionDigits: decimals(code), maximumFractionDigits: decimals(code) }).format(v);
      const d = decimals(code);
      const cur = (code.match(/^[^#0]*?([$€£])/) || [])[1];
      const s = nf({ minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: /,/.test(code) }).format(Math.abs(v));
      return (v < 0 ? '-' : '') + (cur ? cur + (/^en/.test(locale) ? '' : ' ') : '') + s;
    }
    // Power BI column/measure format strings: literals (\x, "text"), numbers (0, #,##0, 0.0, %), dates (d dd mmm mmmm yy yyyy).
    function formatCode(v, code) {
      if (v == null) return '';
      if (!code || code === '@' || code === 'General') return String(v);
      const isDate = typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v);
      let out = ''; let num = '';
      const flush = () => { if (num) { out += isDate ? num : formatNumber(+v, num); num = ''; } };
      for (let i = 0; i < code.length; i++) {
        const ch = code[i];
        if (ch === '\\') { flush(); out += code[++i] || ''; continue; }
        if (ch === '"') { flush(); const j = code.indexOf('"', i + 1); out += code.slice(i + 1, j < 0 ? code.length : j); i = j < 0 ? code.length : j; continue; }
        if (isDate && /[dmy]/i.test(ch)) {
          let j = i; while (code[j] && code[j].toLowerCase() === ch.toLowerCase()) j++;
          const n = j - i; const t = ch.toLowerCase(); const dt = new Date(v.slice(0, 10) + 'T00:00:00Z');
          if (t === 'd') out += n === 1 ? dt.getUTCDate() : String(dt.getUTCDate()).padStart(2, '0');
          else if (t === 'm') out += n === 1 ? dt.getUTCMonth() + 1 : n === 2 ? String(dt.getUTCMonth() + 1).padStart(2, '0')
            : new Intl.DateTimeFormat(locale, { month: n === 3 ? 'short' : 'long', timeZone: 'UTC' }).format(dt).replace('.', '');
          else out += n <= 2 ? String(dt.getUTCFullYear()).slice(2) : dt.getUTCFullYear();
          i = j - 1; continue;
        }
        if (!isDate && /[#0.,%]/.test(ch)) { num += ch; continue; }
        flush(); out += ch;
      }
      flush();
      return out;
    }

    // ---- measures ----
    const specs = {}; const formats = {};
    for (const ms of cfg.measures || []) { specs[ms.name] = ms.calc; formats[ms.name] = ms.format || '@'; }
    function fmt(nameOrCode, v) {
      const code = formats[nameOrCode] != null ? formats[nameOrCode] : nameOrCode;
      if (v == null || (typeof v === 'number' && !isFinite(v))) return '—';
      if (typeof v === 'string') return v;
      return /[#0]/.test(code) ? formatNumber(v, code) : formatCode(v, code);
    }
    const compiled = {};
    // Filter scope of the visual being computed (set by the UI): lets a calc drop the filters of one table,
    // like CALCULATE(..., REMOVEFILTERS/DATESBETWEEN on 'Dim Date') or ALLSELECTED.
    let scope = { base: all, filters: [] };
    const setScope = (base, filters) => { scope = { base, filters: filters || [] }; };
    const unfiltered = (table) => scope.filters.filter((f) => !table || tableOf(f.field) !== table)
      .reduce((r, f) => filter(r, f), scope.base);
    // ctx = current row of a disconnected table (undefined = no row selected, like DAX with no filter on it).
    function m(name, rows = all, ctx) {
      const s = specs[name];
      if (!s) throw new Error('Measure without calc: ' + name);
      if (s.agg) {
        let r = rows;
        for (const f in s.where || {}) r = filter(r, { field: f, values: s.where[f] });
        if (s.agg === 'count') return r.length || null;
        const v = nums(s.column, r);
        if (!v.length) return null;
        if (s.agg === 'sum') return v.reduce((a, b) => a + b, 0);
        if (s.agg === 'avg') return v.reduce((a, b) => a + b, 0) / v.length;
        if (s.agg === 'min') return min(s.column, r);
        if (s.agg === 'max') return max(s.column, r);
        if (s.agg === 'distinct') return new Set(v).size;
        throw new Error('Unknown agg ' + s.agg);
      }
      if (s.divide) {
        let a = m(s.divide[0], rows, ctx); const b = m(s.divide[1], rows, ctx);
        if (a == null && s.blankAsZero) a = 0;
        return a == null || !b ? null : a / b;
      }
      if (s.template != null) return s.template.replace(/\{([^}]+)\}/g, (_, n) => fmt(n, m(n, rows, ctx)));
      if (s.js) {
        const f = compiled[name] || (compiled[name] = Function('"use strict"; return (' + s.js + ');')());
        return f({ rows, all, ctx, statics, unfiltered, m: (n, r = rows, cx = ctx) => m(n, r, cx), fmt, groupBy: (fl, r = rows) => groupBy(fl, r), filter: (r, fl) => filter(r, fl),
          max: (fl, r = rows) => max(fl, r), min: (fl, r = rows) => min(fl, r), distinct: (fl, r = rows) => distinct(fl, r), formatCode, locale });
      }
      throw new Error('Unknown calc for ' + name);
    }

    return { all, col, filter, groupBy, distinct, max, min, m, fmt, formatCode, cmp, isStatic, setScope, statics, has: (k) => !!cols[k] || isStatic(k), hasMeasure: (n) => !!specs[n] };
  }

  if (typeof module === 'object' && module.exports) module.exports = { createEngine };
  else root.createEngine = createEngine;
})(this);
