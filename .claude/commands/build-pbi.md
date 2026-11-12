---
description: Build the Power BI model and pages from a project's state.json (pbi-delivery phases 6–8)
argument-hint: <project-name> [page-id]
---

Build or update the Power BI report for a project. Arguments: `$ARGUMENTS`.

Read the `pbi-delivery` skill first; it routes to `semantic-model-authoring` (model) and
`powerbi-report-cli` (pages, validation, preview). Follow their rules.

1. **Preconditions.** `projects/<name>/state.json` approved; `projects/<name>/*.pbip` exists
   (saved by Desktop — if not, ask the user to save an empty PBIP there and stop).
2. **Model (only what changed) — as code.** Put every model change in `state.json` first
   (`dax` per measure, `derivedColumns[].m`, `dropColumns`, `rows`; see `state-schema.md` → Model as code).
   Model built earlier by hand or with the MCP and `state.json` has no `dax` yet → run `--import` once.
   ```
   node .claude/skills/pbi-delivery/scripts/build-model.js --project projects/<name> --write
   ```
   Resolve every warning (measure without `dax`, derived column without `m`). It refuses to drop
   what is on disk but not in `state.json`; add `--prune` only when that removal is intended.
   The Modeling MCP is optional: use it to try DAX against the open model and verify key numbers,
   then `--import` so `state.json` keeps the result. Finish with `--check` = 0 differences.
   Commit as `<name>: model …`.
3. **Pages.**
   ```
   node .claude/skills/pbi-delivery/scripts/build-pbir.js --state projects/<name>/state.json --report projects/<name>/<name>.Report [--page <id>]
   powerbi-report-author validate projects/<name>/<name>.Report
   ```
   Resolve every error and every generator warning (`Measure not found`, missing DS colors).
4. **Preview loop.** Desktop reads the PBIP folder only when it opens it, so after changing TMDL or
   PBIR, reopen it:
   ```
   node .claude/skills/pbi-delivery/scripts/pbi-desktop.js --project projects/<name> --fresh --screenshot <scratch>/<page>.png
   ```
   This opens the `.pbip` or closes it **without saving** and reopens it, waits until it is ready,
   refreshes the data (Home → Refresh) and saves a screenshot. It gives up after `--timeout`
   (600 s) and reopens once by itself if the preview host is lost. Warn the user first: unsaved
   changes made by hand in Desktop are lost. If Desktop shows an error dialog, the script prints
   its text: fix the TMDL/M from it. Compare the screenshot with `mockups/<page>.html`, block by block, and with
   `screenshot-review.md`. Fix `state.json`, regenerate and repeat. Delete the temporary
   screenshots at the end.
5. **Verify.** Reconcile totals into `docs/validations/`; run `model-reviewer`; enterprise →
   `pbi-delivery/references/enterprise.md`.
6. **Close.** Update `state.md`, log non-obvious choices in `decisions.md`, commit as
   `<name>: build <page-id> in Power BI`. Publish only if the user explicitly asks.
