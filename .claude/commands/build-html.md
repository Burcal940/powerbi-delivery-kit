---
description: Generate the interactive HTML twin of a project's Power BI pages (pbi-delivery phase 7b)
argument-hint: <project-name> [page-id]
---

Build the interactive HTML for a project. Arguments: `$ARGUMENTS` (project, optional page id).

1. Read the `pbi-delivery` skill (SKILL.md + `references/state-schema.md` → `calc`, `slicers`).
2. Preconditions: `projects/<name>/state.json` approved; real data in `projects/<name>/data/`.
   Every measure used on the page needs a `calc` equivalent to its DAX (read the TMDL in
   `*.SemanticModel/definition/tables/_Measures.tmdl` if it exists). Never invent a rule — if the
   DAX/definition is unclear, write `TBD — ask:` and stop.
3. Run:
   ```
   node .claude/skills/pbi-delivery/scripts/build-html.js --state projects/<name>/state.json [--page <id>]
   ```
   Fix every ERROR and warning. The printed unfiltered values must equal the Power BI
   reconciliation in `docs/validations/` — if they differ, the `calc` (or the DAX) is wrong.
4. Screenshot with headless Edge (`msedge --headless=new --window-size=1920,1080 --screenshot=<scratchpad>/x.png file:///…`)
   and compare with the mockup and the Power BI screenshot. Fix in `state.json`, regenerate, repeat.
5. Tell the user the file path. The HTML embeds real data: `projects/*/html/` is git-ignored; do not
   publish or share it unless the user asks.
6. Update `state.md` and log non-obvious choices in `decisions.md`.
