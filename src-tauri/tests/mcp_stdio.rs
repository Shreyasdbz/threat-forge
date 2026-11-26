//! End-to-end check that the `threatforge-mcp` binary starts, completes the MCP
//! handshake over stdio, advertises its tools, and executes one.
//!
//! This drives the real binary over real pipes rather than calling the handler
//! directly, so a transport or protocol regression cannot pass unnoticed.

use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::time::Duration;

use serde_json::{json, Value};

/// Generous enough for a cold process start on a loaded CI runner, short enough
/// that a hung server fails the test instead of the job.
const RESPONSE_TIMEOUT: Duration = Duration::from_secs(30);

const MODEL_THF: &str = "\
version: '1.0'
metadata:
  title: MCP Fixture
  author: Tester
  created: 2026-01-01
  modified: 2026-01-01
  description: ''
elements: []
data_flows: []
trust_boundaries: []
threats: []
diagrams:
- id: main-dfd
  name: Level 0 DFD
";

/// A running `threatforge-mcp` process with line-oriented JSON-RPC plumbing.
struct McpServer {
    child: Child,
    stdin: ChildStdin,
    stdout: Receiver<String>,
}

impl McpServer {
    fn spawn(model_path: &std::path::Path) -> Self {
        Self::spawn_with([model_path.as_os_str()])
    }

    fn spawn_workspace(root: &std::path::Path) -> Self {
        Self::spawn_with([std::ffi::OsStr::new("--workspace"), root.as_os_str()])
    }

    fn spawn_with(args: impl IntoIterator<Item = impl AsRef<std::ffi::OsStr>>) -> Self {
        let mut child = Command::new(env!("CARGO_BIN_EXE_threatforge-mcp"))
            .args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .expect("threatforge-mcp should start");

        let stdin = child.stdin.take().expect("stdin is piped");
        let raw_stdout = child.stdout.take().expect("stdout is piped");

        // Read on a worker thread so a silent server times out instead of
        // blocking the test forever.
        let (tx, stdout) = mpsc::channel();
        std::thread::spawn(move || {
            for line in BufReader::new(raw_stdout).lines().map_while(Result::ok) {
                if tx.send(line).is_err() {
                    break;
                }
            }
        });

        Self {
            child,
            stdin,
            stdout,
        }
    }

    fn send(&mut self, message: &Value) {
        writeln!(self.stdin, "{message}").expect("request should be written");
        self.stdin.flush().expect("request should be flushed");
    }

    /// Send a request and return its `result` payload.
    fn request(&mut self, id: u32, method: &str, params: Value) -> Value {
        let response = self.request_raw(id, method, params);
        assert!(
            response.get("error").is_none(),
            "`{method}` returned an error: {response}"
        );
        response["result"].clone()
    }

    fn request_raw(&mut self, id: u32, method: &str, params: Value) -> Value {
        self.send(&json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        }));

        let line = match self.stdout.recv_timeout(RESPONSE_TIMEOUT) {
            Ok(line) => line,
            Err(RecvTimeoutError::Timeout) => panic!("timed out waiting for a `{method}` response"),
            Err(RecvTimeoutError::Disconnected) => {
                panic!("server exited before answering `{method}`")
            }
        };

        let response: Value = serde_json::from_str(&line)
            .unwrap_or_else(|e| panic!("`{method}` response is not JSON ({e}): {line}"));
        assert_eq!(response["id"], json!(id), "response id mismatch: {line}");
        response
    }

    fn start_workspace(&mut self) -> Value {
        let init = self.request(1, "initialize", initialize_params("2025-11-25"));
        self.send(&json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }));
        init
    }

    fn tool(&mut self, id: u32, name: &str, arguments: Value) -> Value {
        let result = self.request(
            id,
            "tools/call",
            json!({ "name": name, "arguments": arguments }),
        );
        assert_ne!(result["isError"], true, "{name}: {result}");
        result
    }

    fn tool_json(&mut self, id: u32, name: &str, arguments: Value) -> Value {
        let result = self.tool(id, name, arguments);
        serde_json::from_str(result["content"][0]["text"].as_str().expect("text result"))
            .unwrap_or_else(|error| panic!("{name} returned invalid JSON: {error}"))
    }
}

