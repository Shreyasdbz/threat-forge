# Issue 368 — Sequence diagrams and guided threat-model interviews

## Objective and contract

Add two local-first workflows: draw an ordered interaction on top of an existing
architecture, and turn an interview into a reviewed threat model without requiring an AI
provider. This is a High-effort Feature extension of [#368] and PR #367; the previously
authorized Project 2 exception still applies. This plan proposes execution sub-issues
below; it does not claim or create them. No implementation is included in this change.

## Current behavior

`Diagram.kind` is free-form metadata, not a renderer dispatch. Elements, flows and trust
boundaries are document-wide; STRIDE analyses those objects, not diagram views. Browser
WASM, Tauri and MCP exports already share the Rust `Scene` renderer. In-app AI commits
compare the expected model, revalidate the output, push one undo snapshot, and replace the
model atomically. MCP has a separate revision-checked dry-run and batch commit boundary.
Neither workflow exists today.

## Sequence design

- **A new view kind, not a new document or graph.** Add optional `diagrams[].sequence`,
  recognized only with `kind: sequence`. The payload contains ordered `participants`
  (stable local `id` and `element_id`) and ordered `messages` (stable local `id`,
  `from` and `to` participant IDs, `label`, and optional `flow_id`). Array order
  defines columns and time; timestamps and pixel coordinates are not needed.
  A linked flow must match the message direction and endpoint elements. An unlinked
  message is an annotation, not a new data flow. Allow repeated messages on the same
  flow. One element appears at most once per view in v1.
- **Compatibility.** Readers support existing 1.0 and new 1.1. Keep ordinary 1.0 saves
  at 1.0; creating the first typed sequence promotes the document in the same undoable
  transaction. Require 1.1 for a typed payload, but do not reinterpret old kind-only
  entries named `sequence`. Do not automatically downgrade an already saved 1.1 file
  when its last view is deleted. The version gate prevents older editors, which cannot
  enforce sequence references on graph deletion or select the right export, from
  editing a document with semantics they do not understand. Preserve unknown fields
  in browser and native round trips; add valid and invalid cross-reader fixtures.
- **Editor.** Add a diagram switcher and a sequence editor alongside the existing
  canvas. Users create/rename/delete a view, add existing elements as lifelines, select
  endpoints, edit labels, optionally link a flow, and reorder participants/messages
  with keyboard-accessible controls. Switch views without changing graph layout.
  When a graph edit would invalidate a link or participant, fail closed and identify
  the affected views; users can unlink or remove the references explicitly. Use the
  same rule for browser, desktop, AI, and MCP graph changes.
- **MCP and export.** Add bounded reads for sequence views by diagram ID and explicit
  sequence create/update/delete mutations to `batch_transaction`, with dry-run/expected
  revision checks, undo and canonical validation. Pass optional `diagram_id` through
  presentation, SVG/PNG exports and MCP screenshot to one Rust scene selection path.
  Omitted ID preserves the existing graph export; an unknown requested ID is an error.
  Keep embedded fonts, escaped labels and deterministic layout. Compare browser and
  MCP export bytes for both a graph and a sequence fixture.
- **STRIDE.** Keep the canonical graph as the analysis source. Linked messages can
  navigate to the flow and its findings; repeated messages must not duplicate threats.
  Unlinked messages do not generate threats. Timing and ordering analysis, richer
  sequence notation (loops, fragments, activation bars), and new import formats are
  out of scope.

## Interview design

- **A complete offline path.** Ask about scope and assets, actors and services, data
  stores, directional flows and data, then trust zones and crossings. Make questions
  skippable and answers revisitable. Capture structured facts where possible. Map those
  facts deterministically to proposed elements, flows and boundaries using explicit
  references. For existing models let users choose reuse vs. create; do not silently
  merge by name. Show unanswered questions as gaps, not inferred facts.
- **Storage.** Keep raw answers and the unapproved proposal in the owning document's
  in-memory editor bundle. Resume across view/tab switches while that document stays
  open; discard on explicit cancel or document close/reload, with a clear warning.
  Save only explicitly selected structured changes in `.thf`, not raw answers.
  No answer storage in IndexedDB, telemetry, MCP resources, exports, or chat history.
- **Review and analysis.** Review the proposed diff with dependent changes indicated
  before anything is persisted. Revalidate selected changes against the same
  document ID, live model and revision used to build the preview; refuse a stale or
  cross-document apply and rebuild the preview. Reuse the commit invariants in
  `src/lib/ai/loop/transaction.ts` through a document-scoped entry point shared with
  AI, rather than introducing a second history/store write path. Apply is one atomic
  undo entry. Then offer existing STRIDE analysis; keep its findings review separate.
- **Optional AI assistance.** Use only the existing BYOK path. The user picks which
  answers to send and confirms the provider transfer. AI may propose mappings or
  follow-up questions; treat responses as untrusted structured suggestions and run
  them through the same validation, diff and explicit approval as offline answers.
  Cancellation, failure, stale drafts or missing keys must leave the offline wizard
  functional and the document unchanged.

## Execution sub-issues

| Proposed sub-issue | Depends on | Surfaces and shipping gate |
|---|---|---|
| S1. Sequence schema, reader parity and references | — | `src/types/threat-model.ts`, Rust model/reader, TypeScript validator, file-format docs and shared fixtures. Round-trip existing 1.0 and typed 1.1; reject invalid IDs, directed links, and dangling references on both sides. Verify 1.0 saves do not rewrite the version. |
| S2. Sequence editor and graph edits | S1 | Diagram switcher, editor, document/history stores and graph deletion paths. Unit and keyboard E2E: create/reorder/edit, undo/redo, switch to the unchanged graph and reopen. Refuse deletes and endpoint edits that would break links. |
| S3. Sequence MCP and shared scene | S1, S2 | `src-tauri/src/mcp/server.rs`, `src-tauri/src/scene.rs`, Tauri commands, `scene-wasm`, export adapters. Rust stdio: dry-run/stale revision/undo and existing calls unchanged. Extend `e2e/export-parity.spec.ts` for explicit view selection and byte parity. |
| I1. Offline questions and proposal mapping | — | Per-document editor bundle and guided form. Unit/component tests for skip/back, deterministic mapping, reuse choices, tab isolation, cancel and draft expiry. |
| I2. Review, commit, undo and STRIDE handoff | I1 | Transaction core and review UI. Unit and E2E tests for partial selection with dependencies, stale/cross-tab refusals, one-step undo, save/reopen, and review of STRIDE results. |
| I3. Opt-in AI assist | I2 | BYOK provider adapter and proposal parser. Mock provider tests for consent, cancellation, invalid output and offline continuation; prove there is no provider request without confirmation. |
| V1. Workflow regression and contributor docs | S3, I2; AI check after I3 | Under `e2e/visual-flows/`, reuse seeded fixtures and the pinned `checkpoint` helpers. Sequence: ordered edit and presentation after reopen. Interview: offline proposal review and post-apply STRIDE. Add AI refusal/cancel as functional assertions, not extra screenshots. Four new PNGs, at most 30s summed new flow time on the pinned hosted runner; update the contributor guide and report measured time. |

## Risks and acceptance

- **Data loss or divergent validation:** evaluate opens, Save As, MCP transactions,
  undo, and external edits on 1.0/1.1 across all write paths. Keep the 1.0 corpus green.
- **Privacy or unintended mutation:** verify canceled and stale proposals do not write,
  drafts never cross document tabs, and no raw answers leave the app without consent.
- **Misleading security output:** manually verify link direction and trust crossings
  on a real architecture. A sequence is evidence for review, not a second STRIDE engine.
- **Accessibility and rendering:** verify keyboard-only editing and interview review,
  accessible errors and focus return, and export labels for long names and repeated
  messages. Compare light/dark in pinned Chromium; verify Tauri separately.

Run targeted Vitest, Rust fixture and MCP stdio suites, then pinned Playwright flow and
export parity tests and `npm run ci:local`. Require independent correctness, slop,
security and threat-model review before owner validation and any merge.

## Replan log

| Date | Change |
|---|---|
| 2026-11-26 | Follow-on design for features intentionally excluded from the earlier visual-flow pass. |

[#368]: https://github.com/Shreyasdbz/threat-forge/issues/368
