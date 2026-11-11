# Mockup (phase 4)

Produce one self-contained HTML per page at `projects/<name>/mockups/<page-id>.html`, rendered
from `state.json` with the client design system. Its job is fast visual iteration with the user;
it must stay translatable 1:1 to Power BI.

## Steps
1. Read the client design system (tokens, components, README / design-system skill) and the page
   in `state.json`. Use DS tokens by name (`var(--…)`); never new hex values or fonts.
2. Fixed canvas from `state.canvas` (default 1920×1080), no scroll, same shell and the same layout
   math as `references/state-schema.md` so positions match the Power BI page.
3. Numbers come from `sampleData` (or a real extract) and must equal what the model will return —
   compute them in JS from the same rows, don't type them.
4. Only elements listed ✅/⚠️ in `references/feasibility.md`. Put ❌ ideas in `pbiNotFeasible`.
5. Deliver: one line naming the page and layout, then the file. If the user wants to share it,
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
Change `state.json` first, then the single affected HTML (micro-edits; never regenerate a whole
page for a small change). Once approved, phases 5–7 build the same page in Power BI.
