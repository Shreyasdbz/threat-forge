# Design critique 2 — implementation plan

## Objective

Fix the six verified interaction failures, make the workspace controls consistent with the diagram as the primary surface, and put scale and interoperability under deterministic regression coverage. The approved [critique](design-critique-2.md) is the baseline and acceptance reference. Its [contact sheet](design-critique-2-contact-sheet.png) is the stable location for the eventual paired before/after evidence; the original captures remain in the audit archive.

## Issue contract

- **Parent initiative:** #368. File a High-effort execution parent and the four named children below after the approved plan is committed.
- **Type / autonomy:** Feature / AUTO. Milestone: M2 • Beta. Use `model/opus` for the tracked cross-cutting work.
- **Dependencies:** The browser workspace, recovery, rendering, AI proposal, and export paths on #367; existing Chromium fixtures and conditions. No dependency on provider credentials.
- **Non-goals:** Rebrand; new diagram schema, persistence store, or approval semantics; replacing adapters; moving project tracking outside Project 2; per-PR wall-clock performance thresholds.

## Current behavior and evidence

At baseline `8fdb757`, the evidence matrix captured 51 browser states at 1440 × 900 CSS px in Daylight/Midnight and at 1×/2×. In all four configurations, Guided Tours permits background focus and Fit View shows 66 of 360 fully visible nodes. Daylight's destructive item has 2.87:1 text contrast. The structural and workflow defects, exact screenshots, and proposed tokens are numbered in the critique. Tracked product screenshots already live under `docs/quality/evidence/`, so committing the single review sheet is consistent with existing practice. Raw captures are not repository assets or Playwright baselines.

## Execution children and commits

### 1. Fix and test design-critical interactions (defects 01–06)

- **01:** Give `src/components/onboarding/guide-picker.tsx` a true modal primitive. Test focus on open, forward/reverse wrap, Escape, focus return, and blocked background settings activation in Chromium.
- **02:** Fix Fit View in `src/components/canvas/dfd-canvas.tsx` and the existing canvas-instance command path. Use the generator in `e2e/fixtures/gen-large-model.mjs` for a deterministic 360-node grid; preserve the existing 150-node fixture. Use the actual Fit View action in browser E2E, then assert all 360 non-hidden node rectangles are fully inside the canvas pane. Count outside nodes and report the first offenders. Do not pass the assertion by rendering fewer nodes or extending a timeout.
- **03:** Use a semantic theme-specific destructive text color in the canvas menu. Run the real open item through axe's `color-contrast` rule in Daylight and Midnight in `e2e/accessibility-audit.spec.ts`; assert the surface is included, no exact-target exception is used, and the failing pre-fix item is detected.
- **04:** Wire actionable recovery from storage warnings and the existing command registry; keep the footer affordance usable. Make bundle download the first recovery action and distinguish destructive controls. Tests must prove keyboard entry and recovery, export availability, confirmation cancel/accept, and data preservation on cancel. Reuse recovery fixtures rather than broadening automatic clearing.
- **05:** Group diagram and report formats in the existing `top-menu-bar.tsx` export control, using the existing export engines. Keep Presentation independent and match existing native menu/command vocabulary without changing export bytes. Check all four browser menu items, artifact parity, and the still-available presentation action.
- **06:** Keep release notes discoverable without opening a blocking fresh-install overlay. Test pristine first visit and upgrade differently; verify the release-note entry still opens, can be dismissed, and does not block create/open or tour eligibility. Extend the current onboarding specs and storage-version unit coverage rather than adding one-off flags.
- **Targeted verification:** Chromium `accessibility-audit`, `architecture-canvas` / 360-node fit, `workspace-recovery`, `export-parity`, `onboarding-auto-start`, and applicable Vitest component tests. Independently record each defect's red-before/green-after oracle where feasible.

### 2. Unify the workspace's visual structure (defects 07–15)

