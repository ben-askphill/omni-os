//! The stdio MCP servers every local thread gets (`apps/server/sandbox.ts`), as one binary: `omni-mcp ask`,
//! `omni-mcp render` and `omni-mcp threads`. Each is a port of the Node script of that name in `apps/mcp`, held to
//! the same recorded scenarios (`packages/test-fixtures/native/mcp`, docs/internals/rust-port.md). `omni-mcp lazy`
//! is no server of its own: it starts another one when a thread first needs it (`lazy.rs`).

mod ask;
mod lazy;
mod protocol;
mod render;
mod server;
mod threads;
mod zod;

use server::Kind;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let kind = match args.first().map(String::as_str) {
        // No runtime: it reads lines and copies bytes on two threads.
        Some("lazy") => lazy::run(&args[1..]),
        Some("ask") => Kind::Ask,
        Some("render") => Kind::Render,
        Some("threads") => Kind::Threads,
        Some("--version") => {
            println!("omni-mcp {}", env!("CARGO_PKG_VERSION"));
            return;
        }
        _ => {
            eprintln!("usage: omni-mcp <ask|render|threads|lazy <answers.json> <command> [args...]>");
            std::process::exit(2);
        }
    };
    let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build().expect("a runtime on this thread");
    // One thread is plenty: a server waits on stdin and on at most a few HTTP requests.
    tokio::task::LocalSet::new().block_on(&runtime, server::serve(kind));
}
