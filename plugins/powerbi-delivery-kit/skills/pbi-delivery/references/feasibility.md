# Mockup → Power BI feasibility

Design the mockup only with elements Power BI can render. When an element is not feasible,
choose the substitute here and record it in `state.json → pbiNotFeasible`.

| Mockup element | Power BI equivalent | Status |
|---|---|---|
| KPI tile: label, value, reference line | `cardVisual` + text measure for the reference (`_Delta Label …`) | ✅ generator `kpi` |
| Status-colored delta | Hex-color measure (`_Status Color …`) bound to font color | ✅ generator `status` |
| Hero card with several values | Several `cardVisual`s on one tile | ✅ generator `kpiGroup` |
| Insight title that changes with data | Text measure (`_Headline …`) bound to title / card | ✅ `titleMeasure`, `headline.measure` |
| Column / bar / line / area / stacked | Native charts | ✅ generator `chart` |
| Colors exactly as in a reference image | Hex read from the PNG pixels (`read-image.js`) | ✅ intake |
| Actual vs cap/target line | Combo chart: columns + line on shared axis | ✅ `lineClusteredColumnComboChart` |
| Table with totals | `tableEx` | ✅ generator `table` |
| Inline progress bar in a table cell | Data bars (conditional formatting) | ⚠️ powerbi-report-cli |
| Status badge in a table | Background color / icon conditional formatting | ⚠️ powerbi-report-cli |
| Slider that recalculates | What-if (numeric range) parameter + measure | ⚠️ model + slicer, by hand |
| Toggle between two views/metrics | Field parameter or bookmarks + buttons | ⚠️ powerbi-report-cli |
| Dropdown / date filter | Slicer | ⚠️ powerbi-report-cli |
| Drill to detail | Drillthrough page | ⚠️ powerbi-report-cli |
| Rich tooltip | Tooltip page | ⚠️ powerbi-report-cli |
| Vertical "today" / reference line | Constant or measure reference line | ⚠️ powerbi-report-cli |
| Sidebar navigation that works | Page-navigation buttons | ⚠️ powerbi-report-cli |
| Projected months hatched | — | ❌ use lighter shade / transparency |
| Arrows or callouts anchored to data points | — (only static textboxes) | ❌ use the insight title instead |
| Animation, custom hover, free HTML | — | ❌ |
| Fonts not installed on viewer machines | Falls back silently | ❌ always declare a fallback |

✅ built by `scripts/build-pbir.js` · ⚠️ feasible, authored with powerbi-report-cli / the model ·
❌ not feasible.
