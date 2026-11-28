# ThreatForge MCP Server

ThreatForge includes a Model Context Protocol (MCP) server that allows external AI tools to read and modify threat models programmatically.

## Overview

The MCP server lets external assistants create, edit, analyze, and export local ThreatForge documents over stdio. It does not require the desktop app, an account, or a hosted service.

## First run

### Build and locate the server

Install stable Rust and the [Tauri build prerequisites](https://v2.tauri.app/start/prerequisites/)
for your platform. From the root of a ThreatForge checkout:

```bash
cargo build --manifest-path src-tauri/Cargo.toml --locked --bin threatforge-mcp --target-dir src-tauri/target
```

Use the absolute path to `src-tauri/target/debug/threatforge-mcp` inside the
checkout (`threatforge-mcp.exe` on Windows). If you add `--release` to the build
command, use `target/release` instead of `target/debug`. You do not need to
install or start the ThreatForge desktop app.

### Choose a workspace

Create an empty, dedicated folder for models and exports. In the examples below,
replace `/absolute/path/to/architecture` with that folder and
`/absolute/path/to/threatforge-mcp` with your executable. The workspace must
exist before the client starts the server. Tool arguments such as
`first-run.thf` are relative to the workspace. Do not use your home or source
directory as the workspace.

### Claude Code

From the project where you use Claude Code, register the server privately for
that project:

```bash
claude mcp add --transport stdio --scope local threatforge -- "/absolute/path/to/threatforge-mcp" --workspace "/absolute/path/to/architecture"
claude mcp get threatforge
```

Alternatively, add the following to `.mcp.json` at the project root. Merge the
`threatforge` entry into any existing `mcpServers` object; don't register the
same server in both scopes. Each machine needs usable local paths.

```json
{
  "mcpServers": {
    "threatforge": {
      "type": "stdio",
      "command": "/absolute/path/to/threatforge-mcp",
      "args": ["--workspace", "/absolute/path/to/architecture"]
    }
  }
}
```

Review and approve project-scoped servers when Claude Code prompts you.
Use `claude mcp list` to check for `Connected`, or `/mcp` within Claude Code
to inspect the connected tools. See the [Claude Code MCP documentation](https://code.claude.com/docs/en/mcp).

### Codex

```bash
codex mcp add threatforge -- "/absolute/path/to/threatforge-mcp" --workspace "/absolute/path/to/architecture"
codex mcp get threatforge
```

Alternatively, add this block to `~/.codex/config.toml` (or `config.toml` in
your `CODEX_HOME` when set):

```toml
[mcp_servers.threatforge]
command = "/absolute/path/to/threatforge-mcp"
args = ["--workspace", "/absolute/path/to/architecture"]
```

Run `codex mcp list` to check that the entry is enabled. This lists configuration,
not server health. Use `/mcp` in a Codex session to inspect the connected tools.
See the [Codex MCP documentation](https://developers.openai.com/codex/mcp/).

### Preview, save, and capture a screenshot

Start a new client session and use a scratch document. For example, ask:

> Use ThreatForge to create `first-run.thf` in the workspace. Preview a
> `batch_transaction` with `dry_run: true` to add a process named Web API and
> give it a position. Show me the proposed edits and wait for approval; do not
> apply the batch yet.

After reviewing the proposed edit, ask the client to apply the same batch with
the preview's `revision` as `expected_revision`. Then ask it to run
`screenshot` with `path: "first-run.png"`, reopen `first-run.thf` with
`open_document`, and use `get_model` to verify the saved Web API element.
Both files should be in the workspace. The PNG is a headless diagram render,
not a capture of the desktop window.

### Troubleshooting

| Symptom | What to check |
|---|---|
| The server is missing or can't connect | Check the binary path and executable permission (or the `.exe` suffix on Windows), and that the workspace directory already exists. Start a fresh client session after editing configuration. |
| Claude Code reports pending approval | Start Claude Code in the project with `.mcp.json`, review the project and server approval prompts, and check `claude mcp get threatforge` again. |
| An argument or path is rejected | Keep executable and workspace paths absolute in client configuration. In JSON or TOML, escape Windows backslashes as `\\` and keep each argument as a separate array entry. Use a workspace-relative file name for document and screenshot tools; traversal and symlink paths are refused. |
| There is no active document | Workspace mode starts without an active document. Use `list_documents` and `open_document`, or `create_document` for a new file. |
| The file changed after preview | Reopen it, run a new dry run, and review the new edits before applying. Don't remove the revision check to bypass a conflict. |

The server itself needs no account, API key, or network service. Your client
may require its own sign-in to run an interactive assistant turn.

## Other configurations

Single-file mode remains supported: invoke the executable with an absolute
`.thf` path instead of `--workspace` and its directory. Workspace discovery and
file exports are unavailable in single-file mode, but inline SVG and PNG work.

### VS Code (Copilot / Continue)

Add to your VS Code settings or MCP extension configuration:

```json
{
  "mcp.servers": {
    "threatforge": {
      "command": "/path/to/threatforge-mcp",
      "args": ["/path/to/your-model.thf"]
    }
  }
}
```

### Cursor

Add to your Cursor MCP configuration:

```json
{
  "mcpServers": {
    "threatforge": {
      "command": "/path/to/threatforge-mcp",
      "args": ["/path/to/your-model.thf"]
    }
  }
}
```

## Available Tools

### Workspace, layout, and exports

| Tool | Use |
|---|---|
| `create_document` | Create and activate a new `.thf` with `path`, `title`, and optional `author`. Refuses to overwrite an existing file. |
| `list_documents`, `search_documents` | List relative document paths; search valid files by relative path or title. Results are capped at 200, report truncation, and skip hidden directories. |
| `open_document` | Activate an existing document by relative `path`; subsequent diagram and threat tools use it. |
| `set_position`, `move_node`, `resize_node` | Set `x,y`, offset by `dx,dy`, or set `width,height` given a node `id`. Nodes may be elements, trust boundaries, or architecture groups. An element inside a trust boundary uses positions relative to the boundary. |
| `auto_layout` | Arrange elements in a grid, keeping boundary members together. |
| `batch_transaction` | Apply 1–100 graph, layout, or sequence operations as a single transaction. |
| `get_sequence_view` | Read a typed sequence by `diagram_id`. `offset` and `limit` page each ordered list; the limit defaults to 50 and is capped at 200. |
| `undo`, `redo` | Replay active-document edits from this MCP session, only if the file revision still matches. |
| `analyze_stride` | Preview STRIDE suggestions. Save the latest preview as one edit with `apply: true`, its `preview_id`, and its `revision` as `expected_revision`. |
| `export_svg`, `export_png`, `screenshot` | Render the same scene. Pass `diagram_id` for an explicit view, or omit it for the graph. SVG is returned as text, PNG and screenshot as MCP images. Optional `path` writes an artifact inside the workspace, replacing an existing artifact of the same type. Screenshot is a headless diagram capture, not a desktop window capture. |
| `export_markdown` | Return a deterministic Markdown review of the active document's components, data flows, findings, and mitigations. An optional workspace-relative `.md` `path` writes the same bytes in workspace mode. The model is not changed. |

Use `add_relationship`, `update_relationship`, or `delete_relationship` as operations
inside `batch_transaction`. Add takes `id`, `type`, `from`, and `to`; the endpoints
must be existing elements, and the ID must not match another relationship or data
flow. Add and update accept `name`, `description`, `stroke_color` (six-digit hex),
and `stroke_opacity` (0–1). Update takes the existing `id` and changes only the
supplied values. Use `null` to clear the name, description, or either stroke
override; omit a key to keep its value. Changing an endpoint clears its old handle.
Each result contains
the operation's `action` and `id`. Relationships do not feed STRIDE analysis.

Groups and layers also use batch operations. `add_group` and `add_layer` take
`id` and `name`, plus optional `description` (and `type` for groups).
`update_group` and `update_layer` take the existing `id` and any metadata to
change. Use `null` to clear the description or group type; names cannot be cleared.
Use `reparent_group` with `id` and `parent`, and `set_element_group`
or `set_element_layer` with the element `id` and `group` or `layer`. Supply
the destination ID or explicit `null` to clear it. These operations do not
change geometry or security boundaries. Before `delete_group` or `delete_layer`
(both take `id`), move or clear any members and child groups; this can be done
in the same batch, before the delete.

Use `create_sequence_view` or `update_sequence_view` inside `batch_transaction` with
`diagram_id`, `name`, `participants`, and `messages`. Update replaces the ordered lists.
`delete_sequence_view` takes only `diagram_id` and does not remove graph items. Preview
with `dry_run: true` and reuse the returned revision as `expected_revision` when applying.
If a graph edit would break a sequence reference, remove or unlink the reference first.

Search reads at most 1 MiB per document and 32 MiB in total and skips documents
that use YAML aliases. Its `skipped` count also reports files it could not read or
validate within those limits.

Exports use a held directory handle and recheck its workspace path before
committing the rename. If another process can move that directory between the
final check and the rename, the export can land in the moved directory. Only
enable workspace writes in directories whose ancestry you control.

If only some STRIDE suggestions are approved, use `batch_transaction` with one
`add_threat` operation per approved suggestion and the preview's `revision` as
`expected_revision`. Use `analyze_stride` with `apply: true` only to persist the
entire preview.

For a batch, use these arguments to preview adding a node and positioning it:

```json
{
  "dry_run": true,
  "operations": [
    {"tool": "add_element", "arguments": {"element_type": "process", "name": "Public API"}},
    {"tool": "set_position", "arguments": {"id": "public-api", "x": 60, "y": 100}}
  ]
}
```

Review the results, then repeat without `dry_run` and pass the preview's
`revision` as `expected_revision`. MCP revisions are opaque and bound to the
canonical document path and file contents. Dry-run revisions also cover the legacy
sidecar layout used by relative moves. A failed operation leaves the file unchanged.
The undo journal is session-local, with up to 20 edits per document for the 16 most
recently edited documents. It restores the exact file bytes, including comments and
formatting. It does not undo external edits or remove workspace files
created with `create_document`.

### Editor presentation and export

The editor's **Present diagram** control opens a read-only diagram with **Export SVG**
and **Export PNG**. The desktop uses the MCP Rust renderer directly; the browser loads
the same renderer as WebAssembly on demand. Clean documents use the saved model;
unsaved diagrams include the active canvas layout. SVG embeds a deterministic Inter subset for
the visible text, including the layout tables and glyph dependencies needed to shape it.
PNG uses bundled static Inter faces, with DejaVu Sans for missing glyphs.

Byte-for-byte browser/MCP parity applies to the same saved inline-layout document.
The browser's single-file picker cannot load legacy JSON layout sidecars and shows
**Layout sidecar not loaded** rather than silently claiming parity. Open and save
the model in the desktop app with its original sidecar present to migrate its
positions, sizes and viewport inline before exporting it in the browser.

After changing the Rust scene or its model, regenerate the browser asset with
`bash scripts/build-scene-wasm.sh` (Rust 1.99.1 with target
`wasm32-unknown-unknown`, and `wasm-bindgen-cli 0.2.114`). Keep the generated
assets with the renderer changes; CI rebuilds and byte-compares both assets.

### MCP resources and prompts

Read the active document YAML at `threatforge://active/model` and its SVG at
`threatforge://active/diagram`. Clients that support MCP prompts can use
`build_architecture` and `review_threat_model` to start the corresponding workflow.

### Read Operations

| Tool | Description |
|------|-------------|
| `get_model` | Returns the full threat model as JSON |
| `list_elements` | Lists all DFD elements with IDs, types, and names |
| `list_threats` | Lists all threats with IDs, titles, categories, and severities |

### Element Operations

| Tool | Parameters | Description |
|------|-----------|-------------|
| `add_element` | `element_type`, `name`, `trust_zone?`, `description?`, `technologies?` | Add a new DFD element |
| `update_element` | `id`, `name?`, `element_type?`, `trust_zone?`, `description?` | Update an element |
| `delete_element` | `id` | Delete an element and report the [cascade](#cascading-deletes) |

### Data Flow Operations

| Tool | Parameters | Description |
|------|-----------|-------------|
| `add_data_flow` | `from`, `to`, `name?`, `protocol?`, `data?`, `authenticated?` | Add a data flow between elements |
| `delete_data_flow` | `id` | Delete a data flow |

### Trust Boundary Operations

| Tool | Parameters | Description |
|------|-----------|-------------|
| `add_trust_boundary` | `name`, `contains?` | Add a trust boundary |
| `delete_trust_boundary` | `id` | Delete a trust boundary |

### Threat Operations

| Tool | Parameters | Description |
|------|-----------|-------------|
| `add_threat` | `title`, `category`, `severity`, `description`, `element?`, `flow?` | Add a STRIDE threat |
| `delete_threat` | `id` | Delete a threat |

## Element Types

- `process` — A software process or service
- `data_store` — A database or persistent storage
- `external_entity` — An external system or actor
- `text` — A free-form text annotation

## STRIDE Categories

- `Spoofing`
- `Tampering`
- `Repudiation`
- `Information Disclosure`
- `Denial of Service`
- `Elevation of Privilege`

## Severity Levels

- `critical`, `high`, `medium`, `low`, `info`

## How It Works

The MCP server:

1. Loads the selected `.thf` on single-file startup, or waits for a create/open request in workspace mode
2. Reloads from disk before each operation (picks up external changes)
3. Validates and commits each mutation using the same atomic, revision-checked writer as desktop
4. Communicates via JSON-RPC over stdin/stdout

This file-based approach means the MCP server and the ThreatForge desktop app can work with the same file. The desktop app must reopen the file to load MCP changes; there is no real-time synchronization. If another writer commits before a mutation can save, it fails with a conflict instead of overwriting the other edit.

## Cascading Deletes

When an element is deleted:
- All data flows connected to that element are removed
- The element is removed from any trust boundary `contains` lists
- Relationships connected to that element and threats targeting the element or any removed flow are removed

Deleting a data flow directly also removes threats targeting it.
Both delete tools return a `message` and the IDs removed from `data_flows`,
`relationships`, and `threats` under `removed`. The same details appear in each
delete operation's batch result, including in a dry run.

## Limitations

- Desktop notices MCP changes through disk revisions, not a direct session connection.
  Dirty tabs keep their unsaved changes until the user resolves the conflict.
- Unknown YAML fields on surviving entities are preserved, but comments and original formatting
  are not. See the [file-format contract](file-format.md#unknown-fields-and-downgrade-compatibility).
