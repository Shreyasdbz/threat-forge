# ThreatForge AI-first rebuild

Humans, in-app AI, and agents such as Claude Code and Codex over local MCP are
first-class actors on one document engine. They should be able to create, edit,
review, and share the same architecture without translating it between tools.
Threat modeling stays first-class, but architecture drawing works without it.

Security is a product requirement: local-first and no account, optional direct
BYOK, portable and backward-compatible `.thf`, user-approved filesystem scope,
untrusted agent inputs, reviewable changes, and no silent loss of edits.

## C1 — Unified document core

- Share one Rust validation and transaction layer between desktop IPC and MCP.
  Validate version and references before commit, cascade deletions to dependent
  threats and relationships, and preserve unknown YAML fields.
- Commit with a same-directory temporary file and atomic rename. Use content-hash
  revisions and a cross-process lock so stale writers fail rather than overwrite.
- Confine file IPC to user-approved roots and selected paths; treat legacy layout
  sidecars as untrusted references. Escape untrusted HTML report values and triage
  npm audit findings by production exposure and available fixes.
- Gate: old files round-trip, invalid changes never reach disk, competing writers
  cannot silently overwrite one another, and desktop and MCP use the same checks.

### C1 dependency triage

The baseline `npm audit` reports 14 packages (10 high, 4 moderate),
four of which are present with `--omit=dev`:

| Production package | Exposure and follow-up |
| --- | --- |
| `js-yaml` (moderate) | Accepts local, potentially untrusted files. Prioritize updating to a patched 5.x release and verify the shared YAML fixtures. |
| `zod` (high) | Validates agent/provider data; oversized input can exhaust memory. Update to a patched 4.x release and retain the existing input budgets. |
| `react-router`, `react-router-dom` (high) | One upstream React Router advisory affects RSC server actions; ThreatForge ships a client-only Vite router, not an RSC handler. Update the packages together. |

Development-only findings cover Vite/Vitest and Wrangler plus their transitive
dependencies. Keep the dev server local and take compatible lockfile updates
in a separate dependency change; align Wrangler-generated worker types in that
change. Package updates are not included in this triage.

## C2 — MCP v2

- Add create/list/open/search for `.thf` in a configured workspace root, plus
  position/move/resize and auto-layout.
- Add dry-run batch transactions, an undo/redo journal, and STRIDE analysis tools.
- Render a canonical Rust scene to SVG and use resvg for PNG. Expose
  `export_svg`, `export_png`, and screenshot capture from the same scene.
- Publish MCP resources and prompts and setup instructions for Claude Code and
  Codex. Gate: either client can build and export a diagram without driving the UI.

## C3 — Live sync

Desktop watches open files, reloads clean documents, and offers a merge or recovery
path for concurrent local edits. Show agent activity without interrupting the
canvas. Gate: an external edit never silently replaces a dirty document.

## C4 — Design and polish

Polish the canvas and inspector, surface architecture layers and groups, add
presentation mode, and provide UI SVG/PNG export from the same scene as MCP.
Gate: the same document produces matching artifacts from the editor and MCP.

## C5 — Interoperability and release

Add browser TM7 import and additional formats. Verify signed distributions and
updater behavior end to end, and enable visual regression in CI with controlled
baseline environments.

## Existing branch overlap

- `codex/distribution-signing` adds signing workflows, verification scripts, and
  a rehearsal record. Review it when implementing C5.
- `codex/provider-compatibility` builds on the signing branch and adds provider
  compatibility and native tool continuation work. Review it before changing
  in-app provider adapters. Neither branch is merged as part of this rebuild.
