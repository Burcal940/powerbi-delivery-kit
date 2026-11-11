# Power BI Delivery Kit

Shared instructions for every Power BI project built with this kit (any client, personal or
enterprise). Project-specific context (goal, metrics, grain, stakeholders) lives in each
`projects/<name>/CLAUDE.md`, which is read in addition to this file. Human step-by-step: `PLAYBOOK.md`.

## Placement rule

- **Changes per project** → `projects/<name>/`. Each project is its **own git repo**: the kit repo
  ignores `projects/*`, so client names, data paths and business context never reach the kit.
- **Changes to the method** → repo root (this file, `.claude/`), kept client-neutral. Client looks
  go in `design-systems/<client>/` only inside a client's own copy, never in the kit.
- **Third-party tooling** → vendored into `.claude/` so a fresh clone works. See `.claude/common/VENDORED.md`.

## Repository structure

```
CLAUDE.md                         # This file — shared conventions and workflow
PLAYBOOK.md                       # Step-by-step for any new project (human-readable)
.mcp.json                         # Power BI Modeling MCP (local Power BI Desktop)
.claude/
├── settings.json
├── commands/                     # /new-project · /build-mockup · /build-pbi · /build-html · /status · /setup
├── agents/model-reviewer.md      # Reviews a semantic model: star schema, naming, measures
├── common/                       # VENDORED (Microsoft powerbi-authoring) — shared refs, LICENSE
└── skills/
    ├── pbi-delivery/             # Method + scripts: shared design/data → spec → mockup + Power BI
    ├── semantic-model-authoring/ # VENDORED — model / DAX / TMDL (do not hand-edit)
    └── powerbi-report-cli/       # VENDORED — PBIR authoring, validation, preview (do not hand-edit)
tools/build-plugin.js             # Packages .claude/ as a plugin (run after changing .claude/)
plugins/powerbi-delivery-kit/     # GENERATED plugin — never edit; source is .claude/
.claude-plugin/marketplace.json   # GENERATED — lets /plugin marketplace add <this repo> install it
_template/                        # Copied by /new-project — never edit a project through it
projects/<name>/
├── CLAUDE.md · brief.md · data-contract.md · state.json · state.md · decisions.md
├── intake/                       # What the user shares (PNG, HTML, CSS, zips) → intake/generated/
├── data/                         # Real data files — git-ignored
├── mockups/<page-id>.html
├── html/<page-id>.html           # Interactive twin (build-html.js) — embeds real data, git-ignored
├── docs/validations/ · tests/
└── <PBIP files>                  # Saved by Power BI Desktop
```

## Hard rules

- **Never hand-write `.pbip`, `*.SemanticModel/` or `*.Report/` scaffolding.** Power BI Desktop
  creates them (*File → Save as → Power BI Project*); edit only via TMDL / PBIR / the modeling MCP.
- **Never invent business context.** Definitions, exclusions, grain, polarity and brand values
  come from the user or from shared material. Unknowns: `TBD — ask: <question>`, listed in `state.md`.
- **Derive before asking:** run the intake on everything shared, then ask ONE batched question round.
- `state.json` owns the pages it lists — change it first, never hand-edit those pages in Desktop.
  While Claude edits files, do not save from Desktop.
- Never commit `cache.abf`, `.pbi/localSettings.json`, `unappliedChanges.json`, real data
  (`projects/*/data/`) or credentials. Save reports as **PBIP**, never `.pbix`.

## Naming conventions

| Object | Convention | Example |
|---|---|---|
| Project folder | `kebab-case` | `projects/sales-performance/` |
| Fact tables | `Fact <Process>` | `Fact Sales` |
| Dimension tables | `Dim <Entity>` | `Dim Customer`, `Dim Date` |
| Measure tables | `_Measures` | `_Measures` |
| Measures | Business name, Title Case | `Net Revenue`, `Gross Margin %` |
| Time-intel measures | `<Base> <Modifier>` | `Net Revenue PY`, `Net Revenue YoY %` |
| Helper measures | Prefix `_`, hidden | `_Status Color Net Revenue`, `_Headline Overview` |
| Columns | Business name, Title Case | `Order Date` |
| Keys | `<Entity> Key`, hidden | `Customer Key` |
| Report pages | Short, reader-facing | `Overview`, `Customer Detail` |

Modeling defaults: star schema, single-direction relationships dimension → fact, a marked
`Dim Date`, explicit measures only, keys hidden, every data location an M parameter.

## Standard workflow (skill `pbi-delivery`)

1. `/new-project <name>` → user drops design material in `intake/` and data in `data/` →
   `intake.js` derives tokens, theme, data contract, M with parameters and `state.json` →
   Claude matches pages to the shared image/mockup → ONE confirmation round.
2. `/build-mockup <name>` → HTML mockup from `state.json`.
3. User saves an empty PBIP from Power BI Desktop into `projects/<name>/` (commit it alone).
4. `/build-pbi <name>` → model via MCP, pages via generator, validate → reload → screenshot → review.
5. `/build-html <name>` → interactive HTML from the same `state.json` + real data; its printed
   numbers must equal the Power BI reconciliation.
6. Reconcile numbers (`docs/validations/`), run `model-reviewer`, update `state.md` / `decisions.md`.

## Commit hygiene

One change → one commit. Kit repo: subjects start with `repo:`. Project repos: project name in the
subject (`sales-performance: add Net Revenue YoY %`); files saved by Desktop are committed separately.
Never commit personal data to the kit (names, emails, local paths): use the GitHub no-reply email.

## Design system

The client's design comes from what is shared per project (image, HTML, CSS, palette) through the
intake. If one look is reused across projects, save its `design-tokens.json` and `theme.json` in
`design-systems/<name>/` and pass that folder to the intake of every new project.
