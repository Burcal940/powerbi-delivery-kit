---
description: Scaffold a new Power BI project from _template/ into projects/<name>/ (pbi-delivery phases 1–3)
argument-hint: <project-name>
---

> `<pbi-delivery>` = the folder of this plugin's `pbi-delivery` skill (its base directory is shown when the skill loads).

Create a new project in this monorepo following the `pbi-delivery` skill (read its SKILL.md first).
Project name argument: `$ARGUMENTS`

1. **Name.** If `$ARGUMENTS` is empty, ask for the project name. Normalize it to `kebab-case`.
   If `projects/<name>/` already exists, stop and tell the user — never overwrite.
2. **Copy.** If the repo has `_template/`, copy it recursively to `projects/<name>/`. Otherwise
   (any other repo) run `node <pbi-delivery>/scripts/init-project.js --root . --name <name>`,
   which creates the same skeleton from the skill's `templates/` and adds the git-ignore rules.
   Then run `git init` inside `projects/<name>/`: every project is its own repo (the kit ignores
   `projects/*`); its `.gitignore` keeps out `cache.abf`, local settings, `data/` and `html/`.
3. **Intake first — derive before asking** (`pbi-delivery/references/intake.md`). Ask the user to
   share what they have — image PNG, HTML/artifact or Claude Design export, CSS/palette, data files
   or a DB schema export — into `projects/<name>/intake/` and `projects/<name>/data/` (exact message
   in intake.md §1). Then run ONE command:
   `node <pbi-delivery>/scripts/intake.js --project projects/<name> --brand "<Brand>"`
   (add `--schema … --source … --server … --database …` for a database), open
   `intake/generated/INTAKE.md`, and do every item under "Claude must still do" — above all,
   reshape `state.json` pages to match the shared image/mockup exactly (intake.md §4).
4. **Ask in ONE message** only what the intake could not derive (its `toConfirm` list) plus the
   business questions below (use `brief.md` as the checklist), and wait for answers:
   - Decision the report supports and its audience (personal / team / enterprise).
   - Pages (name + id) and the question each answers.
   - KPIs: formula, exclusions, reference (PY / target / budget), polarity (is up good?).
   - Data: source type and location (Excel, CSV folder, SQL, SharePoint, Fabric…), grain of each
     fact, refresh, owner; start on sample data or real?
   - Stakeholders: owner, users, numbers sign-off.
   - Design system (client skill) and any reference mockup/image.
5. **Fill** `CLAUDE.md`, `brief.md` and `data-contract.md` (start from `intake/data-contract.draft.md`) with the answers.
   - Missing, circular or ambiguous → `TBD — ask: <the specific question>`. Never fill a gap with a
     plausible default. Metric exclusions, grain and polarity matter most.
   - Enterprise audience → also apply `pbi-delivery/references/enterprise.md` (owners, gateway,
     RLS, environments) and list its open items as TBD.
6. **Finalize `state.json`** (the intake draft, or from the brief if nothing was shared —
   `pbi-delivery/references/state-schema.md`): confirmed measure definitions, pages matching the
   shared mockup, `sampleData` if data is not real yet. Show it and ask for approval.
7. **state.md** — status `setup — spec drafted, awaiting approval`, today's date, every
   `TBD — ask` copied into Blockers, next step `/build-mockup <name>`.
8. **decisions.md** — create it (intentionally not in `_template/`) with a first dated entry:

   ```markdown
   # Decisions — <name>

   ## YYYY-MM-DD — Project created
   - Scaffolded from `_template/` via `/new-project`.
   - Context: <one line from the business goal>.
   ```
9. **Remove** `.gitkeep` files only where real files now exist.
10. **Remind** the user that before `/build-pbi` they must, once: set Desktop regional settings if
   number format matters, then *File → Save as → Power BI Project (.pbip)* into `projects/<name>/`.
11. **Commit** as `<name>: scaffold project`. Show the filled `CLAUDE.md` and the `state.json` draft.
