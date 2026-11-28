# Visual workflow regressions

These specs run real browser workflows in the same pinned Playwright Chromium image as
hosted E2E. The existing `canvas-visual.spec.ts` suite covers specific canvas and inspector
states; this directory covers meaningful transitions and results. A screenshot complements
the assertions; it does not replace them.

## Add or extend a flow

1. Put a user workflow in its own `<flow>.spec.ts`, importing `test` and `checkpoint` from
   `./checkpoint`. Give each `test.step` the user's intent and use a stable filename for each
   checkpoint.
2. Drive actions through the rendered UI and reuse `../support/interactions.ts` and the named
   workspace fixtures. Prefer a checked-in `.thf` for existing diagrams. The shared fixture
   provides a 1440 × 900 viewport, light theme, 1× scale, a fixed starting clock, and reduced
   motion; use a scoped `test.use` override only when a different state matters.
3. Assert the outcome before capturing it. Use `waitForCanvasSettled` for screenshots that
   include diagram geometry, and use the smallest meaningful locator crop. The checkpoint
   waits for local fonts and disables animations. Don't use sleeps, broad masking, or global
   screenshot tolerances to hide nondeterminism.
4. The original architecture and threat-modeling flows use 15 baselines. Sequence and
   interview add four checkpoints with a separate budget of at most 30 seconds of summed
   hosted test durations. Add a second theme baseline only when it proves something the
   primary view doesn't.

## Sequence and interview coverage

- `sequence.spec.ts` reorders an annotation and linked message, saves, reopens, and
  verifies the sequence presentation renders. The stdio and export-parity suites test
  revision, layout, and browser/MCP SVG and PNG bytes separately.
- `interview.spec.ts` reviews an offline proposal including a directional flow and its
  dependency, applies it, then runs STRIDE as a separate action. The functional
  `../interview.spec.ts` verifies undo, reopen, and consent/cancellation without extra PNGs.

## Review or update a baseline

Use Node 22 and the exact Playwright image pinned in the E2E job in
[`ci.yml`](../../.github/workflows/ci.yml) (install dependencies in that environment if
needed). Inside that environment, run:

```sh
CANVAS_VISUAL_BASELINES=1 npm run test:e2e -- e2e/visual-flows --workers=1 --update-snapshots=none
```

When the visual change is intentional, narrow the command to the affected spec (and
`--grep` if needed), then use `--update-snapshots=changed`. Compare expected, actual, and
diff images in the Playwright report before accepting; repeat the comparison with
`--update-snapshots=none` and commit only the intended PNGs. Hosted CI never rewrites
baselines. The expected and actual artifact attachments are described in
[`e2e/support/README.md`](../support/README.md).

## MCP fixture provenance

`../fixtures/mcp-orders.thf` is unchanged output from `threatforge-mcp --workspace`
using `create_document` (path `mcp-orders.thf`, title “Orders Architecture”, author
“Visual fixture”), then one `batch_transaction`: add “Orders API” (process) and
“Orders Store” (data store), set positions to (40, 80) and (350, 80), and add the
“Write order” flow between them. The browser flow proves that this output can be
opened and edited, not that the MCP server ran in the browser test. The Rust MCP
stdio and browser/MCP export parity tests verify the live boundaries separately.
