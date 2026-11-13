---
name: pbi-delivery
description: Client-agnostic delivery of a Power BI report for any project, personal or enterprise. From whatever the user shares — an HTML/artifact mockup, a design system or palette, Excel/CSV/JSON files or a database — it derives design tokens, a Power BI theme, a data contract, Power Query with parameters and a state.json spec, then produces BOTH an HTML mockup and the real Power BI report (semantic model + PBIR pages). Use when starting a dashboard/report project, when the user shares a design or data to "turn into Power BI", for "mockup to Power BI", "connect this Excel/CSV/database", "data contract", "state.json", "/build-mockup", "/build-pbi".
---

# pbi-delivery — what you share → mockup + Power BI

```
ONE COMMAND:  node <skill>/scripts/intake.js --project <project folder> [--brand "<Brand>"]

Shared image (PNG screenshot / export)        ─► read-image     ─► exact colors, sidebar, header, canvas ─┐
Shared design (HTML · artifact · CSS · JSON)  ─► extract-design ─► design tokens ◄─────────────────────────┘ ─► make-theme ─► Power BI theme
Shared data (Excel · CSV · JSON · DB schema)  ─► profile-data   ─► model plan + data contract + M with parameters
                              tokens + model plan ─► draft-state ─► state.json ◄─ Claude reshapes pages to match the image/mockup (§4)
state.json + sample data ─► build-html --sample ─► mockup HTML (phase 4)   and   state.json ─► build-model TMDL (phase 6) + build-pbir pages (phase 7)
state.json + real data ─► build-html ─► interactive HTML twin of the Power BI page (phase 7b)
```

**Where the user puts things** (inside the project folder): design material — images, HTML/artifact
exports, CSS, design-system folders or zips, palette/theme JSON — in `intake/`; data files in
`data/`; for a database, a schema export passed with `--schema`. Everything generated lands in
`intake/generated/` with an `INTAKE.md` checklist. Nothing the user shared is ever overwritten.

Nothing here is tied to a client or project. Brand values come from the shared design; tables,
types, keys and relationships come from the shared data; business meaning comes from the user.
A worked example lives in the repo where this skill was built (`projects/finance-tracker/`) —
treat it as an illustration only, never as content to reuse.

## Scripts (`scripts/`, Node 20+, no dependencies)

