# Issue 35 — Deterministic Markdown review export

## Contract

- **Issue:** #35, with execution sub-issues; #368 for local MCP interoperability.
- **Type / effort / autonomy:** Feature / High / AUTO. Keep the existing M3 • Release 1
  milestone; proposed priority Medium. Project 2 fields cannot be verified with current access.
- **Goal:** Export a readable, UTF-8 Markdown artifact from the current model for review in
  a PR, wiki, or documentation. Include components, data flows, findings, and mitigations.
- **Non-goals:** No document schema change, analysis run, layout dependency, remote upload,
  or modification of the source document. HTML, SVG, and PNG export remain available.

## Design

### 1. Shared Rust formatter and contract fixtures

- Use a pure formatter in the Rust library, included directly by the existing browser WASM
  crate. No TypeScript formatter. Render a document title and fixed Components, Data Flows,
  Findings, and Mitigations sections, with explicit empty states. Include IDs for traceability;
  resolve flow endpoints and finding references by name. Render severity, STRIDE category,
  mitigation status, and notes without changing the model.
- Sort entities by ID rather than layout or input order. Read only model data; never include
  timestamps generated at export, machine paths, extension data, or diagram geometry. Use
  LF and a final newline. Write no BOM.
- Put untrusted text only in inline text slots after collapsing whitespace and escaping
  Markdown punctuation, raw HTML delimiters, and GFM link/mention syntax. No raw HTML from
  the document, links, image embedding, or interpolated block syntax. Render stable friendly
  labels for enum fields at the source.
- Verify an ordinary golden, empty output, adversarial literal text, and formatting invariance
  under collection reordering. Regenerate the tracked renderer assets with the pinned
  provenance script.

### 2. UI and MCP delivery

- Wire **Export as Markdown** into the browser toolbar export menu and native File menu.
  Preserve the existing HTML option and shortcut. Read the open document's current model,
  including unsaved content. Browser downloads formatter output via WASM; desktop invokes the
  same formatter behind the native save dialog and uses an atomic write with the selected
  path's extension checked. Cancellation is not an error.
- Add local MCP `export_markdown` on the active document. Return Markdown text. In workspace
  mode an optional workspace-relative `.md` path writes the same bytes using the existing
  confined export writer. Fixed document mode can return text but cannot write. Surface
  safe errors for invalid paths or no active document. Export never changes document state.
- Verify discovery, text output, path confinement, unchanged source, and written bytes via
  the existing stdio tests. Extend the existing browser/MCP export parity suite to compare
  the browser's actual download with MCP text and the golden artifact. Exercise HTML via
  its existing E2E coverage. No added screenshot baseline for the export.

## Risks and review

- Treat document strings as untrusted even if they target a renderer that allows raw HTML.
  Review the actual Markdown and its parsed structure, not only a substring denylist.
- No new filesystem capability: reuse native user selection and workspace confinement.
  Do not accept a direct destination path from the frontend.
- Validate deterministic output across WASM and the native MCP binary, including entity
  references and Unicode. Owner validation covers readability and native-menu discoverability.
- Run the PR reviewer, slop auditor, security auditor, and threat-model expert lanes
  against the formatter, output boundaries, and semantics.

## Verification gate

Run targeted Rust, frontend, WASM provenance, and E2E parity checks. Load the pinned Node
version, push normally with one invocation of the local hook, then wait for hosted checks.

## Replan log

| Date | Change | Evidence and reason |
|------|--------|---------------------|
| 2026-11-27 | Initial High-effort plan | #35 acceptance criteria and owner approval of shared Rust/WASM formatter |
| 2026-11-27 | Use literal code spans with input-dependent delimiters | The GFM parser autolinks even after character reference decoding; code spans preserve literal display without creating links. |
