# Issue 333 — Whole-turn AI review

## Contract

- **Feature / High / AUTO**, M3 • Release 1. Project 2 access is unavailable.
- A turn that proposes document mutations shows one before/after review, without editing
  or saving the live document during preparation. The user can apply all, reject all,
  or exclude or reinclude individual proposed operations before one final apply.
- The issue's initial design draft deferred partial selection. The owner's newer request
  explicitly includes it. Selection changes rebuild and re-review a candidate; a checkbox
  never grants permission to execute its operation.
- Keep #46/#64's tool schema boundary, #204's editing coverage, and #229/#242's bounded
  authoritative document reads. #63 chat persistence and #205 viewport effects remain
  out of scope. No provider, IPC, capability, or .thf schema changes.

## Preparation and dependencies

1. Capture the owning document-store bundle, chat session, and live model identity at
   submission. Bind the draft to that baseline. Keep the existing cancellation on tab
   or chat change; an external reload, close, new revision, or Save As invalidates an
   older review. Do not rebase it implicitly.
2. Reuse validated tool preparation and the existing graph/architecture executors in a
   private document context. Only explicitly registered pure document-local mutation
   tools may stage edits. Move graph ID allocation behind the existing executor boundary:
   reserve IDs locally without advancing canvas counters, return generated IDs as
   structured staging results, and reconcile ordinary allocation when installing the
   candidate. Preserve IDs across a selection rebuild, including when earlier additions
   are excluded.
3. Execute native calls in provider order within existing turn limits. Read tools use
   the evolving private document, never a mixture of the live and staged models.
   Keep validated call inputs and outcomes for deterministic replay. Distinguish draft
   effects from applied effects in provider instructions and results. Do not enter review
   on abort, stream failure, budget cutoff, or unresolved invalid mutation; return safe,
   structured feedback rather than silently dropping failed operations.
4. Parse tool-incapable responses through the existing fenced parser, then stage their
   action and threat suggestions through the same proposal engine. Historical or
   tool-enabled assistant text cannot create an independently applicable action card.

## Review and exact commit

- Derive the semantic diff from the actual baseline and candidate, not model summaries.
  Cover all mutable collections, names, added/removed IDs, changed fields, references,
  positions or membership where affected, and cascades. Use plain text for document or
  model values. Display destructive effects, including deletions, in the same review.
- Show one shared before/after diff plus a list of included operations. Rebuild a selected
  subset in original execution order against the baseline; never allocate different IDs
  or execute an unchecked item. Refuse a selection that leaves an unresolved dependency,
  name the blocking operation, and leave Apply disabled until the selection is valid.
  Cascades are effects of the selected operation rather than separately editable rows.
  A changed selection yields a new review identity.
- Accept only the current proposal token and reviewed selection from the owning session.
  On Apply, recheck the current store bundle, session, baseline identity, token and
  document validation synchronously. Install the reviewed candidate, without replay,
  through the existing snapshot, canvas sync, and turn-undo transaction path. Consume the
  pending proposal once, reconcile deleted selection, and add one undo entry only for a
  real change. No render, provider call, or async write occurs in the approval boundary.
- Reject, cancel, stale, and failure do not write model/history. Append an authored result
  to retained protocol history so a follow-up does not confuse staged IDs for committed
  ones. Report applied and excluded operations or the terminal reason; no provider turn
  is needed to apply, reject, or undo.
- Use a keyboard-operable, narrow-panel review with labelled before/after values, status
  announcements, wrapped text, and text disclosure of deletions. Label destructive apply
  with the consequence rather than silently treating it like a non-destructive batch.

## Executable issues

| Order | Scope | Acceptance evidence |
| --- | --- | --- |
| 1 | Isolate AI execution and proposal IDs | Existing executor reused; staged calls and external side-effect refusal; two additions then a reference; no live counter/history/dirty/selection change. |
| 2 | Stage and commit native proposals atomically | Provider iterations use draft reads and structured IDs; selection rebuild and semantic diff include cascades; stale/cancel/fail/invalid/no-op/race cases and one undo/redo entry. Depends on 1. |
| 3 | Ship accessible review and fenced parity | Per-item inclusion plus whole apply/reject; no independently applicable cards; keyboard/narrow/status/destructive/stale behavior, fenced parity, deterministic browser E2E and visual evidence. Depends on 2. |

## Verification and delivery

- Add deterministic fixtures for independent and dependent selections, an invalid later
  operation, rejected proposals, an edit during review, deletion cascades, and one undo
  entry. Check provider result IDs and follow-up state separately from live model state.
- Keep existing prompt injection, validation and provider transport tests. Update the
  existing AI approval visual-flow baseline only for actual changed checkpoints, with
  before/after evidence and no new checkpoint budget. Verify browser keyboard and narrow
  sidebar behavior. Report whether a real desktop runtime smoke test was possible.
- Run targeted tests during implementation, then anti-slop and relevant independent
  preflight checks. Push normally with pinned Node and the local gate once, wait for
  hosted CI, and handle review relays before moving to #55.
