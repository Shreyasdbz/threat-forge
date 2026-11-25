//! ThreatForge MCP Server binary — stdio transport.
//!
//! Usage:
//!   threatforge-mcp <path-to-model.thf>
//!   threatforge-mcp --workspace <directory>
//!
//! External AI tools (Claude Code, VS Code Copilot, Cursor) spawn this
//! process and communicate via MCP over stdin/stdout.

use std::path::PathBuf;

use rmcp::transport::stdio;
use rmcp::ServiceExt;

use threat_forge_lib::mcp::server::ThreatForgeServer;

#[tokio::main]
async fn main() {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    let server = match args.as_slice() {
        [flag, root] if flag == "--workspace" => {
            ThreatForgeServer::in_workspace(PathBuf::from(root))
        }
        [file] if PathBuf::from(file).extension().and_then(|ext| ext.to_str()) == Some("thf") => {
            ThreatForgeServer::new(PathBuf::from(file))
        }
        _ => {
            eprintln!("Usage: threatforge-mcp <model.thf> | --workspace <directory>");
            std::process::exit(1);
        }
    };
    let server = match server {
        Ok(s) => s,
        Err(e) => {
            eprintln!("Failed to initialize MCP server: {e}");
            std::process::exit(1);
        }
    };

    let service = match server.serve(stdio()).await {
        Ok(s) => s,
        Err(e) => {
            eprintln!("Failed to start MCP server: {e}");
            std::process::exit(1);
        }
    };

    if let Err(e) = service.waiting().await {
        eprintln!("MCP server error: {e}");
        std::process::exit(1);
    }
}
