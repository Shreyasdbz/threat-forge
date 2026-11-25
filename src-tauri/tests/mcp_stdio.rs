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
    let applied = server.tool_json(11, "analyze_stride", json!({ "apply": true }));
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