impl Drop for McpServer {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn initialize_params(protocol_version: &str) -> Value {
    json!({
        "protocolVersion": protocol_version,
        "capabilities": {},
        "clientInfo": { "name": "threatforge-tests", "version": "0" },
    })
}

#[test]
fn mcp_graph_edits_preserve_opaque_and_typed_sequence_values() {
    for (fixture, view) in [
        (
            include_str!("../../tests/fixtures/thf/v1.0-opaque-sequence.thf"),
            0,
        ),
        (
            include_str!("../../tests/fixtures/thf/v1.1-sequence.thf"),
            1,
        ),
    ] {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("model.thf");
        std::fs::write(&path, fixture).expect("fixture .thf should be written");
        let before: serde_yaml::Value = serde_yaml::from_str(fixture).expect("fixture YAML");
        let mut server = McpServer::spawn(&path);
        server.start_workspace();
        server.tool(
            2,
            "add_element",
            json!({ "name": "Audit log", "element_type": "process" }),
        );
        let persisted = std::fs::read_to_string(&path).expect("edited .thf");
        let after: serde_yaml::Value = serde_yaml::from_str(&persisted).expect("edited YAML");
        assert_eq!(after["version"], before["version"]);
        assert_eq!(
            after["diagrams"][view]["sequence"],
            before["diagrams"][view]["sequence"]
        );
        assert!(persisted.contains("Audit log"));
        server.request(
            3,
            "resources/read",
            json!({ "uri": "threatforge://active/model" }),
        );
    }
}

#[test]
fn mcp_server_handshakes_lists_its_tools_and_executes_one_over_stdio() {
    let dir = tempfile::tempdir().expect("temp dir");
    let model_path = dir.path().join("model.thf");
    std::fs::write(&model_path, MODEL_THF).expect("fixture .thf should be written");

    let mut server = McpServer::spawn(&model_path);

    let init = server.request(1, "initialize", initialize_params("2024-11-05"));
    assert_eq!(init["protocolVersion"], json!("2024-11-05"));
    assert_eq!(init["serverInfo"]["name"], json!("threatforge-mcp"));
    assert!(
        init["capabilities"]["tools"].is_object(),
        "server must advertise the tools capability: {init}"
    );

    server.send(&json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }));

    let listed = server.request(2, "tools/list", json!({}));
    let mut names: Vec<&str> = listed["tools"]
        .as_array()
        .expect("tools/list returns an array")
        .iter()
        .map(|t| t["name"].as_str().expect("each tool has a name"))
        .collect();
    names.sort_unstable();
    assert_eq!(
        names,
        [
            "add_data_flow",
            "add_element",
            "add_threat",
            "add_trust_boundary",
            "analyze_stride",
            "auto_layout",
            "batch_transaction",
            "create_document",
            "delete_data_flow",
            "delete_element",
            "delete_threat",
            "delete_trust_boundary",
            "export_png",
            "export_svg",
            "get_model",
            "get_sequence_view",
            "list_documents",
            "list_elements",
            "list_threats",
            "move_node",
            "open_document",
            "redo",
            "resize_node",
            "screenshot",
            "search_documents",
            "set_position",
            "undo",
            "update_element",
        ]
    );

    let called = server.request(
        3,
        "tools/call",
        json!({
            "name": "add_element",
            "arguments": { "element_type": "process", "name": "Web API" },
        }),
    );
    assert_eq!(
        called["content"][0]["text"],
        json!("Added element: web-api"),
        "add_element should report the generated id: {called}"
    );

    let saved = std::fs::read_to_string(&model_path).expect("model file should still be readable");
    assert!(
        saved.contains("id: web-api"),
        "the tool call must be persisted to the .thf file, got:\n{saved}"
    );
}

/// The server declares `2024-11-05` in `get_info`, but rmcp echoes back any
/// protocol version it recognises, so a newer client is not silently downgraded
/// and an unrecognised one falls back to the declared version.
#[test]
fn mcp_server_negotiates_a_known_protocol_version_and_falls_back_otherwise() {
    let dir = tempfile::tempdir().expect("temp dir");
    let model_path = dir.path().join("model.thf");
    std::fs::write(&model_path, MODEL_THF).expect("fixture .thf should be written");

    let mut newer = McpServer::spawn(&model_path);
    let init = newer.request(1, "initialize", initialize_params("2025-11-25"));
    assert_eq!(init["protocolVersion"], json!("2025-11-25"));

    let mut unknown = McpServer::spawn(&model_path);
    let init = unknown.request(1, "initialize", initialize_params("1999-01-01"));
    assert_eq!(init["protocolVersion"], json!("2024-11-05"));
}

