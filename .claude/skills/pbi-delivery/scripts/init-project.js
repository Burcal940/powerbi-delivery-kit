#!/usr/bin/env node
// pbi-delivery · init-project.js
// Creates the project skeleton in ANY repo/folder (no monorepo needed). Never overwrites.
// Usage: node init-project.js --root <repo or folder> --name <kebab-name>
'use strict';
const fs = require('fs');
const path = require('path');

const a = {};
for (let i = 2; i < process.argv.length; i += 2) a[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
if (!a.name) { console.error('Usage: node init-project.js --root <folder> --name <kebab-name>'); process.exit(2); }
const name = a.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const root = path.resolve(a.root || '.');
const base = fs.existsSync(path.join(root, 'projects')) || !fs.existsSync(path.join(root, name)) ? path.join(root, 'projects', name) : path.join(root, name);
const tpl = path.join(__dirname, '..', 'templates');
const created = []; const kept = [];
const mk = (rel) => { const p = path.join(base, rel); if (!fs.existsSync(p)) { fs.mkdirSync(p, { recursive: true }); created.push(rel + '/'); } };
const put = (rel, content) => { const p = path.join(base, rel); if (fs.existsSync(p)) { kept.push(rel); return; } fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, content); created.push(rel); };
const fill = (s) => s.replace(/\{\{PROJECT_NAME\}\}/g, name).replace(/\{\{YYYY-MM-DD\}\}/g, new Date().toISOString().slice(0, 10));

['intake', 'mockups', 'data', 'docs/validations', 'tests'].forEach(mk);
put('brief.md', fill(fs.readFileSync(path.join(tpl, 'brief.md'), 'utf8')));
put('data-contract.md', fill(fs.readFileSync(path.join(tpl, 'data-contract.md'), 'utf8')));
put('state.md', `# State — ${name}\n\n**Status:** intake — collecting design and data\n**Last updated:** ${new Date().toISOString().slice(0, 10)}\n\n## Blockers\n\n- \n\n## Next step\n\nRun intake (design + data) — see pbi-delivery SKILL.md.\n\n## Done\n\n- Project created.\n`);
put('decisions.md', `# Decisions — ${name}\n\n## ${new Date().toISOString().slice(0, 10)} — Project created\n- Scaffolded with pbi-delivery/scripts/init-project.js.\n`);
put('data/README.md', 'Real data extracts live here and are NOT committed (add `**/data/*` except this README to .gitignore). Point Power Query at this folder with the SourcePath parameter.\n');
// keep real data out of git in any repo
const gi = path.join(root, '.gitignore');
const rel = (p) => path.relative(root, path.join(base, p)).replace(/\\/g, '/');
const rule = `${rel('data')}/*\n!${rel('data')}/README.md\n${rel('html')}/\n${rel('intake/generated/profile.json')}\n`;
const cur = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8') : '';
if (!cur.includes(rule.split('\n')[0])) { fs.writeFileSync(gi, cur + (cur.endsWith('\n') || !cur ? '' : '\n') + '# pbi-delivery: real data (and the HTML that embeds it) stays local\n' + rule); created.push('.gitignore rule'); }
console.log(JSON.stringify({ ok: true, project: base, created, kept }, null, 2));