- **Shared tokens:** Use `src/styles.css` and existing `components/ui` primitives instead of a second theme layer. Scope tokens to editor chrome so canvas output, third-party UI, and marketing typography are not accidentally restyled. Keep `components.json` on base-rhea, neutral, Tabler.
- **07/14 launcher and blank canvas:** `canvas.tsx` should offer a compact left-aligned launcher, consistent grouped example rows, and a single first-node action in a new blank document. Preserve every existing template, starter/STRIDE distinction, import/open paths, keyboard and tooltips.
- **08/12 inspector and findings:** Flatten `right-panel.tsx`, `properties-tab.tsx`, `threats-tab.tsx` and relevant shared inspector components. Keep a predictable selection/scroll relationship and full controls, labels, severity and case-sensitive source information. Preserve rendering constraints in the existing architecture/STRIDE tests, adapting only those that intentionally pin changed presentation.
- **09 AI review:** Separate chat narration from one selectable operation/diff row hierarchy in `ai-chat/proposal-review.tsx`. Pin review actions within the panel. Test partial selection, destructive cascades, rejection, stale proposals, and one undo via existing integration/visual flows. Do not change native tool authorization or execution.
- **10/11 sequence and interview:** Compact ordered event editing in `sequence-editor.tsx` and focus the active interview workspace in `interview-workspace.tsx` / `interview-review-panel.tsx`. Preserve graph return, draft resume, participant and linked-flow edits, reorder, pending/error states and apply/undo.
- **13/15 settings and landing:** Remove decorative repeat navigation and dead/pending affordances from `settings-dialog.tsx`. In `landing-page.tsx`, demonstrate one real portable architecture workflow and lead with a single accessible editor action. Preserve settings sections, support links, and downloads.
- **Targeted verification:** Run covering Vitest component suites and Chromium editor, starter/empty, AI, sequence, interview, landing and accessibility flows. Before the first push, inspect and refresh only already-tracked visual baselines actually changed by steps 1–2; do not weaken threshold, viewport or readiness gates. Commit step 2 separately, push normally once through `ci:local`, and wait for authoritative hosted status.

### 3. Re-capture and conduct a second critique pass

- Re-capture the same 51 scenarios, same CSS viewport, same default themes/DPRs, same fixtures and pinned Chromium. Adapt selectors only where the UI contract intentionally changed. Retain full uncropped shots and geometry in an ignored artifact directory. Match before and after by defect and compare paired Daylight/Midnight as relevant at native source scale. Include the large fixture, real focus movement and streamed chat state rather than static mockups.
- Fix concrete remaining issues surfaced by this pass without redesigning unrelated paths. Update only baselines that change as a result and verify again with snapshot writes disabled. Replace the original sheet at `docs/plans/design-critique-2-contact-sheet.png` with one labeled before/after PNG covering all 15 defects; retain the before source in Git history and the audit archive. Commit separately.

### 4. Add deterministic workspace scale and interoperability verification

- Use the critique's matrix: deterministic 1k/2.5k/5k generators, seeded shape/catalog with minimum coverage for sparse, clustered, high-fanout and disconnected graphs. Reuse Playwright support helpers, the existing Rust stdio harness, and valid/invalid shared `.thf` fixtures. Use production public operations at workflow checkpoints rather than thousands of pointer calls.
- Put bounded representative 1k sessions in PR CI (model/position digests, exact transaction and persistence counters where observable, tab/undo isolation, reopen, architecture/sequence/interview/STRIDE/export checkpoints), plus seeded browser/Rust model-parity tests and local MCP open/read/preview/commit/conflict/undo/export/reopen invariants. Validate declined or rejected operations do not write. Gate no absolute elapsed time in PR CI. Keep 2.5k/5k, long replays, broader fuzz/parity corpus and reference-runner timing explicitly opt-in; report example commands, fixture fingerprints and reproduction seeds.
- Calibrate performance separately; do not label proposed load/frame/save budgets as measured until a reference-runner baseline exists. Persist only representative inputs and minimized counterexamples. Commit independently, push normally once through `ci:local`, and wait for authoritative hosted status.

## Cross-cutting requirements and gates

- Do not change `.thf` schema, add data to tracking metadata inside exported files, lower accessibility guarantees, use live provider credentials, or broaden native capabilities. Use authored failure states; preserve explicit destructive confirmations and proposal/undo boundaries.
- Run focused tests on Node from `.node-version`. Use the pinned Chromium image and keep visual evidence split from CI snapshots. Run `npm run ci:local` once per push using the normal hook; no force push, skipped hooks, or merge.
- Apply anti-slop and independent PR/preflight lanes. Add security review if a change touches file or provider trust boundaries; add threat-model review if finding semantics change (not intended). Address relayed Devin Review findings on the appropriate current head. Record any unverified native/platform state rather than substituting browser screenshots for native evidence.
- Owner validation: choose an example, build and review a diagram, locate an AI change and its actual before/after, navigate 360+ elements and export the expected artifact without coaching. Validate on native platforms separately where available. Green coverage is not owner validation.

## Replan log

| Date | Change | Evidence and reason |
|---|---|---|
| 2026-11-27 | Initial implementation plan | Approved 15-defect critique, 204 screenshots, and ordered implementation/verification request. |
