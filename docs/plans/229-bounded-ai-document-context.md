# Issues 229 and 242 — Bounded AI document context and authoritative reads

## Objective

Keep system-prompt size independent of document size, and let a native AI turn
read the current document even after an approved tool changes it.

## Issue contract

- **Issues:** #229 and #242; parent initiative #46; AI-first rebuild #368.
- **Type / effort / autonomy:** Bug / High / AUTO; M2 • Beta. Project 2 remains
  inaccessible under the existing exception.
- **Dependencies:** #203 bounded document read tools and #62 multi-iteration turns.
- **Non-goals:** #333 whole-change review, removing the text-only fenced
  fallback, widening a tool's schema, or changing file formats.

## Current behavior and evidence

`src/lib/ai-prompt.ts` embeds every element, flow, boundary, and threat.
`src/stores/ai-turn-store.ts` builds that prompt once, while its runner reads the
active model on demand. After an approved mutation, both pre-edit document data
and post-edit tool data go to the provider. The existing protocol budget counts
history and reserved output, but not the composed system prompt.

## Execution issues

### 1. Bound inline context and account for the prompt (#229 child)

- **Behavior:** Keep a maximum of four entities per section (elements, flows,
  boundaries, threats) and 4,096 UTF-8 bytes of escaped document data. Sample
  evenly across each section in document order, including the first and last
  entries, to represent the whole document instead of an alphabetical prefix.
  Keep metadata first, then the four sections in that order. Limit individual
  fields and nested lists before escaping; admit complete lines only and keep
  the trust boundary intact. Label omitted or shortened content explicitly.
- **Files:** `src/lib/ai-prompt.ts`, its tests, and
  `src/lib/ai/protocol/{budget,client}.ts` and their tests.
- **Verification:** Pin both limits, omissions, deterministic selection, and
  delimiter escaping with large and hostile inputs. Charge the composed prompt
  once using the existing context budgeter's token estimate; prove it can push
  older conversation groups out or reject an over-budget latest group.

### 2. Use live document tools as the only native document source (#242 child)

- **Behavior:** When all three document reads are advertised, do not put any
  document values in the prompt. Say that inline context is intentionally
  omitted, name `get_document_summary`, `search_entities`, and `get_entity`,
  and explain that fresh reads are authoritative after edits. Text-only and
  partial-tool configurations keep the bounded snapshot, explicitly labeled as
  incomplete when shortened; name only reads actually available.
- **Files:** `src/lib/ai-prompt.ts`, its tests, the injection suite, and
  `src/stores/ai-turn-store.test.ts`.
- **Verification:** Drive a large model through the real tool registry with a
  scripted provider: read an element omitted from the prompt, approve a
  mutation, and read its fresh state on a subsequent iteration. Assert that
  every request's system prompt fits the budget and contains no document data.
  Keep the AI transcript visual flow passing without rebaselining.

## Cross-cutting requirements

- Keep untrusted-document escaping for fallback data and native read results.
  Tool approvals, validation, and undo stay unchanged.
- Platform-neutral UTF-8 accounting and the existing token estimator work in
  browser and desktop. Neither byte limits nor estimates claim exact provider
  token counts. No document schema or stored-chat format changes.

## Verification and owner validation

Run the targeted Vitest suites and the AI transcript visual flow, then let the
normal pre-push hook run the local CI gate once and wait for hosted CI. An owner
can validate output quality on realistic large documents with a live provider
following [the AI output quality guide](../quality/ai-output-quality.md).
Scripted tests are not evidence of provider answer quality.

## Replan log

| Date | Change | Evidence |
|------|--------|----------|
| 2026-11-27 | Joint plan | #229/#242 acceptance criteria and #203 registry |
