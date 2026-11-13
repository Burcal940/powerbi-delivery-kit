# Mockup (phase 4)

One HTML per page at `projects/<name>/mockups/<page-id>.html`, **generated** from `state.json`:

```
node <skill>/scripts/build-html.js --state <project>/state.json --sample [rows] [--page <id>]
```

It is the same generator as the interactive HTML of phase 7b (same layout math as `build-pbir.js`,
same measure engine, slicers, cross-filter and tooltips) with **sample data** instead of `data/`.
So mockup, HTML and Power BI page share one layout, and an approved mockup is already the final page.

## How the sample data is made
- Only from `state.json` and the model plan (`intake.plan`): column types, numeric min/max, distinct counts.
  `data/` is never read, so the mockup holds no real data and can be committed or shared.
- Text values named in `state.json` (page `filters`, calc `where`, slicer `labels`) are always present,
  so filtered pages are not empty. Other values are generic (`Category 1`, `Category 2`…).
- Dates cover two years: the year of the page filter (or the plan's last year) and the one before it,
  so PY / YoY measures show.
- Deterministic: same `state.json` → same file. `--sample 5000` changes the fact row count (default 2000).
- The header tag adds "Datos de ejemplo" / "Sample data" (by `locale`).
- A measure without `calc` (definition still TBD) shows `TBD`; `_Status…` measures stay neutral.
  The warnings list them: they are the questions still open.

## Steps
1. Make the page right in `state.json` (layout, titles, measures, slicers). Use DS tokens only.
2. Run the command, screenshot, review. Fix `state.json`, never the HTML. Repeat.
3. Only elements listed ✅/⚠️ in `references/feasibility.md`. Put ❌ ideas in `pbiNotFeasible`.
4. Deliver: one line naming the page and layout, then the file. If the user wants to share it,
   publish it as an artifact.

## Content rules (all clients)
- **KPI card:** label · big value · reference (vs PY / target / budget). No naked numbers.
  Color only the delta: positive / negative token; for costs, up = negative.
- **Titles state the insight** ("Travel costs 18% over budget"), not the field ("Expenses").
- **Chart choice:** time → line or columns · categories → bars (horizontal if labels are long) ·
  part of whole → stacked bars or donut ≤ 4 slices · ranking → sorted bars · actual vs target →
  bars + target line. Avoid 3D, pies > 4 slices, dual axes without reason, > 2 saturated series.
- **Tables** full width at the bottom, sorted by value, numbers right-aligned, deltas colored.
- Missing value = "—", never 0. Units per the DS (e.g. `1,275 M USD`, `256.2K`, `87%`).

## Iterating
Change `state.json` first, then re-run the command (it is fast and deterministic). Once approved,
phases 5–7 build the same page in Power BI and the same HTML with real data.
