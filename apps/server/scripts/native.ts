// Builds omni-mcp, the program a thread's ask, render, steps and threads MCP servers run on (crates/omni-mcp), into this
// checkout's target/debug, where native-mcp.ts looks. npm run dev, npm start, scripts/qa-stack.sh and the server's
// tests run it first. The desktop app ships its own build (apps/desktop/scripts/native.ts).
//
//   tsx scripts/native.ts
//
// Without cargo it says so and exits 0: the server still starts, and its threads go without those three tools.
// A build that fails exits 1.
// It imports nothing from the server, so it never touches a data dir.
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../../..');

/** `missing`: cargo itself does not run, which is the one failure a checkout may go on without. */
export type CheckoutBuild = { ok: true } | { ok: false; missing: boolean; reason: string };

/**
 * Cargo does nothing when the build is current. --target-dir is named so CARGO_TARGET_DIR cannot move the file.
 * `cargo --version` runs first, so a machine without cargo (or a version manager's shim with no Rust set) is told
 * apart from a build that fails. Compiler errors go to stderr.
 */
export function buildCheckoutMcp(root = ROOT): CheckoutBuild {
  const probe = spawnSync('cargo', ['--version'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (probe.error || probe.status !== 0) {
    const detail = probe.error ? (probe.error as NodeJS.ErrnoException).code ?? probe.error.message : (probe.stderr.trim().split('\n')[0] ?? '');
    return { ok: false, missing: true, reason: `cargo does not run (${detail || `exit ${probe.status}`}). Install Rust from https://rustup.rs` };
  }
  const result = spawnSync('cargo', ['build', '--locked', '--quiet', '-p', 'omni-mcp', '--target-dir', join(root, 'target')], {
    cwd: root,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  if (result.error) return { ok: false, missing: false, reason: result.error.message };
  if (result.status !== 0) return { ok: false, missing: false, reason: `cargo build -p omni-mcp exited with ${result.status ?? result.signal}` };
  return { ok: true };
}

// Without cargo the server still starts and its threads go without the three tools. A build that fails stops here,
// so a broken crate or lockfile never starts a server on an old binary.
if (import.meta.main) {
  const built = buildCheckoutMcp();
  if (!built.ok && built.missing) {
    console.warn(`[mcp] ${built.reason}. Threads from this checkout get no ask_user_question, html_render, set_steps or read_referenced_thread until omni-mcp builds.`);
  } else if (!built.ok) {
    console.error(`[mcp] could not build omni-mcp: ${built.reason}`);
    process.exit(1);
  }
}
