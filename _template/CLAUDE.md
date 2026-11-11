# {{PROJECT_NAME}}

Project-specific context. Shared conventions (naming, workflow, design system) are in the root
`CLAUDE.md` — do not repeat them here.

> Any field still unknown is written as `TBD — ask: <specific question>` and listed under
> Blockers in `state.md`. Never replace it with a plausible default.

## Business goal

{{BUSINESS_GOAL}}

## Key metrics

| Metric | Definition | Exclusions | Source / owner |
|---|---|---|---|
| {{METRIC_NAME}} | {{METRIC_DEFINITION}} | {{METRIC_EXCLUSIONS}} | {{METRIC_SOURCE}} |

## Fact grain

| Fact table | One row represents | Source |
|---|---|---|
| {{FACT_TABLE}} | {{FACT_GRAIN}} | {{FACT_SOURCE}} |

## Stakeholders

| Role | Name | Responsibility |
|---|---|---|
| Owner | {{OWNER}} | Prioritizes, accepts the report |
| Users | {{USERS}} | Consume the report |
| Numbers sign-off | {{SIGNOFF}} | Confirms metrics reconcile with source |

## Project files

- `state.md` — current status and blockers.
- `decisions.md` — dated decision log.
- `docs/validations/` — reconciliation evidence.
- `tests/` — DAX / data quality checks.
- PBIP files — saved here by Power BI Desktop (may be nested, e.g. `src/`).
