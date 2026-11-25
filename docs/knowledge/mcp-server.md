# ThreatForge MCP Server

ThreatForge includes a Model Context Protocol (MCP) server that allows external AI tools to read and modify threat models programmatically.

## Overview

The MCP server lets external assistants create, edit, analyze, and export local ThreatForge documents over stdio. It does not require the desktop app, an account, or a hosted service.

## Building

The MCP server binary is built alongside the main application:

```bash
cd src-tauri
cargo build --bin threatforge-mcp            # Debug build
cargo build --release --bin threatforge-mcp  # Release build (optimized)
```

The binary will be at `src-tauri/target/debug/threatforge-mcp` (debug) or `src-tauri/target/release/threatforge-mcp` (release). Use the release build for production.

## Usage

```bash
threatforge-mcp --workspace /absolute/path/to/architecture
threatforge-mcp /absolute/path/to/model.thf
```

Workspace mode starts without an active file. The root must already exist. Tools take paths relative to the root, including existing subdirectories; absolute paths, traversal, and symlink paths are not accepted. Use a dedicated architecture folder, not an entire home directory. Single-file mode remains supported for existing configurations; workspace discovery and file exports are unavailable there, but inline SVG and PNG still work.

## Configuration

### Claude Code

Register the server with Claude Code:

```bash
claude mcp add --transport stdio --scope local threatforge -- /absolute/path/to/threatforge-mcp --workspace /absolute/path/to/architecture
```

For shared project settings use `.mcp.json` at the project root, with paths appropriate to the project:

```json
{
  "mcpServers": {
    "threatforge": {
      "command": "/path/to/threatforge-mcp",
      "args": ["--workspace", "/path/to/architecture"]
    }
  }
}
```

### Codex

```bash
codex mcp add threatforge -- /absolute/path/to/threatforge-mcp --workspace /absolute/path/to/architecture
```

The equivalent entry in `~/.codex/config.toml` is:

```toml
[mcp_servers.threatforge]
command = "/absolute/path/to/threatforge-mcp"
args = ["--workspace", "/absolute/path/to/architecture"]
```

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
| `batch_transaction` | Apply 1–100 graph or layout operations as a single transaction. |
| `undo`, `redo` | Replay active-document edits from this MCP session, only if the file revision still matches. |
| `analyze_stride` | Preview STRIDE suggestions. Save the latest preview as one edit with `apply: true`, its `preview_id`, and its `revision` as `expected_revision`. |
| `export_svg`, `export_png`, `screenshot` | Render the same scene. SVG is returned as text, PNG and screenshot as MCP images. Optional `path` writes an artifact inside the workspace, replacing an existing artifact of the same type. Screenshot is a headless diagram capture, not a desktop window capture. |

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