| Script | Input | Output |
|---|---|---|
| `init-project.js` | `--root <repo> --name <name>` | Project skeleton in any repo (never overwrites) |
| **`intake.js`** | `--project <folder>` (+ `--schema/--source/--server/--database` for a DB) | Runs every step below that applies to what was shared; writes `intake/generated/` + `INTAKE.md` |
| `read-image.js` | PNG of a dashboard/design | Exact pixel colors by role (page, card, text, muted, border, accent, series, status), sidebar width, header height, canvas scale → CSS tokens |
| `extract-design.js` | HTML / CSS / design-system folder / palette or theme JSON (+ the image CSS) | `design-tokens.json` (colors by role, font, type scale, canvas, sidebar, spacing, data colors, evidence, toConfirm) |
| `make-theme.js` | `design-tokens.json` | Power BI theme JSON |
| `profile-data.js` | `.xlsx` `.csv` `.tsv` `.json` files/folders, or a DB schema export | `model-plan.json`, `queries.pq` (M + parameters), `data-contract.draft.md`, `profile.json` |
| `draft-state.js` | tokens + model plan | First `state.json` (proposed KPI page; technical measures with `dax` + `calc`, PY/YoY/delta included, so the mockup renders at once; status colors and headline stay TBD) |
| `build-model.js` | `--project <folder> [--check \| --import \| --write [--prune]]` | Semantic model as code: state.json `model` ↔ TMDL (measures with DAX, tables with M, relationships, Dim Date). `--check` exits 1 on drift |
| `build-pbir.js` | `state.json` + `<name>.Report` | Power BI pages (PBIR) + registered theme; deterministic output |
| `pbi-desktop.js` | `--project <folder> [--fresh] [--refresh] [--screenshot <png>] [--page <name>] [--timeout 600]` | Opens the `.pbip` in Power BI Desktop. `--fresh` closes it without saving, reopens it (reloads TMDL + PBIR from disk) and presses Home → Refresh (a changed model reopens with no data). Waits until ready, then saves a screenshot. Never runs past `--timeout`; reopens once on HOST_UNAVAILABLE; prints the text of any Desktop error dialog |
| `project-status.js` | `--project <folder>` or `--root <repo>` | JSON: phase (material → … → done), next step and who acts, evidence, blockers, warnings. Read-only; used by `/dashboard` and `/status` |
| `build-html.js` | `state.json` (with `calc` per measure) + `data/` | `html/<page>.html`: self-contained interactive page (slicers, cross-filter, tooltips, live titles); prints every measure unfiltered for reconciliation. `--sample [rows]` = the **mockup**: same page with generated sample data in `mockups/` (never reads `data/`; TBD measures show `TBD`) |
| `reconcile.js` | `--project <folder> [--page <id>] [--port <n>]` | Runs every page measure as DAX against the model open in Desktop (local Analysis Services, Desktop's own ADOMD client; Windows) and compares with `build-html.js --values`; writes `docs/validations/reconcile-<date>.md`; exit 1 on a numeric difference |
| `refresh.js` | `--project <folder> [--no-html] [--desktop] [--no-write]` | New data (e.g. monthly): checks `data/` against the model (missing file/column and duplicate dimension keys block; type errors, orphan keys, new blanks, fewer rows warn), reports rows, date range and new months vs. the last refresh, rebuilds the HTML; `--desktop` also refreshes Desktop and runs `reconcile.js`. Writes `docs/validations/refresh-<date>.md` + `refresh-log.json` |
| `lib/read-data.js` · `lib/html-engine.js` · `lib/html-ui.js` · `lib/dax-query.ps1` | — | Shared readers (xlsx/csv/json) · measure engine (Node + browser) · browser runtime · DAX runner for reconcile.js |

## Rules

1. **Derive, then confirm.** Run the intake scripts on everything shared before asking anything.
   Ask ONE batched message with only what cannot be derived: metric definitions and exclusions,
   polarity, fact grain, ambiguous dates, low-confidence design roles, infeasible mockup items.
2. **state.json is the source of truth.** Change it first, then regenerate mockup and pages.
   Pages listed in it are owned by `build-pbir.js` — never hand-edit them in Desktop.
3. **Never invent business context.** Proposed measures are technical aggregations marked
   `PROPOSED`/`TBD`; they become definitions only after the user confirms.
4. **Parameters, not paths.** Every location (`SourcePath`, `Server`, `Database`) is an M
   parameter; switching sample → file → DEV → PROD never touches measures or pages.
5. **Only Power BI–feasible design.** Map the mockup with `references/feasibility.md`; record
   substitutes in `pbiNotFeasible`.
6. **Never hand-write the PBIP shell.** The user saves an empty PBIP from Power BI Desktop once.
7. **No secrets or real data in git.** Credentials stay in Desktop/Service; data stays in
   `data/` (git-ignored) or outside the repo.
8. **Enterprise** projects also complete `references/enterprise.md`.

## Pipeline

| # | Phase | How | Read |
|---|---|---|---|
| 0 | Project skeleton | `init-project.js` (or the repo's `/new-project`) | `references/intake.md` §0 |
| 1–3 | Intake: design + data + first spec | **`intake.js`** (one command), then open `intake/generated/INTAKE.md` | `references/intake.md` §1–3 |
| 3b | Match the shared image/mockup **exactly** | Claude looks at every shared image/HTML and rewrites `state.json` pages block by block; font from the image | `references/intake.md` §4, `references/feasibility.md` |
| 3c | One confirmation round | Everything in `INTAKE.md → To confirm` + definitions, exclusions, polarity, grain | `references/intake.md` §5 |
| 4 | Mockup | `build-html.js --sample` → `mockups/<page>.html` (same layout and engine as phase 7b, sample data) → screenshot → fix state.json → repeat | `references/mockup.md` |
| 5 | Empty PBIP | **User**: Desktop → *Save as → Power BI Project* into the project folder | — |
| 6 | Model | **`build-model.js --write`** writes the TMDL from state.json (partitions from `queries.pq`, tables/types/hidden from `model-plan.json`, relationships, marked `Dim Date`, measures with `dax`), then `pbi-desktop.js --fresh` loads it. The modeling MCP is optional: use it to test DAX against the open model, then `--import` the result. `build-model.js --check` = 0 drift before commit | `references/state-schema.md` (model as code), `semantic-model-authoring` skill |
| 7 | Pages | `build-pbir.js` → `powerbi-report-author validate` → Desktop status/reload → screenshot → review → fix state.json → repeat | `powerbi-report-cli` skill (authoring) |
| 7b | Interactive HTML | `build-html.js` → `reconcile.js` (HTML numbers = Power BI DAX) → open/screenshot → fix state.json → repeat. Output holds real data: never commit/publish without the user's OK | `references/state-schema.md` (calc, slicers) |
| 8 | Verify & hand over | `reconcile.js` + totals vs. the source (`docs/validations/`), `build-model.js --check`, model review, update `state.md`/`decisions.md`, commit; publish only on request | checklist below, `references/enterprise.md` |
| 9 | New data (each period) | `refresh.js` (check → HTML) → `refresh.js --desktop` (Desktop refresh + reconcile) → `state.md`; command `/refresh` | `.claude/commands/refresh.md` |

Commands (phase 7):
```
node <skill>/scripts/build-pbir.js --state <project>/state.json --report <project>/<name>.Report [--page <id>]
powerbi-report-author validate <project>/<name>.Report
```
Fix every validation error and every generator warning (`Measure not found` means phase 6 is
incomplete). If Desktop reports unsaved changes, ask the user to close it **without saving** and
reopen the `.pbip` before reloading.

## Done checklist

- [ ] Intake outputs reviewed; every `toConfirm` item answered or listed as a blocker in `state.md`
- [ ] Every number has a reference (PY / target / budget) and a status color where the design asks
- [ ] Every title states the insight (measure-driven when it depends on data)
- [ ] Totals reconcile with the source (evidence in `docs/validations/`)
- [ ] `validate` = 0 errors; generator = 0 warnings; screenshots reviewed after the last change
- [ ] Data locations are parameters; no credentials or real data in git
- [ ] Enterprise: `references/enterprise.md` complete

## Limits

- Generator item types: `kpi` (+ sparkline), `kpiGroup` (+ highlight fill, grid; `panel` = dark band
  + soft body, `panel.split`), `chart` (column/bar/line/area/combo/donut/pie, `seriesBy`, per-value
  `colors`, `dataLabels`, `valueAxis: false`; donut `legendItems` + `center`/`centerCaption`),
  `rings` (gauge per value, or `style: "ring"` = progress ring per value + `caption`), `table`
  (`topN` + `topBy`, `columns[].width`), `text`; any card takes `meta` (right of the title);
  sidebar `logo`, `navTop`, `activeFill`; page `slicers` become header dropdowns.
- Desktop draws the donut total in the hole (`centerValue`): the generator turns it off.
- `build-html.js` computes measures from `calc` specs, not from DAX: when a DAX measure changes, update
  its `calc` too and re-check that both print the same numbers. One fact table (optionally `combine`d
  from several files, with Power Query columns as `derivedColumns[].calc`); Dim Date columns are
  derived from the fact date; other dimensions are joined through `model.relationships`; disconnected
  tables carry static `rows`. Renders kpi (+ sparkline), kpiGroup, chart (incl. donut, `seriesBy`), rings, table, text.
  Slicers, maps, matrices, what-if sliders, bookmarks and working navigation are authored with
  powerbi-report-cli on pages not owned by state.json (or by extending the generator).
- Images: PNG is read pixel-exact (colors, sidebar, header, scale). JPG/WEBP: ask for a PNG export
  (or read layout visually only). The layout itself (which KPIs/charts/tables) is always mapped by
  Claude looking at the image — the script gives exact values, Claude gives structure.
- Claude Design (claude.ai/design) exports (zip/HTML) work as design input: unzip into `intake/`.
- DB intake uses a schema export (no row stats); volumes and uniqueness are confirmed with the user.
- Model culture (number separators) is fixed when Desktop creates the file.