#[test]
fn workspace_builds_an_architecture_and_exports_svg_and_png_over_stdio() {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let dir = tempfile::tempdir().unwrap();
    let mut server = McpServer::spawn_workspace(dir.path());
    let init = server.start_workspace();
    assert!(init["capabilities"]["resources"].is_object());
    assert!(init["capabilities"]["prompts"].is_object());

    let created = server.tool_json(
        2,
        "create_document",
        json!({
            "path": "architecture.thf", "title": "API & Store", "author": "Test"
        }),
    );
    assert_eq!(created["path"], "architecture.thf");
    assert_eq!(
        server.tool_json(3, "list_documents", json!({}))["documents"],
        json!(["architecture.thf"])
    );
    assert_eq!(
        server.tool_json(4, "search_documents", json!({ "query": "STORE" }))["documents"][0]
            ["path"],
        "architecture.thf"
    );
    assert_eq!(
        server.tool_json(5, "open_document", json!({ "path": "architecture.thf" }))["revision"],
        created["revision"]
    );

    let ops = json!([
        { "tool": "add_element", "arguments": { "element_type": "process", "name": "Web API" } },
        { "tool": "add_element", "arguments": { "element_type": "data_store", "name": "Orders DB" } },
        { "tool": "set_position", "arguments": { "id": "web-api", "x": 40, "y": 80 } },
        { "tool": "set_position", "arguments": { "id": "orders-db", "x": 340, "y": 80 } },
        { "tool": "move_node", "arguments": { "id": "orders-db", "dx": 10, "dy": 20 } },
        { "tool": "resize_node", "arguments": { "id": "orders-db", "width": 200, "height": 90 } },
        { "tool": "add_data_flow", "arguments": { "from": "web-api", "to": "orders-db", "name": "Read & write" } }
    ]);
    let model_path = dir.path().join("architecture.thf");
    let before = std::fs::read(&model_path).unwrap();
    let preview = server.tool_json(
        6,
        "batch_transaction",
        json!({ "operations": ops, "dry_run": true }),
    );
    assert_eq!(preview["revision"], created["revision"]);
    assert_eq!(preview["results"].as_array().unwrap().len(), 7);
    assert_eq!(std::fs::read(&model_path).unwrap(), before);
    let committed = server.tool_json(
        7,
        "batch_transaction",
        json!({
            "operations": ops, "expected_revision": preview["revision"]
        }),
    );
    assert_ne!(committed["revision"], created["revision"]);
    let model = server.tool_json(8, "get_model", json!({}));
    assert_eq!(
        model["elements"][0]["position"],
        json!({ "x": 40.0, "y": 80.0 })
    );
    assert_eq!(
        model["elements"][1]["position"],
        json!({ "x": 350.0, "y": 100.0 })
    );
    assert_eq!(
        model["elements"][1]["size"],
        json!({ "width": 200.0, "height": 90.0 })
    );
    assert_eq!(model["data_flows"][0]["to"], "orders-db");

    let stride = server.tool_json(9, "analyze_stride", json!({}));
    assert_eq!(stride["revision"], committed["revision"]);
    assert!(stride["threats"]
        .as_array()
        .unwrap()
        .iter()
        .any(|item| { item["flow"] == "flow-1" && item["category"] == "Tampering" }));
    assert!(server.tool_json(10, "get_model", json!({}))["threats"]
        .as_array()
        .unwrap()
        .is_empty());
    let applied = server.tool_json(11, "analyze_stride", json!({
        "apply": true, "expected_revision": stride["revision"], "preview_id": stride["preview_id"]
    }));
    assert_eq!(applied["threats"], stride["threats"]);
    assert_ne!(applied["revision"], committed["revision"]);
    assert_eq!(
        server.tool_json(12, "get_model", json!({}))["threats"],
        applied["threats"]
    );

    let exported_svg = server.tool(13, "export_svg", json!({ "path": "diagram.svg" }));
    let svg = std::fs::read_to_string(dir.path().join("diagram.svg")).unwrap();
    assert_eq!(exported_svg["content"][1]["text"], svg);
    assert!(svg.contains("<title>API &amp; Store</title>"));
    assert!(svg.contains("@font-face{font-family:Inter;src:url(data:font/ttf;base64,AAEAAA"));
    assert!(svg.contains("Read &amp; write"));
    assert!(svg.contains(r#"x="350.00" y="100.00" width="200.00" height="90.00""#));

    let exported_png = server.tool(14, "export_png", json!({ "path": "diagram.png" }));
    let png = std::fs::read(dir.path().join("diagram.png")).unwrap();
    assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n");
    let pixels = resvg::tiny_skia::Pixmap::decode_png(&png).expect("valid rendered PNG");
    assert!(pixels.width() > 550 && pixels.height() > 190);
    assert!(pixels
        .data()
        .chunks_exact(4)
        .any(|pixel| pixel == [255, 255, 255, 255]));
    assert_eq!(&pixels.data()[..4], &[247, 248, 250, 255]);
    assert_eq!(exported_png["content"][1]["mimeType"], "image/png");
    assert_eq!(
        STANDARD
            .decode(exported_png["content"][1]["data"].as_str().unwrap())
            .unwrap(),
        png
    );
    assert_eq!(
        server.tool(15, "screenshot", json!({}))["content"][0],
        exported_png["content"][1]
    );

    let resources = server.request(16, "resources/list", json!({}));
    assert_eq!(resources["resources"].as_array().unwrap().len(), 2);
    let diagram = server.request(
        17,
        "resources/read",
        json!({ "uri": "threatforge://active/diagram" }),
    );
    assert_eq!(diagram["contents"][0]["text"], svg);
    let prompts = server.request(18, "prompts/list", json!({}));
    assert_eq!(prompts["prompts"][0]["name"], "build_architecture");
    let prompt = server.request(19, "prompts/get", json!({ "name": "review_threat_model" }));
    assert!(prompt["messages"][0]["content"]["text"]
        .as_str()
        .unwrap()
        .contains("analyze_stride"));
}

#[test]
fn workspace_batches_are_atomic_and_undo_redo_refuses_external_edits() {
    let dir = tempfile::tempdir().unwrap();
    let mut server = McpServer::spawn_workspace(dir.path());
    server.start_workspace();
    let rejected = server.request_raw(
        2,
        "tools/call",
        json!({
            "name": "create_document", "arguments": { "path": "../outside.thf", "title": "No" }
        }),
    );
    assert!(rejected["error"].is_object() || rejected["result"]["isError"] == true);
    let created = server.tool_json(
        3,
        "create_document",
        json!({ "path": "work.thf", "title": "Work" }),
    );
    let path = dir.path().join("work.thf");
    let original = std::fs::read_to_string(&path).unwrap();
    let failed = server.request_raw(4, "tools/call", json!({
        "name": "batch_transaction", "arguments": { "operations": [
            { "tool": "add_element", "arguments": { "element_type": "process", "name": "Service" } },
            { "tool": "set_position", "arguments": { "id": "missing", "x": 1, "y": 2 } }
        ] }
    }));
    assert!(failed.to_string().contains("Operation 2"));
    assert_eq!(std::fs::read_to_string(&path).unwrap(), original);

    server.tool(
        5,
        "add_element",
        json!({ "element_type": "process", "name": "Service" }),
    );
    server.tool(6, "auto_layout", json!({}));
    assert_eq!(
        server.tool_json(7, "get_model", json!({}))["elements"][0]["position"],
        json!({ "x": 48.0, "y": 48.0 })
    );
    server.tool(8, "undo", json!({}));
    assert!(server.tool_json(9, "get_model", json!({}))["elements"][0]["position"].is_null());
    server.tool(10, "undo", json!({}));
    assert_eq!(std::fs::read_to_string(&path).unwrap(), original);
    server.tool(11, "redo", json!({}));
    server.tool(12, "redo", json!({}));
    assert_eq!(
        server.tool_json(13, "get_model", json!({}))["elements"][0]["position"]["x"],
        48.0
    );
    let stale = server.request_raw(14, "tools/call", json!({
        "name": "batch_transaction", "arguments": { "expected_revision": created["revision"], "operations": [
            { "tool": "delete_element", "arguments": { "id": "service" } }
        ] }
    }));
    assert!(stale.to_string().contains("changed on disk"));
    let external = original.replace("title: Work", "title: External edit");
    assert_ne!(external, original);
    std::fs::write(&path, &external).unwrap();
    let conflict = server.request_raw(15, "tools/call", json!({ "name": "undo", "arguments": {} }));
    assert!(conflict.to_string().contains("changed on disk"));
    assert_eq!(std::fs::read_to_string(&path).unwrap(), external);
}

#[test]
fn workspace_relative_moves_use_sidecar_and_scene_fallback_positions() {
    let dir = tempfile::tempdir().unwrap();
    let original = MODEL_THF
        .replace("elements: []", "elements:\n- id: api\n  type: process\n  name: API\n- id: worker\n  type: process\n  name: Worker")
        .replace("  name: Level 0 DFD", "  name: Level 0 DFD\n  layout_file: layout.json");
    std::fs::write(dir.path().join("work.thf"), original).unwrap();
    std::fs::write(
        dir.path().join("layout.json"),
        br#"{"diagram_id":"main-dfd","viewport":{"x":0,"y":0,"zoom":1},"nodes":[{"id":"api","x":120,"y":240}]}"#,
    )
    .unwrap();
    let mut server = McpServer::spawn_workspace(dir.path());
    server.start_workspace();
    server.tool(2, "open_document", json!({ "path": "work.thf" }));
    server.tool(3, "move_node", json!({ "id": "api", "dx": 10, "dy": -20 }));
    server.tool_json(
        4,
        "batch_transaction",
        json!({ "operations": [
        { "tool": "move_node", "arguments": { "id": "worker", "dx": 10, "dy": -20 } }
    ] }),
    );
    let model = server.tool_json(5, "get_model", json!({}));
    assert_eq!(
        model["elements"][0]["position"],
        json!({ "x": 130.0, "y": 220.0 })
    );
    assert_eq!(
        model["elements"][1]["position"],
        json!({ "x": 402.0, "y": 28.0 })
    );
}

#[test]
fn workspace_batch_preview_is_scoped_to_the_selected_document() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("a.thf"), MODEL_THF).unwrap();
    std::fs::write(dir.path().join("b.thf"), MODEL_THF).unwrap();
    let mut server = McpServer::spawn_workspace(dir.path());
    server.start_workspace();
    let operations = json!([
        { "tool": "add_element", "arguments": { "element_type": "process", "name": "Service" } }
    ]);
    server.tool(2, "open_document", json!({ "path": "a.thf" }));
    let preview = server.tool_json(
        3,
        "batch_transaction",
        json!({
            "dry_run": true, "operations": operations
        }),
    );
    let commit = json!({ "operations": operations, "expected_revision": preview["revision"] });
    server.tool(4, "open_document", json!({ "path": "b.thf" }));
    let response = server.request_raw(
        5,
        "tools/call",
        json!({
            "name": "batch_transaction", "arguments": commit
        }),
    );
    assert!(
        response.to_string().contains("changed on disk"),
        "{response}"
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join("b.thf")).unwrap(),
        MODEL_THF
    );

    server.tool(6, "open_document", json!({ "path": "a.thf" }));
    server.tool(7, "batch_transaction", commit);
    assert_eq!(
        server.tool_json(8, "get_model", json!({}))["elements"][0]["id"],
        "service"
    );
}

