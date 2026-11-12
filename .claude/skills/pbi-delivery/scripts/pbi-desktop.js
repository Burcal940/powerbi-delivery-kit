#!/usr/bin/env node
// pbi-delivery · scripts/pbi-desktop.js
// Opens a project's .pbip in Power BI Desktop (or reuses the open window), waits until it is ready,
// and optionally takes a screenshot of the report pages. Windows only (Power BI Desktop).
//
//   node pbi-desktop.js --project projects/<name> [--fresh] [--refresh] [--screenshot <file.png>] [--page <name>] [--timeout 600]
//
//   (no flag)     open the .pbip if no Desktop window has it, then print the status
//   --fresh       close Desktop WITHOUT saving and reopen the .pbip: Desktop reloads TMDL + PBIR
//                 from disk. Use after Claude changed the model or the pages.
//                 Any change made by hand in Desktop and not saved is lost. Then refreshes the data
//                 (Home > Refresh via UI Automation), since a changed model reopens empty.
//   --refresh     refresh the data without reopening · --no-refresh: skip it after --fresh
//   --screenshot  save a screenshot of the rendered window (powerbi-report-author preview)
//   --timeout     total seconds before giving up (default 600). The script never hangs past it.
//
// Why: Desktop reads the PBIP folder only when it opens. Editing TMDL/PBIR while it is open
// changes nothing on screen, and preview --reload stops when Desktop has unsaved changes
// (every open with new data marks the file dirty). Reopening is the reliable reload.
// If the preview host is lost (HOST_UNAVAILABLE, e.g. after an interrupted run), it reopens once.
// If Desktop shows an error dialog while loading, its text is printed (no need to copy it by hand).
// Output is plain ASCII: Windows PowerShell 5.1 consoles garble other characters.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync, spawn } = require('child_process');

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const k = process.argv[i].replace(/^--/, '');
  const next = process.argv[i + 1];
  if (next === undefined || next.startsWith('--')) args[k] = true; else { args[k] = next; i++; }
}
const fail = (msg) => { console.error(`ERROR ${msg}`); process.exit(1); };
if (process.platform !== 'win32') fail('Power BI Desktop runs on Windows only.');
if (!args.project) fail('usage: node pbi-desktop.js --project projects/<name> [--fresh] [--refresh] [--screenshot <png>] [--page <name>] [--timeout 600]');

const deadline = Date.now() + (Number(args.timeout) || 600) * 1000;
const left = () => Math.max(0, deadline - Date.now());
const checkTime = (what) => { if (!left()) fail(`gave up after ${Number(args.timeout) || 600} s while ${what}. Look at the Desktop window.`); };

const project = path.resolve(String(args.project));
const findPbip = (dir, depth = 0) => {
  if (depth > 2 || !fs.existsSync(dir)) return null;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const hit = entries.find((e) => e.isFile() && e.name.toLowerCase().endsWith('.pbip'));
  if (hit) return path.join(dir, hit.name);
  for (const e of entries) {
    if (!e.isDirectory() || /^(node_modules|data|html|intake|mockups|docs|\.git)$/i.test(e.name) || /\.(Report|SemanticModel)$/.test(e.name)) continue;
    const r = findPbip(path.join(dir, e.name), depth + 1);
    if (r) return r;
  }
  return null;
};
const pbip = findPbip(project);
if (!pbip) fail(`no .pbip under ${project}. Save an empty report from Desktop first: File > Save as > Power BI Project.`);
const base = path.basename(pbip, '.pbip');
const report = path.join(path.dirname(pbip), `${base}.Report`);
if (!fs.existsSync(report)) fail(`${report} not found next to the .pbip.`);

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(ms, left()));
const ps = (cmd, ms = 60000) => spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { encoding: 'utf8', timeout: Math.max(1000, Math.min(ms, left())) });
const windows = () => {
  const r = ps("Get-Process PBIDesktop -ErrorAction SilentlyContinue | ForEach-Object { \"$($_.Id)`t$($_.MainWindowTitle)\" }");
  return (r.stdout || '').split(/\r?\n/).filter(Boolean).map((l) => { const [id, title] = l.split('\t'); return { id: Number(id), title: title || '' }; });
};
const ours = () => windows().filter((w) => w.title.toLowerCase().startsWith(base.toLowerCase()));
const cli = (...a) => {
  const r = spawnSync(['powerbi-report-author', ...a].join(' '), { encoding: 'utf8', shell: true, timeout: Math.max(1000, Math.min(240000, left())) });
  if (r.error && r.error.code !== 'ETIMEDOUT') fail(`powerbi-report-author not found (${r.error.message}). Run /setup, or restart VS Code after installing Node.`);
  if (r.error) return { raw: 'TIMEOUT' };
  try { return JSON.parse(r.stdout); } catch { return { raw: (r.stdout || '') + (r.stderr || '') }; }
};
const hostLost = (r) => /HOST_UNAVAILABLE/i.test(JSON.stringify(r || {}));

// Text of any dialog Desktop shows over the report (TMDL / Power Query / credential errors).
const dialogText = () => {
  const w = ours()[0] || windows()[0];
  if (!w) return '';
  const r = ps(`
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$A = [System.Windows.Automation.AutomationElement]; $S = [System.Windows.Automation.TreeScope]::Descendants
$root = $A::FromHandle((Get-Process -Id ${w.id}).MainWindowHandle)
$win = New-Object System.Windows.Automation.PropertyCondition($A::ControlTypeProperty, [System.Windows.Automation.ControlType]::Window)
$txt = New-Object System.Windows.Automation.PropertyCondition($A::ControlTypeProperty, [System.Windows.Automation.ControlType]::Text)
foreach ($d in $root.FindAll($S, $win)) {
  $n = $d.Current.Name; if (-not $n -or $n -eq 'about:blank') { continue }
  $t = @($d.FindAll($S, $txt) | ForEach-Object { $_.Current.Name } | Where-Object { $_ }) -join ' | '
  if ($t) { "$n :: $t" }
}`, 30000);
  return (r.stdout || '').trim();
};

