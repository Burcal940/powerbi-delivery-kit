---
description: Load new data into a delivered project (e.g. the monthly file) — check, rebuild, reconcile
argument-hint: <project-name>
---

New data for an existing project. Argument: `$ARGUMENTS` (project name).

1. Read the `pbi-delivery` skill. Preconditions: `projects/<name>/state.json` and the intake model
   plan exist. The user has put the new file(s) in `projects/<name>/data/` — added next to the old
   ones when the fact table combines a folder (`combine: true`), or replacing the file otherwise.
   If nothing is new in `data/`, ask the user where the new file is. Never move or delete their files.
2. Check the data and rebuild the HTML:
   ```
   node .claude/skills/pbi-delivery/scripts/refresh.js --project projects/<name>
   ```
   - **Blocking** (exit 1, nothing else runs): a missing file, a column the model reads is missing
     or renamed, duplicate keys in a dimension. Show the user the exact file/column and ask how to
     proceed: fix the file, or change the model (`state.json` → `build-model.js --write`). Never
     rename the user's columns or drop rows yourself.
   - **Warnings** (text in a number/date column, keys missing from a dimension, new blanks, fewer
     rows than last time): show them in one message and ask whether they are expected. Do not
     invent a rule to clean them; a cleaning step needs the user's definition (`decisions.md`).
   - `newMonths` empty when new data was expected → the file is probably the old one: ask.
3. Power BI (Windows, Desktop available): tell the user Desktop will reload, and that unsaved
   changes in Desktop are lost. Then:
   ```
   node .claude/skills/pbi-delivery/scripts/refresh.js --project projects/<name> --desktop
   ```
   It refreshes Desktop and runs `reconcile.js`: HTML and Power BI must agree (evidence in
   `docs/validations/reconcile-<date>.md`). A difference after new data usually means a measure's
   `calc` or DAX does not handle a new case (a new category, blanks): fix `state.json`, never by hand.
   Take a screenshot (`pbi-desktop.js --screenshot`) and check titles/headlines read correctly with
   the new month.
4. Update `state.md` (data through `<last date>`, refresh date, open warnings) and `state.json`
   `dataStatus` if it changed (e.g. `sample` → `real`). Log in `decisions.md` any answer the user
   gave about warnings.
5. Commit in the project repo: `<name>: data refresh through <YYYY-MM>` with
   `docs/validations/refresh-*.md`, `refresh-log.json`, `reconcile-*.md` and `state.md`.
   Never commit `data/` or `html/`. Publishing to the Service only on explicit request.
6. Tell the user: rows and months added, warnings and their answers, reconcile result, and where the
   updated HTML is.
