# Enterprise checklist

Apply on top of the pipeline when the report is for an organization (several users, shared data,
governance). Record answers in the project `CLAUDE.md` / `data-contract.md`; unknowns are
`TBD — ask` blockers in `state.md`.

## Ownership and sign-off
- [ ] Business owner (prioritizes, accepts), data owner per source, numbers sign-off person.
- [ ] Each KPI definition approved in writing (definition, exclusions, polarity, target source).
- [ ] Reconciliation evidence per KPI in `docs/validations/` (report total vs source query).

## Data access
- [ ] Source access via service account / service principal, not a personal login, for scheduled refresh.
- [ ] Prefer **views** owned by the data team over raw tables; agree on a contract for column changes.
- [ ] On-premises sources (SQL on a server, file shares) → **on-premises data gateway** + data source
      registered in the gateway. Cloud sources (Azure SQL, SharePoint, Fabric) → no gateway.
- [ ] Data classification and **sensitivity label** for the semantic model and report.
- [ ] Personal data (PII): only the columns needed; hide or remove the rest.

## Environments and deployment
- [ ] Workspaces DEV / TEST / PROD (Fabric deployment pipeline or Git integration).
- [ ] M parameters (`Server`, `Database`, `SourcePath`) switch per environment — no edits to queries.
- [ ] PBIP in Git; pull-request review for model and report changes; tag releases.
- [ ] Publish only on explicit request; never overwrite PROD from a local file outside the pipeline.

## Security
- [ ] Row-level security roles defined from the data contract (e.g. by region, cost center),
      tested with "View as" / DAX impersonation. Role **membership** is managed in the Service portal.
- [ ] Object-level security only if columns must be hidden from some users.
- [ ] Workspace roles: viewers through an App or audience, not workspace membership.

## Performance and refresh
- [ ] Storage mode decided (Import / DirectQuery / Direct Lake) and documented.
- [ ] Large facts: incremental refresh policy; remove unused columns; integer keys.
- [ ] Refresh schedule aligned with source load times; failure notifications to an owner group.
- [ ] Run the semantic-model best-practice analysis and `model-reviewer` before release.

## Usability and documentation
- [ ] Descriptions on tables, columns and measures (feeds Copilot and data agents).
- [ ] Display folders; hidden keys and helper measures; consistent naming convention.
- [ ] Accessibility: contrast, alt text on key visuals, tab order, no color-only meaning.
- [ ] A "How to read this report" note or info page: definitions, refresh time, owner contact.
