import { chmodSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCheckoutMcp } from '../scripts/native.ts';

// A thread's ask, render and threads servers are omni-mcp, the Rust build (native-mcp.ts). The run builds it once,
// before the workers start, and they inherit OMNI_TEST_MCP_BUILD. Without cargo the tests that start the real
// servers skip (`hasMcpBuild` in support.ts), and OMNI_NATIVE_MCP names a stand-in that only answers --version, so
// the config each harness gets is still checked. Runs after global-tmpdir.ts, so the stand-in goes in the run's dir.
export default function setup(): void {
  const built = buildCheckoutMcp();
  process.env.OMNI_TEST_MCP_BUILD = built.ok ? '1' : '0';
  if (built.ok) return;
  console.warn(`[tests] no omni-mcp build (${built.reason}): the tests that start a thread's MCP servers skip`);
  const stub = join(tmpdir(), 'omni-mcp-stub');
  writeFileSync(stub, '#!/bin/sh\n[ "$1" = --version ] && echo "omni-mcp 0.0.0-stub" && exit 0\necho "omni-mcp stand-in: build crates/omni-mcp" >&2\nexit 1\n');
  chmodSync(stub, 0o755);
  process.env.OMNI_NATIVE_MCP = stub;
}
