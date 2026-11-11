# Data contract and source connectors

The data contract fixes **what the model needs**, not where it comes from. Write it before the
model; the model is built from it whether the data is sample, a file, or a database.
**Start from the generated draft:** `scripts/profile-data.js` writes `intake/data-contract.draft.md`,
`intake/model-plan.json` and `intake/queries.pq` from the shared files or DB schema
(see `intake.md` §2). The patterns below explain and extend what it generates.
Template: `templates/data-contract.md`. Illustration only: `projects/finance-tracker/data-contract.md` in the repo where the skill was built.

## 1. Logical tables

For each table record: name (`Fact <Process>` / `Dim <Entity>` / utility), **grain** (what one
row is), key, columns (name · type · description · nullable), source, refresh cadence, owner,
sensitivity (public / internal / confidential / personal data). Typical minimum:

- One fact per business process at its natural grain (transaction, line, snapshot day).
- A `Dim Date` (generated in M if the source has none), marked as date table.
- Dimensions for every slicer/axis; integer keys preferred.
- Utility tables for user inputs (targets, caps, budgets) instead of constants in DAX.

## 2. Parameters (always)

Every location is an M parameter so the same model points to sample, file, DEV or PROD:

```m
// named expressions (Model → Parameters)
SourcePath = "C:\Data\project" meta [IsParameterQuery=true, Type="Text", IsParameterQueryRequired=true]
Server     = "sql-dev.contoso.local" meta [IsParameterQuery=true, Type="Text", IsParameterQueryRequired=true]
Database   = "ERP" meta [IsParameterQuery=true, Type="Text", IsParameterQueryRequired=true]
```

## 3. Connector patterns (one partition per logical table)

**Sample (before real data)** — inline, same column names/types as the contract:
```m
#table(type table [Date = date, Customer Key = Int64.Type, Amount = Currency.Type],
       {{#date(2026,1,15), 1, 1200}, {#date(2026,1,20), 2, 860}})
```

**Excel workbook (one sheet or table per logical table)**
```m
let
    Book  = Excel.Workbook(File.Contents(SourcePath & "\Data.xlsx"), true),
    Sheet = Book{[Item = "Transactions", Kind = "Sheet"]}[Data],
    Typed = Table.TransformColumnTypes(Sheet, {{"Date", type date}, {"Amount", Currency.Type}})
in  Typed
```

**CSV folder (append monthly extracts)**
```m
let
    Files  = Table.SelectRows(Folder.Files(SourcePath & "\extracts"), each Text.Lower([Extension]) = ".csv"),
    Parsed = Table.AddColumn(Files, "T", each Table.PromoteHeaders(Csv.Document([Content], [Delimiter = ",", Encoding = 65001]))),
    Rows   = Table.Combine(Parsed[T]),
    Typed  = Table.TransformColumnTypes(Rows, {{"Date", type date}, {"Amount", Currency.Type}}, "en-US")
in  Typed
```

**SQL Server / Azure SQL / Fabric SQL endpoint** — prefer views owned by the data team:
```m
let Source = Sql.Database(Server, Database),
    View   = Source{[Schema = "rpt", Item = "vSales"]}[Data]
in  View
```
PostgreSQL: `PostgreSQL.Database(Server, Database)` · MySQL: `MySQL.Database(Server, Database)` ·
Oracle: `Oracle.Database(Server)` · Snowflake: `Snowflake.Databases(Server, Warehouse)` ·
Databricks: `Databricks.Catalogs(Host, HttpPath)`.

**SharePoint / OneDrive for Business file** (refreshes in the Service without a gateway)
```m
let Site  = SharePoint.Files("https://contoso.sharepoint.com/sites/Finance", [ApiVersion = 15]),
    File  = Site{[Name = "Data.xlsx", #"Folder Path" = "https://contoso.sharepoint.com/sites/Finance/Shared Documents/"]}[Content],
    Book  = Excel.Workbook(File, true)
in  Book
```

**Google Sheets**: `GoogleSheets.Contents("<sheet url>")` · **Web/API export**: `Json.Document(Web.Contents(BaseUrl, [RelativePath = "..."]))`
(credentials via Desktop, never in M).

**Fabric Lakehouse / Warehouse** — Direct Lake when the data is already in OneLake; follow the
`semantic-model-authoring` skill's Direct Lake guidance (no M partitions).

## 4. Storage mode

| Situation | Mode |
|---|---|
| Files, small/medium databases, personal or departmental | Import (default) |
| Very large or near-real-time, source tuned for queries | DirectQuery (ask first) |
| Data already in Fabric OneLake | Direct Lake |

Large Import facts → incremental refresh (needs `RangeStart`/`RangeEnd` parameters, Service publish).

## 5. Swapping sample → real

1. Confirm the real columns match the contract (rename/type in M, never in DAX).
2. Replace each table's partition expression via the Modeling MCP (`partition_operations`), keep
   column names and `sourceColumn`s.
3. Targeted `Full` refresh of the changed tables; re-run the DAX checks; reconcile totals.
4. Set `dataStatus: "real"` in state.json and remove "sample data" from page tags.

## 6. Privacy

Real data files: `projects/<name>/data/` (git-ignored) or outside the repo via `SourcePath`.
Never commit credentials, connection strings with secrets, or exported data.
