// Builds omni-mcp, the program a thread's ask, render and threads MCP servers run on (crates/omni-mcp), into this
// checkout's target/debug, where native-mcp.ts looks. npm run dev, npm start, scripts/qa-stack.sh and the server's
// tests run it first. The desktop app ships its own build (apps/desktop/scripts/native.ts).
//
//   tsx scripts/native.ts
//
// Without cargo it says so and exits 0: the server still starts, and its threads go without those three tools.
// It imports nothing from the server, so it never touches a data dir.
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../../..');

export type CheckoutBuild = { ok: true } | { ok: false; reason: string };

/**
 * Cargo does nothing when the build is current. --target-dir is named so CARGO_TARGET_DIR cannot move the file.
 * Compiler errors go to stderr.
 */
export function buildCheckoutMcp(root = ROOT): CheckoutBuild {
  const result = spawnSync('cargo', ['build', '--locked', '--quiet', '-p', 'omni-mcp', '--target-dir', join(root, 'target')], {
    cwd: root,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  if (result.error) {
    const missing = (result.error as NodeJS.ErrnoException).code === 'ENOENT';
    return { ok: false, reason: missing ? 'cargo is not installed (https://rustup.rs)' : result.error.message };
  }
  if (result.status !== 0) return { ok: false, reason: `cargo build exited with ${result.status ?? result.signal}` };
  return { ok: true };
}

if (import.meta.main) {
  const built = buildCheckoutMcp();
  if (!built.ok) console.warn(`[mcp] could not build omni-mcp: ${built.reason}. Threads from this checkout get no ask_user_question, html_render or read_referenced_thread until it builds.`);
}
