# Issue 380 — First run with Claude Code and Codex

## Objective

From a fresh checkout, a user can locate the existing ThreatForge MCP binary,
connect a local client to a dedicated workspace, review and apply an edit, and
reopen the saved document and its PNG screenshot.

## Issue contract

- **Issue:** #380; parent #368; related handbook work #160 and #162.
- **Type / effort / autonomy:** Feature / Medium / AUTO. M2 • Beta; proposed
  priority Medium. Project 2 status and fields are inaccessible under the
  existing exception.
- **Dependencies:** The existing Cargo binary and MCP workspace tools; the
  applicable Tauri platform build prerequisites.
- **Non-goals:** Installer or bundle changes, hosted MCP, new tools or protocol
  behavior, and authenticated Claude Code or Codex agent sessions.

## Current behavior and evidence

`src-tauri/Cargo.toml` already declares `threatforge-mcp`. The MCP knowledge
guide has registration snippets, but the README does not lead users there. The
existing `workspace_builds_an_architecture_and_exports_svg_and_png_over_stdio`
test already opens a dedicated workspace, previews and applies a batch using its
revision, and receives an inline screenshot. It does not write the screenshot
using the screenshot tool or reopen the edited document in a fresh MCP process.

## Implementation steps

### 1. Document the first run and verify client configuration

- **Files:** `docs/knowledge/mcp-server.md`, `README.md`.
- **Behavior:** Use the existing Cargo build output, document absolute executable
  and workspace paths, and give verified Claude Code CLI and project JSON plus
  Codex CLI and user TOML configurations. Link the first-run guide in the README.
- **Implementation:** Confirm commands and scope with
  [Claude Code MCP](https://code.claude.com/docs/en/mcp) and
  [Codex MCP](https://developers.openai.com/codex/mcp/). Include a two-step
  review/apply walkthrough and actionable path, trust, and stale-revision fixes.
- **Targeted verification:** If the public CLI packages can be installed, run
  local registration, configuration inspection, or connection commands with
  clean homes and no credentials. Record versions, output, and limits.

### 2. Verify the workflow through stdio

- **File:** `src-tauri/tests/mcp_stdio.rs`.
- **Behavior:** Extend the existing workspace scenario without removing its
  assertions. Write the PNG via `screenshot`, check it matches the returned
  image, then start a second process and verify the persisted revision and model.
- **Targeted verification:** Run `cargo test --manifest-path src-tauri/Cargo.toml
  --test mcp_stdio` using the real executable.

## Cross-cutting requirements

- Use a dedicated scratch directory, not a home or source directory, and no API
  keys, logins, or provider requests during client verification.
- No persisted schema, desktop bundle, or approval-policy changes. A stale
  preview must be refreshed and reviewed, not force-applied.
- Distinguish Claude Code connection checks and Codex configuration listing
  from an authenticated assistant turn. The stdio test verifies the end-to-end
  file workflow independently of either client.

## Verification gate

Run targeted CLI and stdio checks, then the canonical `npm run ci:local` gate once
per normal push and wait for hosted checks.

## Owner validation

Try registration and the preview/apply walkthrough from each client on your
platform. Confirm that the binary is easy to locate, the workspace scope is clear,
and the captured PNG is useful when viewed outside the client.

## Specialist review

- [ ] PR reviewer
- [ ] Slop auditor

## Replan log

| Date | Change | Evidence and reason |
|------|--------|---------------------|
| 2026-11-27 | Initial plan | #368 first-run validation and the existing stdio workspace coverage |