const closeDesktop = () => {
  const open = ours();
  if (!open.length) return;
  console.log(`Closing Power BI Desktop (pid ${open.map((w) => w.id).join(', ')}) without saving...`);
  ps(`Stop-Process -Id ${open.map((w) => w.id).join(',')} -Force`);
  for (let t = 0; t < 30 && ours().length; t++) sleep(1000);
  sleep(3000); // let the Analysis Services child process exit
};
const openDesktop = () => {
  console.log(`Opening ${path.relative(process.cwd(), pbip)} in Power BI Desktop...`);
  spawn('cmd.exe', ['/c', 'start', '""', `"${pbip}"`], { detached: true, stdio: 'ignore', windowsVerbatimArguments: true }).unref();
  while (!ours().length) { checkTime('waiting for Desktop to open the report (is Power BI Desktop installed?)'); sleep(5000); }
};
const waitReady = () => {
  let status, retried = false;
  for (;;) {
    status = cli('preview', '--host', 'desktop', '--status', `"${report}"`);
    if (status.data && status.data.state === 'ready') return status;
    if (hostLost(status) && !retried && ours().length) {
      retried = true;
      console.log('Preview host lost (HOST_UNAVAILABLE): reopening Desktop once...');
      closeDesktop(); openDesktop();
    }
    if (!left()) break;
    sleep(5000);
  }
  const d = dialogText();
  if (d) fail(`Desktop shows a dialog instead of the report:\n  ${d.split(/\r?\n/).join('\n  ')}`);
  console.log(JSON.stringify(status, null, 1));
  fail('Desktop opened but the report is not ready.');
};
const reopen = () => { closeDesktop(); openDesktop(); return waitReady(); };

if (args.fresh) closeDesktop();
if (!ours().length) openDesktop();
let status = waitReady();
console.log(`Desktop ready: ${base} (unsaved changes: ${status.data.details && status.data.details.hasUnsavedChanges ? 'yes - do not save while Claude edits files' : 'no'})`);

// Refresh data: a reopened PBIP whose model changed has no data cached ("Some tables have incomplete
// or no data"). Press Home > Refresh through Windows UI Automation and wait for its dialog to close.
const refresh = () => {
  const names = ['Actualizar', 'Refresh', 'Actualiser', 'Aktualisieren', 'Atualizar', 'Aggiorna'];
  const pid = ours()[0] && ours()[0].id;
  const uia = `
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$A = [System.Windows.Automation.AutomationElement]; $S = [System.Windows.Automation.TreeScope]::Descendants
$root = $A::FromHandle((Get-Process -Id ${pid}).MainWindowHandle)
$names = @(${names.map((n) => `'${n}'`).join(',')})
$win = New-Object System.Windows.Automation.PropertyCondition($A::ControlTypeProperty, [System.Windows.Automation.ControlType]::Window)
# Only the refresh dialog counts (Desktop keeps other, blank child windows open).
$busy = { @($root.FindAll($S, $win) | Where-Object { $names -contains $_.Current.Name }).Count -gt 0 }
$btn = New-Object System.Windows.Automation.PropertyCondition($A::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)
$started = $false
# Several controls share the name (ribbon split button, other views): try each until the refresh dialog shows.
foreach ($b in $root.FindAll($S, $btn)) {
  if ($started) { break }
  if (-not ($names -contains $b.Current.Name) -or $b.Current.IsOffscreen -or -not $b.Current.IsEnabled) { continue }
  try { $b.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke() } catch { continue }
  for ($t = 0; $t -lt 15; $t++) { if (& $busy) { $started = $true; break }; Start-Sleep -Seconds 1 }
}
if (-not $started) { 'NOBUTTON'; exit }
for ($t = 0; $t -lt 300; $t += 3) { if (-not (& $busy)) { 'DONE'; exit }; Start-Sleep -Seconds 3 }
'TIMEOUT'`;
  console.log('Refreshing data (Home > Refresh)...');
  const r = (ps(uia, 330000).stdout || '').trim();
  if (r.endsWith('DONE')) { console.log('Data refreshed.'); return; }
  const d = dialogText();
  if (d) console.log(`Desktop shows a dialog after the refresh:\n  ${d.split(/\r?\n/).join('\n  ')}`);
  if (r.endsWith('NOBUTTON')) console.log('Could not find the Refresh button: press Home > Refresh in Desktop.');
  else if (!d) console.log('Refresh still running after 5 min (or timed out): look at the Desktop window.');
};
if (args.refresh || (args.fresh && !args['no-refresh'])) refresh();

if (args.screenshot) {
  sleep(8000); // visuals finish rendering after the model load
  const shot = path.resolve(String(args.screenshot));
  const a = ['preview', '--host', 'desktop', '--screenshot', `"${shot}"`];
  if (args.page) a.push('--page', `"${args.page}"`);
  a.push(`"${report}"`);
  let r = cli(...a);
  if (hostLost(r)) {
    console.log('Preview host lost (HOST_UNAVAILABLE): reopening Desktop once...');
    reopen();
    if (!args['no-refresh']) refresh();
    sleep(8000);
    r = cli(...a);
  }
  if (r.data && r.data.screenshots) r.data.screenshots.forEach((s) => console.log(`Screenshot: ${s.pageDisplayName} -> ${s.path}`));
  else { console.log(JSON.stringify(r, null, 1)); fail('screenshot failed.'); }
}
