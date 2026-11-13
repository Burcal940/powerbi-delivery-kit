---
description: Render a project's state.json as HTML mockups with sample data (pbi-delivery phase 4)
argument-hint: <project-name> [page-id]
---

> `<pbi-delivery>` = the folder of this plugin's `pbi-delivery` skill (its base directory is shown when the skill loads).

Build the HTML mockup(s) for a project. Arguments: `$ARGUMENTS` (project, optional page id).

The mockup is generated, not hand-written: `build-html.js --sample` renders the SAME layout, engine and
interactions as the final interactive HTML, with generated sample data. data/ is never read, so the
mockup holds no real data and is committed with the project.

1. Read the `pbi-delivery` skill (SKILL.md + `references/mockup.md` + `references/feasibility.md`).
2. Read `projects/<name>/state.json` and `brief.md`. Stop if `state.json` is not approved yet
   (see `state.md`): ask for approval first.
3. Run:
   `node <pbi-delivery>/scripts/build-html.js --state projects/<name>/state.json --sample [--page <id>]`
   → `projects/<name>/mockups/<page-id>.html`.
   - `Add "calc"` errors do not happen here: measures still TBD show `TBD`, status colors stay neutral.
     List those warnings for the user; they are the open definitions.
   - A layout problem (overlap, clipped text, wrong chart) is fixed in `state.json`, never in the HTML.
4. Anything not feasible in Power BI → add to `state.pbiNotFeasible` with its substitute; do not draw it.
5. Screenshot each page (headless Edge/Chrome) and check:
   - nothing is clipped;
   - every number has a reference;
   - every title is an insight;
   - the header says "Sample data" / "Datos de ejemplo".
   If the user wants to share it, publish it as an artifact (it has no real data).
6. Update `state.md` (next step: approve mockup → `/build-pbi <name>`) and commit as
   `<name>: mockup <page-id>`.
