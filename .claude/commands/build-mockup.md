---
description: Render a project's state.json as HTML mockups (pbi-delivery phase 4)
argument-hint: <project-name> [page-id]
---

Build the HTML mockup(s) for a project. Arguments: `$ARGUMENTS` (project, optional page id).

1. Read the `pbi-delivery` skill (SKILL.md + `references/mockup.md` + `references/feasibility.md`).
2. Read `projects/<name>/state.json`, `brief.md`, and the client design system named in
   `state.designSystem` (its skill and token files). Stop if `state.json` is not approved yet
   (see `state.md`) — ask for approval first.
3. For each page (or only `page-id`): write `projects/<name>/mockups/<page-id>.html` — one
   self-contained file, DS tokens only, fixed canvas, same layout math and numbers as state.json
   (compute numbers from `sampleData` in JS).
4. Anything not feasible in Power BI → add to `state.pbiNotFeasible` with its substitute; do not
   draw it.
5. Open/preview the file; check nothing is clipped, every number has a reference, every title is
   an insight. If the user wants to share it, publish it as an artifact.
6. Update `state.md` (next step: approve mockup → `/build-pbi <name>`) and commit as
   `<name>: mockup <page-id>`.
