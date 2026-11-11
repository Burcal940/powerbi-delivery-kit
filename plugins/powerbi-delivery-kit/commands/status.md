---
description: Summarize the active project's state.md (status, blockers, next step)
argument-hint: [project-name]
---

Report the state of a project. Argument: `$ARGUMENTS`

1. **Pick the project:**
   - If `$ARGUMENTS` names a project, use `projects/$ARGUMENTS/`.
   - Else, if the current working directory is inside `projects/<name>/`, use that one.
   - Else, list every `projects/*/state.md` with its one-line status and ask which to expand.
2. **Read** `projects/<name>/state.md` (and the latest entries of `decisions.md`).
3. **Report** concisely:
   - Status and last-updated date (flag it if older than 14 days).
   - Open blockers, especially any `TBD — ask` items — quote the question.
   - Next step.
   - Whether PBIP files exist yet (look for `*.pbip`, `*.SemanticModel/`, `*.Report/`, possibly nested).
   - Uncommitted changes under the project (`git status -- projects/<name>`).
4. Do not modify any file. This command is read-only.