#[test]
fn sequence_batches_preview_validate_commit_undo_and_refuse_opaque_promotion() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("model.thf");
    let initial = include_str!("../../tests/fixtures/thf/v1.1-sequence.thf")
        .split("  - id: checkout-sequence")
        .next()
        .unwrap()
        .replace("\"1.1\"", "\"1.0\"");
    std::fs::write(&path, &initial).unwrap();
    let mut server = McpServer::spawn(&path);
    server.start_workspace();
    let arguments = json!({
        "diagram_id": "new-sequence", "name": "Checkout sequence",
        "participants": [{"id":"client","element_id":"customer"}, {"id":"service","element_id":"checkout"}],
        "messages": [{"id":"request","from":"client","to":"service","label":"Order <submitted>","flow_id":"submit"}]
    });
    let create = json!({"tool":"create_sequence_view","arguments":arguments});
    let preview = server.tool_json(
        2,
        "batch_transaction",
        json!({"dry_run":true,"operations":[create]}),
    );
    assert_eq!(std::fs::read_to_string(&path).unwrap(), initial);
    let commit = json!({"expected_revision":preview["revision"],"operations":[create]});
    let saved = server.tool_json(3, "batch_transaction", commit.clone());
    assert_ne!(saved["revision"], preview["revision"]);
    let read = server.tool_json(
        4,
        "get_sequence_view",
        json!({"diagram_id":"new-sequence","offset":1,"limit":1}),
    );
    assert_eq!(read["participants"][0]["id"], "service");
    assert_eq!(read["message_count"], 1);
    assert_eq!(read["messages"], json!([]));
    let stale = server.request_raw(
        5,
        "tools/call",
        json!({"name":"batch_transaction","arguments":commit}),
    );
    assert!(stale.to_string().contains("changed on disk"), "{stale}");
    let graph_delete = server.request_raw(
        6,
        "tools/call",
        json!({"name":"delete_data_flow","arguments":{"id":"submit"}}),
    );
    assert!(
        graph_delete.to_string().contains("new-sequence"),
        "{graph_delete}"
    );

    let svg = server.tool(7, "export_svg", json!({"diagram_id":"new-sequence"}));
    assert!(svg["content"][0]["text"]
        .as_str()
        .unwrap()
        .contains("Order &lt;submitted&gt;"));
    let mut update = arguments;
    update["name"] = json!("Purchase sequence");
    server.tool(
        8,
        "batch_transaction",
        json!({"operations":[{"tool":"update_sequence_view","arguments":update}]}),
    );
    assert_eq!(
        server.tool_json(9, "get_sequence_view", json!({"diagram_id":"new-sequence"}))["name"],
        "Purchase sequence"
    );
    server.tool(10, "batch_transaction", json!({"operations":[{"tool":"delete_sequence_view","arguments":{"diagram_id":"new-sequence"}}]}));
    assert_eq!(
        server.tool_json(11, "get_model", json!({}))["version"],
        "1.1"
    );
    for id in 12..=14 {
        server.tool(id, "undo", json!({}));
    }
    assert_eq!(std::fs::read_to_string(&path).unwrap(), initial);

    let opaque = include_str!("../../tests/fixtures/thf/v1.0-opaque-sequence.thf");
    std::fs::write(&path, opaque).unwrap();
    let blocked = server.request_raw(
        15,
        "tools/call",
        json!({
            "name":"batch_transaction","arguments":{"dry_run":true,"operations":[create]}
        }),
    );
    assert!(
        blocked.to_string().contains("diagrams[].sequence"),
        "{blocked}"
    );
    assert_eq!(std::fs::read_to_string(&path).unwrap(), opaque);
}

