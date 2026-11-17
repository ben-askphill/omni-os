//! The stdio MCP servers every local thread gets (`apps/server/sandbox.ts`), as one binary: `omni-mcp ask`,
//! `omni-mcp render` and `omni-mcp threads`. Each is a port of the Node script of that name in `apps/mcp`, held to
//! the same recorded scenarios (`packages/test-fixtures/native/mcp`, docs/internals/rust-port.md).

mod ask;
mod protocol;
mod render;
mod server;
mod threads;
mod zod;

use server::Kind;

fn main() {
    let kind = match std::env::args().nth(1).as_deref() {
        Some("ask") => Kind::Ask,
        Some("render") => Kind::Render,
        Some("threads") => Kind::Threads,
        Some("--version") => {
            println!("omni-mcp {}", env!("CARGO_PKG_VERSION"));
            return;
        }
        _ => {
            eprintln!("usage: omni-mcp <ask|render|threads>");
            std::process::exit(2);
        }
    };
    let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build().expect("a runtime on this thread");
    // One thread is plenty: a server waits on stdin and on at most a few HTTP requests.
    tokio::task::LocalSet::new().block_on(&runtime, server::serve(kind));
}
