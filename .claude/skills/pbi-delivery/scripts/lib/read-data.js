// pbi-delivery · lib/read-data.js
// Dependency-free readers for the data a user shares: .xlsx (every sheet), .csv/.tsv/.txt, .json.
// Shared by profile-data.js (profiling, capped rows) and build-html.js (all rows, embedded data).
// Every reader returns tables: { name, kind, file, sheet?, header: string[], rows: string[][], rowCount }.
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function parseDelimited(text, file, maxRows = Infinity) {
  text = text.replace(/^﻿/, '');
  const first = text.slice(0, text.indexOf('\n') > 0 ? text.indexOf('\n') : text.length);
  const delim = [',', ';', '\t', '|'].map((d) => [d, first.split(d).length]).sort((x, y) => y[1] - x[1])[0][0];
  const rows = []; let row = []; let cell = ''; let q = false; let total = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; continue; }
    if (ch === '"') q = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.length > 1 || row[0] !== '') { total++; if (rows.length <= maxRows) rows.push(row); }
      row = [];
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); total++; if (rows.length <= maxRows) rows.push(row); }
  const header = rows.shift() || [];
  return { name: path.basename(file).replace(/\.[^.]+$/, ''), kind: 'csv', file, delimiter: delim, header: header.map((h) => h.trim()), rows, rowCount: Math.max(0, total - 1) };
}

function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Not a zip/xlsx file');
  const count = buf.readUInt16LE(eocd + 10); let off = buf.readUInt32LE(eocd + 16);
  const files = {};
  for (let n = 0; n < count; n++) {
    const method = buf.readUInt16LE(off + 10), csize = buf.readUInt32LE(off + 20);
    const nlen = buf.readUInt16LE(off + 28), elen = buf.readUInt16LE(off + 30), clen = buf.readUInt16LE(off + 32);
    const local = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nlen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + csize);
    files[name] = () => (method === 8 ? zlib.inflateRawSync(data) : data).toString('utf8');
    off += 46 + nlen + elen + clen;
  }
  return files;
}
const xmlText = (s) => s.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const colIndex = (ref) => { let n = 0; for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };
const excelDate = (serial) => { const ms = Math.round((serial - 25569) * 86400000); const d = new Date(ms); return d.toISOString().slice(0, serial % 1 ? 19 : 10).replace('T', ' '); };

function readXlsx(file, maxRows = Infinity) {
  const z = unzip(fs.readFileSync(file));
  const shared = z['xl/sharedStrings.xml'] ? [...z['xl/sharedStrings.xml']().matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => xmlText(t[1])).join('')) : [];
  // date styles
  const dateXf = new Set();
  if (z['xl/styles.xml']) {
    const st = z['xl/styles.xml']();
    const custom = {}; for (const m of st.matchAll(/<numFmt [^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)) custom[m[1]] = m[2];
    const xfs = (st.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/) || [, ''])[1];
    [...xfs.matchAll(/<xf [^>]*?numFmtId="(\d+)"/g)].forEach((m, i) => {
      const id = +m[1]; const code = custom[m[1]] || '';
      if ((id >= 14 && id <= 22) || (id >= 45 && id <= 47) || (/[dy]/i.test(code.replace(/\[[^\]]*\]|"[^"]*"/g, '')) && !/^[#0.,%]+$/.test(code))) dateXf.add(i);
    });
  }
  const wb = z['xl/workbook.xml']();
  const rels = z['xl/_rels/workbook.xml.rels']();
  const relMap = {}; for (const m of rels.matchAll(/<Relationship [^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)) relMap[m[1]] = m[2];
  for (const m of rels.matchAll(/<Relationship [^>]*Target="([^"]+)"[^>]*Id="([^"]+)"/g)) relMap[m[2]] = relMap[m[2]] || m[1];
  const sheets = [];
  for (const m of wb.matchAll(/<sheet [^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
    const target = relMap[m[2]].replace(/^\/?(xl\/)?/, 'xl/');
    const xml = z[target] ? z[target]() : '';
    const rows = []; let total = 0;
    for (const r of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      total++; if (rows.length > maxRows) continue;
      const vals = [];
      for (const c of r[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1]; const body = c[2] || '';
        const ref = (attrs.match(/r="([A-Z]+\d+)"/) || [])[1]; const t = (attrs.match(/t="(\w+)"/) || [])[1]; const s = +((attrs.match(/s="(\d+)"/) || [])[1] || -1);
        const v = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        let val = '';
        if (t === 's') val = shared[+v] || '';
        else if (t === 'inlineStr') val = xmlText((body.match(/<is>([\s\S]*?)<\/is>/) || [, ''])[1]);
        else if (t === 'b') val = v === '1' ? 'TRUE' : 'FALSE';
        else if (v !== undefined) val = dateXf.has(s) && !isNaN(+v) ? excelDate(+v) : xmlText(v);
        vals[ref ? colIndex(ref) : vals.length] = val;
      }
      rows.push(Array.from(vals, (x) => (x === undefined ? '' : x)));
    }
    const header = (rows.shift() || []).map((h) => String(h).trim());
    if (header.length) sheets.push({ name: m[1], kind: 'xlsx', file, sheet: m[1], header, rows, rowCount: Math.max(0, total - 1) });
  }
  return sheets;
}

function readJsonData(file, maxRows = Infinity) {
  let j = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  if (!Array.isArray(j)) { const k = Object.keys(j).find((x) => Array.isArray(j[x])); j = k ? j[k] : []; }
  const header = [...new Set(j.slice(0, 200).flatMap((o) => Object.keys(o || {})))];
  return { name: path.basename(file).replace(/\.[^.]+$/, ''), kind: 'json', file, header, rows: j.slice(0, maxRows).map((o) => header.map((h) => (o[h] == null ? '' : String(o[h])))), rowCount: j.length };
}

// Reads every table in a file or folder (recursively; skips dotfiles and Excel lock files).
function readAny(p, maxRows = Infinity) {
  const out = [];
  const walk = (q) => {
    const st = fs.statSync(q);
    if (st.isDirectory()) return fs.readdirSync(q).filter((f) => !f.startsWith('.') && !f.startsWith('~$')).forEach((f) => walk(path.join(q, f)));
    if (/\.xlsx$/i.test(q)) out.push(...readXlsx(q, maxRows));
    else if (/\.(csv|tsv|txt)$/i.test(q)) out.push(parseDelimited(fs.readFileSync(q, 'utf8'), q, maxRows));
    else if (/\.json$/i.test(q)) out.push(readJsonData(q, maxRows));
  };
  walk(path.resolve(p));
  return out;
}

module.exports = { parseDelimited, unzip, readXlsx, readJsonData, readAny };