#[test]
fn workspace_layout_mutations_refuse_unavailable_legacy_geometry() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("work.thf");
    let original = MODEL_THF
        .replace(
            "elements: []",
            "elements:\n- id: api\n  type: process\n  name: API",
        )
        .replace(
            "  name: Level 0 DFD",
            "  name: Level 0 DFD\n  layout_file: layout.json",
        );
    std::fs::write(&path, &original).unwrap();
    let layout = r#"{"diagram_id":"main-dfd","viewport":{"x":0,"y":0,"zoom":1},"nodes":[{"id":"api","x":120,"y":240}]}"#;
    let sidecar = dir.path().join("layout.json");
    std::fs::write(&sidecar, format!("{layout}{}", " ".repeat(4 * 1024 * 1024))).unwrap();
    let mut server = McpServer::spawn_workspace(dir.path());
    server.start_workspace();
    server.tool(2, "open_document", json!({ "path": "work.thf" }));
    let move_args = json!({ "id": "api", "dx": 10, "dy": -20 });
    let moved = server.request_raw(
        3,
        "tools/call",
        json!({
            "name": "move_node", "arguments": move_args
        }),
    );
    assert!(
        moved
            .to_string()
            .contains("legacy layout could not be loaded safely"),
        "{moved}"
    );
    let batch = server.request_raw(
        4,
        "tools/call",
        json!({
            "name": "batch_transaction", "arguments": {"operations":[
                {"tool":"move_node","arguments": move_args}
            ]}
        }),
    );
    assert!(
        batch
            .to_string()
            .contains("legacy layout could not be loaded safely"),
        "{batch}"
    );
    assert_eq!(std::fs::read_to_string(&path).unwrap(), original);
    std::fs::write(&sidecar, layout).unwrap();
    server.tool(5, "move_node", move_args);
    let model = server.tool_json(6, "get_model", json!({}));
    assert_eq!(
        model["elements"][0]["position"],
        json!({ "x": 130.0, "y": 220.0 })
    );
}

