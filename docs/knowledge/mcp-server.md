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
| `analyze_stride` | Preview STRIDE suggestions; set `apply: true` to save them as one edit. |
| `export_svg`, `export_png`, `screenshot` | Render the same scene. SVG is returned as text, PNG and screenshot as MCP images. Optional `path` writes an artifact inside the workspace, replacing an existing artifact of the same type. Screenshot is a headless diagram capture, not a desktop window capture. |

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
`revision` as `expected_revision`. A failed operation leaves the file unchanged.
The undo journal is session-local, with up to 20 edits per document for the 16 most
recently edited documents. It does not undo external edits or remove workspace files
created with `create_document`.

### Editor presentation and export

The editor's **Present diagram** control opens a read-only diagram with **Export SVG**
and **Export PNG**. The desktop uses the MCP Rust renderer directly; the browser loads
the same renderer as WebAssembly on demand. Clean documents use the saved model;
unsaved diagrams include the active canvas layout. Both targets embed Inter in SVG and use
the bundled static Inter faces for PNG, with DejaVu Sans for missing glyphs.

After changing the Rust scene or its model, regenerate the browser asset with
`bash scripts/build-scene-wasm.sh` (Rust target `wasm32-unknown-unknown` and
`wasm-bindgen-cli 0.2.114`). Keep the generated assets with the renderer changes.

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
| `delete_element` | `id` | Delete an element (cascades to connected flows) |

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

## Limitations

- Desktop notices MCP changes through disk revisions, not a direct session connection.
  Dirty tabs keep their unsaved changes until the user resolves the conflict.
- Unknown YAML fields on surviving entities are preserved, but comments and original formatting
  are not. See the [file-format contract](file-format.md#unknown-fields-and-downgrade-compatibility).
