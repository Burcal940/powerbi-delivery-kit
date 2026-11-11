# Data contract — {{PROJECT_NAME}}

> What the model needs, independent of where the data lives. Unknowns: `TBD — ask: <question>`.
> Connector patterns: `pbi-delivery/references/data-contract.md`.

## Sources

| Source | Type (Excel / CSV folder / SQL / SharePoint / Fabric / …) | Location parameter | Refresh | Owner | Gateway needed? |
|---|---|---|---|---|---|
| {{SOURCE}} | {{TYPE}} | `{{SourcePath / Server+Database}}` | {{daily / manual}} | {{OWNER}} | {{yes/no}} |

## Logical tables

### Fact {{Process}}
- **Grain:** one row = {{one transaction / one order line / one day snapshot}}
- **Source:** {{sheet / view / file pattern}}
- **Sensitivity:** {{internal / confidential / personal data}}

| Column | Type | Description | Nullable |
|---|---|---|---|
| Date | date | {{business date used for analysis}} | no |
| {{Entity}} Key | int | FK → Dim {{Entity}} | no |
| Amount | decimal | {{currency, sign convention}} | no |

### Dim {{Entity}}
- **Grain:** one row = one {{entity}} · **Key:** {{Entity}} Key

| Column | Type | Description |
|---|---|---|
| {{Entity}} Key | int | surrogate / source key |
| {{Name}} | text | display name |

### Dim Date
Generated in M from min/max fact date (or imported if the source has one). Marked as date table.

### Plan Inputs (utility, optional)
User-set values (targets, caps, budgets): `Input · Value`. No relationships.

## Relationships
| From (many) | To (one) | Direction |
|---|---|---|
| Fact {{Process}}[Date] | Dim Date[Date] | single |
| Fact {{Process}}[{{Entity}} Key] | Dim {{Entity}}[{{Entity}} Key] | single |

## Security (enterprise)
- RLS: {{none / by region / by cost center}} — {{column that drives it}}
- Columns excluded for privacy: {{list}}

## Status
- Data now: {{sample / real}} · Real sample file received: {{yes/no}}
