---
description: Prepare this computer for pbi-delivery (check tools, point SourcePath at this machine's data folder)
argument-hint: [project-name]
---

Get this machine ready to work on the repo's Power BI projects. Argument: `$ARGUMENTS` (optional
project; default: every `projects/*/`). Report in the user's language.

1. **Check tools** (read-only; Windows PowerShell). For each, say OK / missing and the exact install
   command. Install nothing without the user's OK.
   | Tool | Check | Install |
   |---|---|---|
   | Node.js 20+ | `node --version` | `winget install OpenJS.NodeJS.LTS` |
   | Git | `git --version` | `winget install Git.Git` |
   | Power BI Desktop | `Get-Command PBIDesktop -ErrorAction SilentlyContinue`, or the Store app `Get-AppxPackage *PowerBIDesktop*`, or `"$env:ProgramFiles\Microsoft Power BI Desktop\bin\PBIDesktop.exe"` | Microsoft Store → Power BI Desktop |
   | Report CLI | `powerbi-report-author --version` | `npm install -g @microsoft/powerbi-report-authoring-cli@latest` |
   | Edge (screenshots) | `"${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"` exists | Comes with Windows |
   | Modeling MCP | the `powerbi-modeling-mcp` tools are available in this session | `.mcp.json` / the plugin starts it with `npx`; accept its EULA once (`PBI_MODELING_MCP_ACCEPT_EULA=true` or its accept-EULA tool); restart Claude Code |

   If a tool is installed but not found, the PATH is stale: tell the user to restart VS Code.
   If `git config user.name` / `user.email` are empty, ask for them before any commit.

2. **Data on this machine.** For each project: `projects/<name>/data/` must hold the files listed
   in its `data-contract.md`. Real data is never in git — if missing, ask the user to copy it there.

3. **SourcePath parameter.** Find `projects/<name>/**/*.SemanticModel/definition/expressions.tmdl`.
   For every location parameter (`SourcePath`, `Server`, `Database`…) that points to a folder that
   does not exist here, propose the new value (`SourcePath` → the absolute path of
   `projects/<name>/data`). Only after the user confirms **and** Power BI Desktop has the project
   closed: edit that one line in the TMDL (keep the `meta [IsParameterQuery=true…]` part intact).
   Alternative the user can do: Desktop → *Transform data → Manage parameters*.

4. **Locale.** Remind the user that number format follows Desktop's regional setting for the file
   (*File → Options → Current file → Regional settings*) — it must match the project's `state.json`
   `locale` (e.g. Español (Colombia) for `es-CO`).

5. **Summary.** A checklist of what is ready and what the user still has to do. Change no other
   file. Do not commit.
