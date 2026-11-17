import { chmodSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCheckoutMcp, type CheckoutBuild } from '../scripts/native.ts';

// A thread's ask, render and threads servers are omni-mcp, the Rust build (native-mcp.ts). The run builds it once,
// before the workers start, and they inherit OMNI_TEST_MCP_BUILD. Only a machine without cargo goes on without it:
// the tests that start the real servers skip (`hasMcpBuild` in support.ts), and OMNI_NATIVE_MCP names a stand-in
// that only answers --version, so the config each harness gets is still checked. A build that fails (the crate, the
// lockfile) fails the run. Runs after global-tmpdir.ts, so the stand-in goes in the run's dir.
export function prepareMcp(built: CheckoutBuild): void {
  if (!built.ok && !built.missing) throw new Error(`omni-mcp did not build: ${built.reason}. Fix the crate, or run without cargo on PATH to skip the tests that need it`);
  process.env.OMNI_TEST_MCP_BUILD = built.ok ? '1' : '0';
  if (built.ok) return;
  console.warn(`[tests] no omni-mcp build (${built.reason}): the tests that start a thread's MCP servers skip`);
  const stub = join(tmpdir(), 'omni-mcp-stub');
  writeFileSync(stub, '#!/bin/sh\n[ "$1" = --version ] && echo "omni-mcp 0.0.0-stub" && exit 0\necho "omni-mcp stand-in: build crates/omni-mcp" >&2\nexit 1\n');
  chmodSync(stub, 0o755);
  process.env.OMNI_NATIVE_MCP = stub;
}

export default function setup(): void {
  prepareMcp(buildCheckoutMcp());
}
