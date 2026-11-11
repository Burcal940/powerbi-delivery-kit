# Default conventions

Used when the repo's root `CLAUDE.md` defines none (a repo's own table always wins).

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

Repo hygiene: never commit `cache.abf`, `.pbi/localSettings.json`, `unappliedChanges.json`, real
data (`projects/*/data/`), generated HTML with real data (`projects/*/html/`), the data profile
with sample values (`intake/generated/profile.json`) or credentials.
Save reports as PBIP, never `.pbix`.