#[cfg(unix)]
#[test]
fn workspace_rejects_a_replaced_root() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("workspace");
    let original = dir.path().join("original");
    std::fs::create_dir(&root).unwrap();
    std::fs::write(root.join("work.thf"), MODEL_THF).unwrap();
    let mut server = McpServer::spawn_workspace(&root);
    server.start_workspace();
    server.tool(2, "open_document", json!({ "path": "work.thf" }));

    std::fs::rename(&root, &original).unwrap();
    std::fs::create_dir(&root).unwrap();
    std::fs::write(root.join("work.thf"), MODEL_THF).unwrap();
    let response = server.request_raw(
        3,
        "tools/call",
        json!({
            "name": "create_document", "arguments": { "path": "new.thf", "title": "New" }
        }),
    );
    assert!(
        response.to_string().contains("workspace root has moved"),
        "{response}"
    );
    assert!(!original.join("new.thf").exists());
    assert!(!root.join("new.thf").exists());
}

#[test]
fn workspace_relative_move_does_not_require_a_renderable_model() {
    let dir = tempfile::tempdir().unwrap();
    let mut elements = String::from("elements:\n");
    for index in 0..1001 {
        elements.push_str(&format!(
            "- id: node-{index}\n  type: process\n  name: Node {index}\n"
        ));
    }
    std::fs::write(
        dir.path().join("work.thf"),
        MODEL_THF.replace("elements: []\n", &elements),
    )
    .unwrap();
    let mut server = McpServer::spawn_workspace(dir.path());
    server.start_workspace();
    server.tool(2, "open_document", json!({ "path": "work.thf" }));
    server.tool(
        3,
        "move_node",
        json!({ "id": "node-0", "dx": 10, "dy": -20 }),
    );
    let saved: serde_yaml::Value =
        serde_yaml::from_str(&std::fs::read_to_string(dir.path().join("work.thf")).unwrap())
            .unwrap();
    assert_eq!(saved["elements"][0]["position"]["x"].as_f64(), Some(58.0));
    assert_eq!(saved["elements"][0]["position"]["y"].as_f64(), Some(28.0));
}

