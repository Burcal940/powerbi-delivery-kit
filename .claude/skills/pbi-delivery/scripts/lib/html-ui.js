// pbi-delivery · lib/html-ui.js — browser runtime of the interactive HTML (inlined by build-html.js).
// Reads window.CFG (state.json page + design + measure specs) and window.DATA (embedded rows).
// Same layout math as build-pbir.js and the mockup. Interactions: sidebar slicers, click-to-cross-filter
// on chart categories (click again or Esc to clear), hover tooltips, "Limpiar filtros".
(function () {
  'use strict';
  const CFG = window.CFG; const E = createEngine(CFG, window.DATA);
  const C = CFG.colors; const P = CFG.page; const cv = CFG.canvas;
  const SBW = CFG.shell.sidebar.width; const HDH = CFG.shell.header.height;
  const stage = document.getElementById('stage'); const tip = document.getElementById('tip');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const label = (field, v) => {
    const L = (CFG.valueLabels || {})[field]; const k = v == null ? '' : String(v);
    if (L && L[k] != null) return L[k];
    if (v == null) return '(En blanco)';
    return E.formatCode(v, (CFG.colFormats || {})[field]);
  };
  const isPct = (name) => /%/.test((CFG.measures.find((x) => x.name === name) || {}).format || '');

  // ---------------- filter state ----------------
  let base = E.all;
  for (const f of P.filters || []) base = E.filter(base, f);
  const S = { slicers: {}, cross: null }; // slicers[field] = {values:[]} | {min,max}; cross = {vid, field, key}
  const rowsFor = (vid) => {
    let r = base;
    for (const f in S.slicers) r = E.filter(r, Object.assign({ field: f }, S.slicers[f]));
    if (S.cross && S.cross.vid !== vid) r = E.filter(r, { field: S.cross.field, values: [S.cross.key] });
    return r;
  };
  const active = () => Object.keys(S.slicers).length + (S.cross ? 1 : 0);
  const val = (name, rows) => { try { return E.m(name, rows); } catch (e) { console.error(e); return null; } };

  // ---------------- layout math (state-schema.md) ----------------
  const X0 = SBW + cv.padding; const W = cv.width - SBW - 2 * cv.padding;
  const rowsDef = P.rows;
  const fixed = rowsDef.filter((r) => r.height !== 'fill').reduce((a, r) => a + r.height, 0) + cv.gutter * (rowsDef.length - 1);
  const nFill = rowsDef.filter((r) => r.height === 'fill').length || 1;
  const fillH = (cv.height - HDH - 2 * cv.padding - fixed) / nFill;
  const boxes = []; let y = HDH + cv.padding;
  rowsDef.forEach((r, ri) => {
    const h = r.height === 'fill' ? fillH : r.height;
    const spans = r.items.map((it) => it.span || 1); const tot = spans.reduce((a, b) => a + b, 0);
    const avail = W - cv.gutter * (r.items.length - 1); let x = X0;
    r.items.forEach((it, i) => { const w = (avail * spans[i]) / tot; boxes.push({ vid: 'v' + ri + '_' + i, item: it, x, y, w, h }); x += w + cv.gutter; });
    y += h + cv.gutter;
  });

  // ---------------- shell ----------------
  const sb = CFG.shell.sidebar;
  const navY = (i) => 128 + i * 48;
  const filtersTop = navY((sb.items || []).length) + 24;
  stage.insertAdjacentHTML('beforeend', `
    <div class="abs sb">
      <div class="abs brand">${esc(sb.brand)}</div>
      <div class="abs sub">${esc(sb.subtitle || '')}</div>
      <div class="abs sec" style="top:104px">${esc(sb.section || '')}</div>
      ${(sb.items || []).map((t, i) => `<div class="abs item${t === (P.navLabel || P.title) ? ' on' : ''}" style="top:${navY(i)}px">${esc(t)}</div>`).join('')}
      <div class="abs filters" style="top:${filtersTop}px" id="filters"></div>
    </div>
    <div class="abs hd">
      <div class="abs title">${esc(P.title)}</div>
      <div class="abs headline" id="headline"></div>
      <div class="abs tag" id="tag"></div>
    </div>`);
  boxes.forEach((b) => stage.insertAdjacentHTML('beforeend',
    `<div class="abs tile${b.item.type === 'text' ? ' bare' : ''}" id="${b.vid}" style="left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px"></div>`));

  // ---------------- slicers (sidebar) ----------------
  const fEl = document.getElementById('filters');
  function drawSlicers() {
    let h = '<div class="sec">FILTROS</div>';
    (P.slicers || []).forEach((s, i) => {
      const cur = S.slicers[s.field];
      h += `<div class="slc"><div class="slbl">${esc(s.label || s.field)}</div>`;
      if (s.type === 'range') {
        const lo = E.min(s.field, base); const hi = E.max(s.field, base);
        const isD = typeof lo === 'string';
        const a = cur && cur.min != null ? cur.min : lo; const b = cur && cur.max != null ? cur.max : hi;
        h += `<div class="rng"><input data-i="${i}" data-end="min" type="${isD ? 'date' : 'number'}" min="${lo}" max="${hi}" value="${a}">`
          + `<input data-i="${i}" data-end="max" type="${isD ? 'date' : 'number'}" min="${lo}" max="${hi}" value="${b}"></div>`;
      } else {
        const sel = new Set(cur ? cur.values.map(String) : []);
        h += '<div class="chips">' + E.distinct(s.field, base).map((v) =>
          `<button class="chip${sel.has(String(v)) ? ' on' : ''}" data-i="${i}" data-v="${esc(v == null ? '\u0000' : v)}">${esc(label(s.field, v))}</button>`).join('') + '</div>';
      }
      h += '</div>';
    });
    h += `<button class="clear" id="clear"${active() ? '' : ' disabled'}>Limpiar filtros</button>`;
    fEl.innerHTML = h;
  }
  fEl.addEventListener('click', (e) => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.id === 'clear') { S.slicers = {}; S.cross = null; return render(); }
    const s = P.slicers[+t.dataset.i]; const raw = t.dataset.v;
    const v = raw === '\u0000' ? null : E.distinct(s.field, base).find((x) => String(x) === raw);
    const cur = new Set(S.slicers[s.field] ? S.slicers[s.field].values : []);
    cur.has(v) ? cur.delete(v) : cur.add(v);
    if (cur.size) S.slicers[s.field] = { values: [...cur] }; else delete S.slicers[s.field];
    render();
  });
  fEl.addEventListener('change', (e) => {
    const t = e.target; if (!t.dataset.end) return;
    const s = P.slicers[+t.dataset.i]; const lo = E.min(s.field, base); const hi = E.max(s.field, base);
    const cur = Object.assign({ min: lo, max: hi }, S.slicers[s.field] || {});
    const v = t.type === 'number' ? +t.value : t.value;
    cur[t.dataset.end] = v === '' ? (t.dataset.end === 'min' ? lo : hi) : v;
    if (cur.min > cur.max) [cur.min, cur.max] = [cur.max, cur.min];
    if (cur.min === lo && cur.max === hi) delete S.slicers[s.field]; else S.slicers[s.field] = cur;
    render();
  });

  // ---------------- visuals ----------------
  function kpiTile(b) {
    const it = b.item; const rows = rowsFor(b.vid);
    const items = it.type === 'kpiGroup' ? it.items : [it];
    const cw = (b.w - 48) / items.length;
    let h = items.map((k, j) => {
      const st = k.status ? val(k.status, rows) : null;
      return `<div class="abs kv" style="left:${24 + j * cw}px;top:20px;width:${cw}px"><div class="lbl">${esc(k.label)}</div>`
        + `<div class="val num"${st && k.valueStatus ? ` style="color:${esc(st)}"` : ''}>${esc(E.fmt(k.measure, val(k.measure, rows)))}</div></div>`;
    }).join('');
    if (it.reference) {
      const st = it.status ? val(it.status, rows) : null;
      h += `<div class="abs ref num" style="left:24px;top:${b.h - 44}px;width:${b.w - 48}px${st ? `;color:${esc(st)}` : ''}">${esc(val(it.reference, rows))}</div>`;
    }
    return h;
  }

  function niceMax(v, pct) {
    if (!(v > 0)) return 1;
    if (pct) return Math.ceil(v * 10) / 10;
    const p = Math.pow(10, Math.floor(Math.log10(v))); return Math.ceil(v / p) * p;
  }

  function chartTile(b) {
    const it = b.item; const rows = rowsFor(b.vid); const vis = it.visual || 'clusteredColumnChart';
    const horiz = /bar/i.test(vis); const combo = /combo/i.test(vis);
    const kind = combo ? 'combo' : /line/i.test(vis) ? 'line' : /area/i.test(vis) ? 'area' : 'column';
    const stacked = /^(columnChart|barChart|stackedAreaChart)$/.test(vis);
    const pal = [C.accent, C.secondary, C.muted, C.subtle];
    const series = (it.series || []).map((s, k) => ({ ...s, kind: kind === 'combo' ? 'column' : kind, color: s.color || pal[k] }));
    const lines = (it.lines || []).map((s, k) => ({ ...s, kind: 'line', color: s.color || pal[series.length + k] }));
    const all = series.concat(lines);
    // categories with at least one non-blank value (Power BI hides empty categories)
    let cats = E.groupBy(it.category, rows).map((g) => ({ key: g.key, v: all.map((s) => val(s.measure, g.rows)) }))
      .filter((c) => c.v.some((x) => x != null));
    if (it.sort) {
      const k = all.findIndex((s) => s.measure === it.sort.field);
      const dir = /desc/i.test(it.sort.direction || '') ? -1 : 1;
      cats.sort((a, c) => dir * (k >= 0 ? (a.v[k] || 0) - (c.v[k] || 0) : E.cmp(a.key, c.key)));
    }
    const pct = isPct(all[0] && all[0].measure);
    const title = it.titleMeasure ? val(it.titleMeasure, rows) : it.title || '';
    const legend = (it.legend !== false && all.length > 1)
      ? `<div class="abs legend">${all.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.label || s.measure)}</span>`).join('')}</div>` : '';
    let head = `<div class="abs ctitle" style="width:${b.w - 48 - (legend ? (it.legendWidth || 190) : 0)}px" title="${esc(title)}">${esc(title)}</div>${legend}`;
    if (!cats.length) return head + '<div class="abs empty">Sin datos para la selección</div>';

    const pl = horiz ? 120 : 56, pr = 24, pt = 64, pb = 40;
    const w = b.w, h = b.h, iw = w - pl - pr, ih = h - pt - pb;
    const stackTot = (c) => series.reduce((a, s, k) => a + (c.v[k] || 0), 0);
    const vmax = Math.max(...cats.flatMap((c) => (stacked ? [stackTot(c)].concat(c.v.slice(series.length)) : c.v)).filter((x) => x != null), 0);
    const vmin = Math.min(0, ...cats.flatMap((c) => c.v).filter((x) => x != null));
    let max = niceMax(vmax, pct); if (it.yMax != null && it.yMax >= vmax) max = it.yMax;
    const min = it.yMin != null && it.yMin <= vmin ? it.yMin : vmin;
    const L = horiz ? iw : ih;
    const pos = (v) => ((v - min) / (max - min || 1)) * L; // distance from the value-axis origin
    const n = cats.length; const band = (horiz ? ih : iw) / n;
    const sel = S.cross && S.cross.vid === b.vid ? S.cross.key : undefined;
    let g = '';
    for (let i = 0; i <= 5; i++) { // value grid
      const v = min + ((max - min) * i) / 5; const p = pos(v);
      const t = pct ? E.formatCode(v, '0%') : E.formatCode(Math.round(v), '#,##0');
      g += horiz
        ? `<line x1="${pl + p}" x2="${pl + p}" y1="${pt}" y2="${pt + ih}" class="grid"/><text x="${pl + p}" y="${h - pb + 20}" text-anchor="middle" class="num">${t}</text>`
        : `<line x1="${pl}" x2="${w - pr}" y1="${pt + ih - p}" y2="${pt + ih - p}" class="grid"/><text x="${pl - 10}" y="${pt + ih - p + 4}" text-anchor="end" class="num">${t}</text>`;
    }
    const step = Math.max(1, Math.ceil(n / Math.max(1, Math.floor((horiz ? ih / 22 : iw / 44)))));
    const cpos = (i) => (horiz ? pt : pl) + band * (i + 0.5);
    cats.forEach((c, i) => {
      if (i % step) return;
      g += horiz ? `<text x="${pl - 10}" y="${cpos(i) + 4}" text-anchor="end">${esc(label(it.category, c.key))}</text>`
        : `<text x="${cpos(i)}" y="${h - pb + 20}" text-anchor="middle">${esc(label(it.category, c.key))}</text>`;
    });
    const dim = (c) => (sel !== undefined && c.key !== sel ? ' opacity=".3"' : '');
    // columns / bars
    const colS = series.filter((s) => s.kind === 'column');
    if (colS.length) {
      const bw = stacked ? Math.min(48, band * 0.6) : Math.min(40, (band * 0.7) / colS.length);
      cats.forEach((c, i) => {
        let acc = 0;
        colS.forEach((s, k) => {
          const v = c.v[series.indexOf(s)]; if (v == null) return;
          const a = stacked ? acc : 0; acc += stacked ? v : 0;
          const p0 = pos(Math.max(min, Math.min(a, a + v))), p1 = pos(Math.max(a, a + v));
          const off = stacked ? -bw / 2 : -(bw * colS.length) / 2 + k * bw;
          g += horiz
            ? `<rect x="${pl + p0}" y="${cpos(i) + off + 1}" width="${Math.max(0, p1 - p0)}" height="${bw - 2}" fill="${s.color}" rx="2"${dim(c)}/>`
            : `<rect x="${cpos(i) + off + 1}" y="${pt + ih - p1}" width="${bw - 2}" height="${Math.max(0, p1 - p0)}" fill="${s.color}" rx="2"${dim(c)}/>`;
        });
      });
    }
    // lines / areas (vertical charts only)
    if (!horiz) {
      const acc = cats.map(() => 0);
      series.concat(lines).filter((s) => s.kind !== 'column').forEach((s) => {
        const k = all.indexOf(s);
        const pts = cats.map((c, i) => {
          if (c.v[k] == null) return null;
          const top = stacked && s.kind === 'area' ? (acc[i] += c.v[k]) : c.v[k];
          return [cpos(i), pt + ih - pos(top), stacked && s.kind === 'area' ? pt + ih - pos(acc[i] - c.v[k]) : pt + ih - pos(Math.max(min, 0))];
        });
        const segs = []; let cur = [];
        pts.forEach((p) => { if (p) cur.push(p); else if (cur.length) { segs.push(cur); cur = []; } }); if (cur.length) segs.push(cur);
        segs.forEach((sg) => {
          const d = sg.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
          if (s.kind === 'area') g += `<path d="${d} ${sg.slice().reverse().map((p) => 'L' + p[0].toFixed(1) + ' ' + p[2].toFixed(1)).join(' ')} Z" fill="${s.color}" fill-opacity=".22"/>`;
          g += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linejoin="round"${s.style === 'dashed' ? ' stroke-dasharray="6 4"' : ''}/>`;
          if (sg.length === 1) g += `<circle cx="${sg[0][0]}" cy="${sg[0][1]}" r="3" fill="${s.color}"/>`;
        });
      });
      if (sel !== undefined) {
        const i = cats.findIndex((c) => c.key === sel);
        if (i >= 0) g += `<rect x="${cpos(i) - band / 2}" y="${pt}" width="${band}" height="${ih}" fill="${C.accent}" fill-opacity=".10"/>`
          + cats.map((c, j) => all.map((s, k) => (j === i && c.v[k] != null && s.kind !== 'column' ? `<circle cx="${cpos(j)}" cy="${pt + ih - pos(c.v[k])}" r="4" fill="${s.color}" stroke="#fff" stroke-width="1.5"/>` : '')).join('')).join('');
      }
    }
    // hit areas: hover → tooltip, click → cross-filter
    cats.forEach((c, i) => {
      g += horiz ? `<rect class="hit" data-i="${i}" x="${pl}" y="${cpos(i) - band / 2}" width="${iw}" height="${band}"/>`
        : `<rect class="hit" data-i="${i}" x="${cpos(i) - band / 2}" y="${pt}" width="${band}" height="${ih}"/>`;
    });
    b.cats = cats; b.series = all;
    return head + `<svg class="abs" style="left:0;top:0" width="${w}" height="${h}">${g}</svg>`;
  }

  function tableTile(b) {
    const it = b.item; const rows = rowsFor(b.vid);
    const fields = it.columns.filter((c) => c.field).map((c) => c.field);
    const groups = new Map();
    for (const i of rows) { const k = JSON.stringify(fields.map((f) => E.col(f)[i])); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(i); }
    let data = [...groups.entries()].map(([k, r]) => ({ keys: JSON.parse(k), cells: it.columns.map((c) => (c.field ? null : val(c.measure, r))) }));
    data.sort((a, c) => { for (let j = 0; j < fields.length; j++) { const d = E.cmp(a.keys[j], c.keys[j]); if (d) return d; } return 0; });
    if (it.sort) { const j = it.columns.findIndex((c) => (c.measure || c.field) === it.sort.field); const dir = /desc/i.test(it.sort.direction || '') ? -1 : 1; if (j >= 0 && !it.columns[j].field) data.sort((a, c) => dir * ((a.cells[j] || 0) - (c.cells[j] || 0))); }
    const title = it.titleMeasure ? val(it.titleMeasure, rows) : it.title || '';
    const head = it.columns.map((c) => `<th${c.field ? '' : ' class="r"'}>${esc(c.label || (c.field ? c.field.replace(/^.*\[|\]$/g, '') : c.measure))}</th>`).join('');
    const body = data.map((d) => '<tr>' + it.columns.map((c, j) => {
      if (c.field) { const v = d.keys[fields.indexOf(c.field)]; return `<td>${esc(label(c.field, v))}</td>`; }
      return `<td class="r num">${esc(E.fmt(c.measure, d.cells[j]))}</td>`;
    }).join('') + '</tr>').join('');
    return `<div class="abs ctitle" style="width:${b.w - 48}px">${esc(title)}</div><div class="abs tbl" style="left:16px;top:56px;width:${b.w - 32}px;height:${b.h - 72}px"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  }

  function textTile(b) {
    const it = b.item;
    return `<div class="abs" style="inset:0;display:flex;align-items:center;justify-content:${it.align === 'center' ? 'center' : it.align === 'right' ? 'flex-end' : 'flex-start'};font-size:${parseFloat(it.size) || 14}px;color:${it.color || C.ink};font-weight:${it.bold ? 700 : 400}">${esc(it.text)}</div>`;
  }

  // ---------------- render ----------------
  function render() {
    const r = rowsFor('header');
    document.getElementById('headline').textContent = P.headline ? (P.headline.measure ? val(P.headline.measure, r) : P.headline.text) : '';
    const n = active();
    document.getElementById('tag').innerHTML = esc(P.tag || '') + (n ? ` · <b class="on">${n} filtro${n > 1 ? 's' : ''} activo${n > 1 ? 's' : ''}</b>` : '');
    boxes.forEach((b) => {
      const t = b.item.type;
      document.getElementById(b.vid).innerHTML = t === 'chart' ? chartTile(b) : t === 'table' ? tableTile(b) : t === 'text' ? textTile(b)
        : t === 'kpi' || t === 'kpiGroup' ? kpiTile(b) : `<div class="abs empty">Tipo no soportado: ${esc(t)}</div>`;
    });
    drawSlicers();
  }

  // ---------------- interactions ----------------
  const boxOf = (el) => boxes.find((b) => b.vid === (el.closest('.tile') || {}).id);
  stage.addEventListener('click', (e) => {
    const hit = e.target.closest('.hit'); if (!hit) return;
    const b = boxOf(hit); const c = b.cats[+hit.dataset.i];
    S.cross = S.cross && S.cross.vid === b.vid && S.cross.key === c.key ? null : { vid: b.vid, field: b.item.category, key: c.key };
    tip.style.display = 'none'; render();
  });
  stage.addEventListener('mousemove', (e) => {
    const hit = e.target.closest('.hit');
    if (!hit) { tip.style.display = 'none'; return; }
    const b = boxOf(hit); const c = b.cats[+hit.dataset.i];
    tip.innerHTML = `<b>${esc(label(b.item.category, c.key))}</b>` + b.series.map((s, k) =>
      `<div><i style="background:${s.color}"></i>${esc(s.label || s.measure)}<span class="num">${esc(E.fmt(s.measure, c.v[k]))}</span></div>`).join('')
      + `<small>${S.cross && S.cross.vid === b.vid && S.cross.key === c.key ? 'Clic para quitar el filtro' : 'Clic para filtrar el tablero'}</small>`;
    tip.style.display = 'block';
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    tip.style.left = Math.min(innerWidth - tw - 8, e.clientX + 14) + 'px';
    tip.style.top = Math.min(innerHeight - th - 8, e.clientY + 14) + 'px';
  });
  stage.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.cross) { S.cross = null; render(); } });

  function fit() {
    const s = Math.min(innerWidth / cv.width, innerHeight / cv.height);
    stage.style.transform = `translate(${(innerWidth - cv.width * s) / 2}px,${(innerHeight - cv.height * s) / 2}px) scale(${s})`;
  }
  addEventListener('resize', fit); fit(); render();
})();
