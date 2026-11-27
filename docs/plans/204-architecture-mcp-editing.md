# Issue 204 — Architecture editing through MCP and in-app AI

## Objective

An agent can create a layer and group, organize existing elements, and create or
reconnect an architecture relationship. MCP and in-app AI offer the same vocabulary
and semantics, with their existing approval, validation, revision and undo safeguards.

## Issue contract

- **Issue:** #204; parent #64; AI-first scope #368.
- **Type / effort / autonomy:** Feature / High / AUTO. M2 • Beta; priority not verified.
- **Dependencies:** #57 architecture model and #62 approved native-tool loop (both done).
- **Tracking:** The owner authorized implementation here despite the existing Project 2
  access exception. Claiming the project status and reading native priority are unavailable.
- **Non-goals:** New diagram kinds, generic model patches, provider changes, selection or
  viewport tools (#205), removal of fenced compatibility (#206), whole-turn staging
  (#333), and richer layout/duplicating nodes. MCP already has layout tools.

## Current behavior and evidence

The twelve built-in graph tools cover legacy elements, flows, trust boundaries and
threats. They stay unchanged. Rust's MCP `Mutation` in
`src-tauri/src/mcp/server.rs` additionally covers positioning, grid layout and sequences.
The native registry in `src/lib/ai/tools/tool-registry.ts` does not yet expose typed
architecture mutations. Both readers already model `layers`, `groups`, and
`relationships`, and validate current references, namespace collisions and group cycles.
Relationships are separate from DFD flows and excluded from STRIDE.

## Implementation steps

### 1. Relationship mutations over MCP

- **Behavior:** Add `add_relationship`, `update_relationship`, and
  `delete_relationship` as `batch_transaction` operations. Add takes an explicit
  stable ID, type, two element IDs and optional label/description/stroke styling.
  Update keeps the ID and can edit those fields, including reconnecting either endpoint.
  Reconnecting clears the corresponding handle when it changes; unrelated styling,
  offsets, and extension data remain intact. Delete removes only that relationship.
- **Implementation:** Define strict Rust requests and a focused architecture executor
  alongside `server.rs`; return operation name and ID in structured results. Reuse
  batch validation, dry-run, expected revision and journal. Do not add single-operation
  write aliases. Update MCP docs and the pinned tool surface.
- **Targeted verification:** `cargo test --manifest-path src-tauri/Cargo.toml --test mcp_stdio`
  covers create/reconnect/delete, bad references and namespace collisions, unchanged dry
  run, stale revision, atomic rejection, and undo.

### 2. Group, layer and membership mutations over MCP

- **Behavior:** Add `add_group`, `update_group`, `delete_group`, `add_layer`,
  `update_layer`, and `delete_layer`. Creation appends to the existing order.
  `reparent_group` changes `Group.parent`; `set_element_group` and
  `set_element_layer` set or clear element-side memberships. Membership operations
  take an explicit destination or explicit clear; omission must not clear. Reparenting
  changes metadata only: it does not edit trust boundaries or coordinate fields.
  Reject deletion of groups with children/members and layers with members; move the
  members explicitly in the same batch before deleting. No implicit cascades.
- **Implementation:** Extend the architecture executor; keep style/geometry intact on
  rename or metadata edits. Apply existing namespace and cycle checks for every
  candidate and exercise them through the MCP transport.
- **Targeted verification:** The stdio suite covers create, rename, clear, nested
  reparent, invalid cycle and occupied delete; batch dry-run/apply/undo verifies
  stable membership and version preservation.

### 3. Matching native in-app AI tools and parity

- **Behavior:** Advertise the same operation names, argument contracts, validation
  outcomes and structured success IDs as MCP. No changes to the legacy fenced union.
  Mutations require existing approval; all deletes are individually destructive and
  excluded from batch approval. Existing cancellation, stale-approval protection and
  one undo entry per AI turn continue to apply.
- **Implementation:** Add a dedicated architecture-tool module under `src/lib/ai/tools/`
  using `defineExecutableTool` and pure candidate updates; register beside existing
  graph tools. Reuse `validateThreatModel`, the approval UI and commit machinery.
  Add shared fixture cases for schema and outcome parity; keep existing contracts.
- **Targeted verification:** Run architecture-tool, registry, turn-machine and
  transaction tests. Cover approval/rejection and undo through the production loop,
  not a UI stub. Round-trip the same fixture through both validators. No new visual
  baseline for an unchanged approval surface; add one pinned checkpoint for the
  architecture approval flow if UI changes are necessary.

## Cross-cutting requirements

- **Compatibility:** No new persisted fields, migrations or version bump. Preserve
  1.0/1.1, optional architecture sections, opaque legacy sequence data, and nested
  unknown fields per the existing writer contract. Only accepted operations write.
- **Safety:** Strict operation schemas reject unknown keys; validate nonblank IDs,
  names and types, valid references, finite/ranged styling, and cycles. Bound work
  through the existing transaction limits. Browser and desktop both use the native
  tool loop; the Rust MCP path independently validates before save.
- **Risks:** Divergent Rust and TS rules, stale previews, lost unknown fields,
  ID collisions affecting canvas projection, and confusing architecture grouping
  with security boundaries. Use parity fixtures, stale/invalid no-write tests, and
  existing STRIDE regressions rather than adding a parallel model or transaction engine.

## Verification gate

Run targeted Rust stdio and Vitest tests while implementing. Run `npm run ci:local`
once per normal push and wait for hosted checks. Run the pinned visual flow only
if UI changes or a new checkpoint warrant it. The #230 Biome timeout fix is separate.

## Owner validation

Try the group/layer and reconnect workflow from an MCP client and the in-app
assistant; inspect the result in the editor, then undo. Confirm that refusal of
occupied container deletion and metadata-only reparenting match expectations.

## Specialist review

- [ ] PR reviewer and slop auditor
- [ ] Security auditor: input, approval, revision and file transaction behavior
- [ ] Threat-model expert: architecture membership and STRIDE separation

## Replan log

| Date | Change | Evidence and reason |
|---|---|---|
| 2026-11-27 | Initial plan | #204, #64 and owner-selected MCP parity scope under #368 |