#[test]
fn workspace_move_preview_rejects_changed_sidecar_positions() {
    let dir = tempfile::tempdir().unwrap();
    let model = MODEL_THF
        .replace(
            "elements: []",
            "elements:\n- id: api\n  type: process\n  name: API",
        )
        .replace(
            "  name: Level 0 DFD",
            "  name: Level 0 DFD\n  layout_file: layout.json",
        );
    let path = dir.path().join("work.thf");
    std::fs::write(&path, &model).unwrap();
    let write_sidecar = |x| {
        std::fs::write(
            dir.path().join("layout.json"),
            json!({
                "diagram_id": "main-dfd", "viewport": {"x": 0, "y": 0, "zoom": 1},
                "nodes": [{"id": "api", "x": x, "y": 240}]
            })
            .to_string(),
        )
        .unwrap();
    };
    write_sidecar(120);
    let mut server = McpServer::spawn_workspace(dir.path());
    server.start_workspace();
    server.tool(2, "open_document", json!({ "path": "work.thf" }));
    let operations = json!([
        { "tool": "move_node", "arguments": { "id": "api", "dx": 10, "dy": -20 } }
    ]);
    let preview = server.tool_json(
        3,
        "batch_transaction",
        json!({ "dry_run": true, "operations": operations }),
    );
    write_sidecar(300);
    let response = server.request_raw(
        4,
        "tools/call",
        json!({
            "name": "batch_transaction", "arguments": {
                "operations": operations, "expected_revision": preview["revision"]
            }
        }),
    );
    assert!(
        response.to_string().contains("changed on disk"),
        "{response}"
    );
    assert_eq!(std::fs::read_to_string(&path).unwrap(), model);
    let updated = server.tool_json(
        5,
        "batch_transaction",
        json!({ "dry_run": true, "operations": operations }),
    );
    server.tool(
        6,
        "batch_transaction",
        json!({ "operations": operations, "expected_revision": updated["revision"] }),
    );
    assert_eq!(
        server.tool_json(7, "get_model", json!({}))["elements"][0]["position"],
        json!({"x": 310.0, "y": 220.0})
    );
}

#[test]
fn stride_apply_rejects_an_edited_document_after_preview() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("work.thf");
    std::fs::write(&path, MODEL_THF).unwrap();
    let mut server = McpServer::spawn(&path);
    server.start_workspace();
    server.tool(
        2,
        "add_element",
        json!({"element_type": "process", "name": "API"}),
    );
    let preview = server.tool_json(3, "analyze_stride", json!({}));
    assert!(!preview["threats"].as_array().unwrap().is_empty());
    let edited = std::fs::read_to_string(&path)
        .unwrap()
        .replace("MCP Fixture", "External edit");
    std::fs::write(&path, &edited).unwrap();
    let response = server.request_raw(4, "tools/call", json!({
        "name":"analyze_stride", "arguments":{
            "apply":true, "expected_revision":preview["revision"], "preview_id":preview["preview_id"]
        }
    }));
    assert!(
        response.to_string().contains("changed on disk"),
        "{response}"
    );
    assert_eq!(std::fs::read_to_string(&path).unwrap(), edited);
}

