# Test fixtures (fictional)

Used only by `tests/run.js`. Nothing here is a client project or real data.

- `demo-sales/` — a fictional project as the user would share it: design tokens in `intake/`, two
  CSV files in `data/` (240 order lines, 6 products, 2024–2025, generated deterministically), and the
  `state.json` that Claude would hold after the confirmation round (measures with `calc`/`dax`, two
  pages, a static band table, a page filter).
- `empty-pbip/` — a copy of the shell that Power BI Desktop writes on *Save as → Power BI Project*
  for an empty report, neutralized (placeholder ids, en-US). It stands in for that manual step so
  `build-model.js` and `build-pbir.js` can run in CI. Real projects never use it: the hard rule
  "never hand-write PBIP scaffolding" still applies to every project.
