# Intake — derive everything from what the user shares

Goal: the user only shares material and answers one batched question round. Scripts derive exact
values; Claude maps structure. Scripts live in `../scripts/` (Node 20+, no dependencies).

## 0. Create the project (any repo)
```
node <skill>/scripts/init-project.js --root <repo> --name "<Project Name>"
```
Creates `projects/<name>/` (or `<name>/` if the repo has no `projects/`) with `intake/`,
`mockups/`, `data/` (git-ignored), `docs/validations/`, `tests/`, `brief.md`,
`data-contract.md`, `state.md`, `decisions.md`. Never overwrites. In a monorepo with
`/new-project`, that command does the same plus the question round.

## 1. Tell the user where to put things (exact message)
> Deja en `projects/<name>/intake/` todo lo de diseño que tengas: la imagen PNG del dashboard de
> referencia, el HTML o artefacto exportado (de Claude Design: descomprime el zip ahí), archivos CSS
> o la paleta JSON. Deja los datos en `projects/<name>/data/` (Excel, CSV o JSON). Si es una base de
> datos, dame servidor, base y el CSV del esquema (consulta abajo). Nada de esto se sube a git si es dato real.

## 2. Run the whole intake (one command)
```
node <skill>/scripts/intake.js --project projects/<name> --brand "<Brand>"
# database instead of files:
node <skill>/scripts/intake.js --project projects/<name> --brand "<Brand>" \
     --schema <columns.csv> --source sqlserver|postgresql|mysql|snowflake|oracle --server <host> --database <db>
```
It decides what to run from what exists, and never touches what the user shared:

| Found | Runs | Produces in `intake/generated/` |
|---|---|---|
| `*.png` in `intake/` | `read-image.js` | `image-<name>.css` (exact pixel colors by role, sidebar width, header height, canvas scale) + `image-<name>.json` |
| `*.html`, `*.css`, `*.json`, folders in `intake/` (+ the image CSS) | `extract-design.js` → `make-theme.js` | `design-tokens.json`, `theme.json` |
| files in `data/` or `--schema` | `profile-data.js` | `model-plan.json`, `queries.pq`, `data-contract.draft.md`, `profile.json` |
| tokens and/or plan | `draft-state.js` | `../../state.json` (or `state.draft.json` if one exists) |
| always | — | `INTAKE.md`: what was derived, **To confirm**, **Claude must still do** |

Precedence when several design sources exist: tokens defined in code (CSS variables, theme JSON)
win; image pixels fill the gaps; color frequency is the last resort. Every value keeps its evidence.

Non-PNG images (JPG, WEBP…) and zips are listed in `INTAKE.md` with the exact fix (save as PNG / unzip).

### Database schema export (save as CSV with these four headers)
| Engine | Query |
|---|---|
| SQL Server / Azure SQL / Fabric SQL / PostgreSQL / MySQL | `SELECT table_schema, table_name, column_name, data_type FROM information_schema.columns WHERE table_schema NOT IN ('information_schema','pg_catalog','sys') ORDER BY 1,2,ordinal_position;` |
| Snowflake | same query, inside the target database (`USE DATABASE …`) |
| Oracle | `SELECT owner AS table_schema, table_name, column_name, data_type FROM all_tab_columns WHERE owner = '<SCHEMA>' ORDER BY 1,2,column_id;` |

Export only the views/tables the report needs. Schema-only intake infers keys from names
(`employee_id` in `employees`) and lists volumes/uniqueness to confirm. Credentials never go through Claude.

## 3. What the scripts guarantee (and what they don't)
- **Exact:** hex colors read from pixels or code, sidebar width, header height, canvas scale
  (snapped to the 4px grid), column types, keys, relationships, date range, culture per column.
- **Proposed (to confirm):** technical measures (`PROPOSED: SUM(...)`), fact grain, KPI order.
- **Not derivable — always asked:** business definitions, exclusions, polarity, targets.
- **Done by Claude, not scripts:** the page structure and the font (§4).

## 4. Make the pages match the shared image/mockup exactly (Claude — mandatory when one was shared)
Open each shared image (Read tool) or HTML, then rewrite `state.json → pages` block by block:

1. **Shell:** sidebar present? its items (labels in order) and which one is active → `shell.sidebar`;
   header title, headline sentence, right-side tag → `title`, `headline`, `tag`. Font family → `designSystem.font`.
2. **Rows top to bottom:** for each band measure its height relative to the image and its blocks'
   widths → `rows[].height` (scale with `image-<name>.json → scale`) and `items[].span`.
3. **Each block → item** (see `feasibility.md`):
   - KPI card with one value → `kpi`; card with several values → `kpiGroup`; comparison text under
     the value → `reference` measure (`_Delta Label …`) and its color → `status` measure.
   - Chart → `chart` with the matching `visual`: vertical bars `clusteredColumnChart`/`columnChart`
     (stacked), horizontal `clusteredBarChart`/`barChart`, lines `lineChart`, filled area
     `areaChart`, bars + line `lineClusteredColumnComboChart`. Axis → `category`; each colored
     series → `series[]` with the **exact hex from the image**; legend labels → `label`.
   - Table → `table` with its columns in order.
   - Search boxes, sliders, dropdowns, buttons, selected-card highlight, hatching, callouts →
     `pbiNotFeasible` with the substitute (slicers/bookmarks via powerbi-report-cli).
4. **Bind to data:** labels → measures from the model plan (new measure entries carry the label's
   meaning as `definition`, or `TBD — ask`); axes → `Table[Column]` (dates → `Dim Date[Month|Year|Quarter]`).
5. **Titles:** keep the image's titles; data-dependent sentences become `_Headline …` measures.
6. **Numbers:** copy every number visible in the image into `docs/validations/mockup-numbers.md`
   so phase 6 can check whether the real data should reproduce them.
7. Run `build-pbir.js` + `validate` and, after phase 6, compare the Power BI screenshot with the
   image side by side; fix `state.json` until the structure matches.

## 5. Confirm (one message)
Send the user ONE message: every unchecked item in `INTAKE.md → To confirm` + metric definitions,
exclusions, polarity, grain + `pbiNotFeasible`. Record answers in `data-contract.md`, `state.json`,
`decisions.md`; tick `INTAKE.md`. Then mockup (phase 4) and Power BI (phases 5–7).