#[test]
fn delete_results_report_cascades_in_preview_and_commit() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("model.thf");
    let original = include_str!("../../tests/fixtures/thf/architecture-canonical-full.thf");
    std::fs::write(&path, original).unwrap();
    let mut server = McpServer::spawn(&path);
    server.start_workspace();
    let preview = server.tool_json(
        2,
        "batch_transaction",
        json!({
            "dry_run": true, "operations": [
                {"tool": "delete_element", "arguments": {"id": "orders-db"}}
            ]
        }),
    );
    let expected = json!({
        "data_flows": ["flow-2"], "relationships": ["rel-1", "rel-2"], "threats": ["threat-1"]
    });
    assert_eq!(preview["results"][0]["removed"], expected);
    assert_eq!(std::fs::read_to_string(&path).unwrap(), original);
    let committed = server.tool_json(
        3,
        "batch_transaction",
        json!({
            "expected_revision": preview["revision"], "operations": [
                {"tool": "delete_element", "arguments": {"id": "orders-db"}}
            ]
        }),
    );
    assert_eq!(committed["results"], preview["results"]);
    server.tool(4, "undo", json!({}));
    let deleted_flow = server.tool_json(5, "delete_data_flow", json!({"id": "flow-2"}));
    assert_eq!(
        deleted_flow["removed"],
        json!({
            "data_flows": ["flow-2"], "relationships": [], "threats": ["threat-1"]
        })
    );
}

#[test]
fn undo_restores_hand_authored_bytes_and_unknown_fields() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("model.thf");
    let original =
        format!("# Hand-written comment\n{MODEL_THF}\nfuture_section: {{ label: 'keep me' }}\n");
    std::fs::write(&path, &original).unwrap();
    let mut server = McpServer::spawn(&path);
    server.start_workspace();
    server.tool(
        2,
        "add_element",
        json!({"element_type":"process","name":"API"}),
    );
    let edited = std::fs::read_to_string(&path).unwrap();
    assert_ne!(edited, original);
    assert!(edited.contains("future_section:"));
    server.tool(3, "undo", json!({}));
    assert_eq!(std::fs::read_to_string(&path).unwrap(), original);
    server.tool(4, "redo", json!({}));
    assert_eq!(std::fs::read_to_string(&path).unwrap(), edited);
}

#[test]
fn failed_undo_on_untouched_documents_does_not_evict_history() {
    let dir = tempfile::tempdir().unwrap();
    let original = dir.path().join("edited.thf");
    std::fs::write(&original, MODEL_THF).unwrap();
    let mut server = McpServer::spawn_workspace(dir.path());
    server.start_workspace();
    server.tool(2, "open_document", json!({"path": "edited.thf"}));
    server.tool(
        3,
        "add_element",
        json!({"element_type":"process","name":"API"}),
    );
    for i in 0..16 {
        let name = format!("untouched-{i}.thf");
        std::fs::write(dir.path().join(&name), MODEL_THF).unwrap();
        server.tool(4 + 2 * i, "open_document", json!({"path": name}));
        let result = server.request_raw(
            5 + 2 * i,
            "tools/call",
            json!({
                "name":"undo", "arguments":{}
            }),
        );
        assert!(result.to_string().contains("No edit to undo."));
    }
    server.tool(36, "open_document", json!({"path":"edited.thf"}));
    server.tool(37, "undo", json!({}));
    assert_eq!(std::fs::read_to_string(original).unwrap(), MODEL_THF);
}

#[test]
fn search_reports_oversized_documents_and_enforces_a_total_budget() {
    let dir = tempfile::tempdir().unwrap();
    let large = format!("{MODEL_THF}\n#{}", "x".repeat(1024 * 1024));
    std::fs::write(dir.path().join("oversized.thf"), large).unwrap();
    let full_budget_entry = format!(
        "{MODEL_THF}\n#{}",
        "x".repeat(1024 * 1024 - MODEL_THF.len() - 2)
    );
    for index in 0..33 {
        std::fs::write(
            dir.path().join(format!("z-{index:02}.thf")),
            &full_budget_entry,
        )
        .unwrap();
    }
    let mut server = McpServer::spawn_workspace(dir.path());
    server.start_workspace();
    let results = server.tool_json(2, "search_documents", json!({"query":"MCP Fixture"}));
    assert_eq!(results["documents"].as_array().unwrap().len(), 32);
    assert_eq!(results["skipped"], 2);
}
