# Vendored third-party tooling

> **Do not hand-edit** the files listed below. They are copies of upstream files and will be
> overwritten on the next re-sync. Put client-specific rules in a client design skill
> or the root `CLAUDE.md` instead.

## Source

| Field | Value |
|---|---|
| Marketplace | `fabric-collection` — github.com/microsoft/skills-for-fabric |
| Plugin | `powerbi-authoring@fabric-collection` v0.3.21 |
| Upstream commit | `f8fac110ac3b93e9d1f7b0bd8feac5c6a468ce43` (2026-11-05) |
| Vendored on | 2026-11-10 |
| License | MIT — `.claude/common/LICENSE` (copied from the marketplace root) |

`fabric-skills@fabric-collection` (the full Fabric bundle) was **not** vendored: it targets Fabric
cloud workloads and registers a remote `powerbi-modeling-mcp` (HTTP, needs Azure CLI) that would
collide by name with the local Desktop server used here.

## What was copied

| Upstream (plugin dir) | Repo |
|---|---|
| `skills/semantic-model-authoring/` | `.claude/skills/semantic-model-authoring/` |
| `skills/powerbi-report-cli/` | `.claude/skills/powerbi-report-cli/` |
| `common/COMMON-CLI.md`, `COMMON-CORE.md`, `ITEM-DEFINITIONS-CORE.md` | `.claude/common/` |
| marketplace `LICENSE` | `.claude/common/LICENSE` |
| MCP server `powerbi-modeling-mcp` (plugin `.mcp.json`) | repo `.mcp.json` |

Layout mirrors the plugin, so the skills' `../../common/...` links resolve (verified: 18/18).

**MCP difference from upstream:** upstream runs `npx -y @microsoft/powerbi-modeling-mcp@latest --start`;
the repo wraps it as `cmd /c npx ...` because `npx` is a `.cmd` shim on Windows and stdio servers
cannot launch it directly.

The server requires its EULA to be accepted once per machine
(https://go.microsoft.com/fwlink/?LinkId=2381247) — via the `accept_eula` tool or
`PBI_MODELING_MCP_ACCEPT_EULA=true`.

## Re-sync procedure

1. Keep the plugin installed (it is the update path):
   `claude plugin marketplace update fabric-collection` then `claude plugin update powerbi-authoring@fabric-collection`.
2. Plugin dir: `~/.claude/plugins/marketplaces/fabric-collection/plugins/powerbi-authoring/`.
3. Delete and re-copy `skills/*` → `.claude/skills/` (only the two folders above) and
   `common/*` → `.claude/common/` (keep this file). Re-copy `LICENSE`.
4. Diff the plugin's `.mcp.json` against the repo `.mcp.json`; keep the `cmd /c` wrapper.
5. Re-check that every `../../common/` link resolves.
6. Update the table above (version, commit, date) and commit as `repo: re-sync powerbi-authoring vX.Y.Z`.

At runtime the repo copies win over the plugin's (project scope wins by name), so nothing is
loaded twice.
