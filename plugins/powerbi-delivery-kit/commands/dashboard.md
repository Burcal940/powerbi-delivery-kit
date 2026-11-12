---
description: Guided end-to-end — detects the project's phase, does the next step, stops at every point where the user must approve or act
argument-hint: [project-name]
---

> `<pbi-delivery>` = the folder of this plugin's `pbi-delivery` skill (its base directory is shown when the skill loads).

One command for the whole delivery. Argument: `$ARGUMENTS` (project name; optional).

Read the `pbi-delivery` skill first. Its rules apply to every step below.

1. **Pick the project.**
   - If `$ARGUMENTS` names one, use `projects/<name>/` (normalize to kebab-case).
   - Else, if the working directory is inside `projects/<name>/`, use that one.
   - Else run `node <pbi-delivery>/scripts/project-status.js --root .`. If it lists projects, show them with their phase and ask which one to continue, or the name of a new one.
2. **Detect the phase.** Never guess it from memory:
   `node <pbi-delivery>/scripts/project-status.js --project projects/<name>`
   Show the user one short line: project, phase, step `n/10`, next action. Also show any `warnings` and open `blockers`.
3. **Do the next step**, following the steps of the matching command (`.claude/commands/<command>.md`; in the plugin, the skill `powerbi-delivery-kit:<command>`):

   | phase | who | what to do |
   |---|---|---|
   | `none` | Claude | Run `new-project` steps 1–2 (create the folder), then continue as `material`. |
   | `material` | **User** | Ask them to drop design (PNG/HTML/CSS/zip) in `intake/` and data in `data/`, using the message in `references/intake.md` §1. **Stop.** |
   | `intake` | Claude | Run `new-project` steps 3–7: run intake, reshape `state.json`, then ask ONE batched question round. **Stop** and wait for the answers. |
   | `spec` | **User** | If the answers have arrived, fill the files and show `state.json`. Ask for approval. When the user approves, log `Spec approved` in `decisions.md`. **Stop** until they approve. |
   | `mockup` | Claude | Run `build-mockup`, then ask the user to review it. **Stop.** |
   | `mockup-review` | **User** | Apply the requested changes (`state.json` first, then the mockup). When the user approves, log `Mockup approved` in `decisions.md`. **Stop** until they approve. |
   | `pbip` | **User** | Explain the one manual step: Desktop regional settings, then *File → Save as → Power BI Project* into `projects/<name>/`. **Stop.** |
   | `pbi` | Claude | Run `build-pbi` steps 2–4 (model, pages, validate, preview loop). |
   | `html` | Claude | Run `build-html`. Its printed numbers must equal Power BI's. |
   | `close` | Claude | Run `build-pbi` steps 5–6: `reconcile.js` into `docs/validations/`, run `model-reviewer`, update `state.md` and `decisions.md`. Set the Status to `done — …` only when nothing is blocking. |
   | `done` | — | Report it as delivered. Offer: change something (edit `state.json`, then rebuild), new data (run the `refresh` command steps), or publish (only on explicit request). |

4. **Chain without asking** while the next phase is Claude's own (`mockup` → stop for review; `pbi` → `html` → `close`). Re-run `project-status.js` after each step and check the phase advanced. If it did not, say why and stop.
5. **Commit** after each completed step, as the matching command says (`<name>: …`, in the project's own repo).
6. **End every run** with:
   - what was done,
   - the phase now,
   - exactly what the user must do next, or "write `/dashboard <name>` to continue".

Hard rules still apply:
- Never hand-write PBIP scaffolding.
- Never invent business context (write `TBD — ask:`).
- `state.json` owns its pages.
- Do not save from Desktop while Claude edits files.
- Never commit real data or `html/`.
