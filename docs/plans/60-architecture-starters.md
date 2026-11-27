# Issue 60 — Architecture-first starter projects

## Objective

Open, save, and export a useful architecture without pre-created findings, then optionally run
STRIDE on the same document.

## Issue contract

- **Issue:** #60; parent #47.
- **Type / effort / autonomy:** Feature / Medium / AUTO. M2 • Beta; proposed priority Medium.
  Project 2 metadata remains inaccessible.
- **Dependencies:** The existing template picker, architecture model and canvas, component
  registry, STRIDE workflow, and diagram export.
- **Non-goals:** New file fields, new icon assets, changes to the six existing templates,
  changes to the analysis engine, or completion of the other #47 epic workstreams.

## Current behavior and evidence

`src/lib/templates.ts` lists six templates whose builders seed threats. The empty canvas in
`src/components/canvas/canvas.tsx` opens them in new tabs through `loadTemplate` and
`buildLayoutFromModel`. The Threats tab already exposes **Run STRIDE Analysis**. Presentation
already exports SVG and PNG without requiring analysis. MCP `create_document` creates a blank
Rust model and does not consume the TypeScript template catalog.

## Implementation steps

### 1. Add five architecture starters

- **Behavior:** Cover cloud service, event-driven system, data platform, desktop app, and AI
  application. Each starts with zero findings. Give each a small, readable set of components
  and flows; demonstrate groups, layers, non-data-flow relationships, existing icons, and short
  canvas annotations.
- **Files:** `src/lib/templates.ts`, the existing picker in `src/components/canvas/canvas.tsx`,
  and checked-in THF fixture data consumable by the browser and the Rust fixture suite.
- **Implementation:** Keep the old catalog intact. Give the starters stable IDs and saved
  layout; do not apply the legacy spacing and trust-boundary post-processing again to data
  that already has persisted coordinates. Open a fresh model instance and dates on each
  invocation. Identify the starters in the picker and point users to **Threats → Run STRIDE
  Analysis**; opening a starter must not run analysis.
- **Targeted verification:** Vitest covers loading a fresh model, zero findings, and save/reopen
  with the architecture intact. Verify the same fixtures open through the native Rust reader.

### 2. Verify creation through export

- **Behavior:** A parameterized Chromium flow opens each starter from the picker, checks
  the architecture and initial lack of findings, and verifies the SVG export. Save and reopen
  the representative starter and run STRIDE explicitly; verify that findings appear in the
  same document and architecture remains intact.
- **Files:** A functional spec in `e2e/` and one flow using `e2e/visual-flows/checkpoint.ts`.
  Capture exactly one light Chromium baseline of the representative opened starter after the
  canvas settles. No screenshots per use case or changes to existing suite budgets.
- **Targeted verification:** Use the pinned Playwright image with one worker; verify the
  new baseline with updates disabled. Report the baseline path and hosted flow duration.

## Cross-cutting requirements

- Reuse existing fields and registry entries. Keep the old templates and workflow intact.
- MCP creation is follow-up scope: shipping it here would either duplicate the catalog or
  require a shared registry, template discovery, and stdio coverage. Record that follow-up
  under #368, linked to #60.

## Verification gate

Run the targeted Vitest and Rust fixture suites and the pinned Chromium functional and visual
flows. Source NVM and select the repository's Node version before pushing; run the local gate
once through the normal pre-push hook and wait for hosted checks.

## Owner validation

Check fit-to-view readability, relevance of the five examples, and discoverability of the
optional STRIDE workflow.

## Specialist review

- [ ] PR reviewer
- [ ] Slop auditor
- [ ] Threat-model expert for the representative STRIDE workflow

## Replan log

| Date | Change | Evidence and reason |
|------|--------|---------------------|
| 2026-11-27 | Initial plan | #60 acceptance criteria; existing template, architecture, STRIDE, and export paths |
