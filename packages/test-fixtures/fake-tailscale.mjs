#!/usr/bin/env node
// A stand-in for the tailscale CLI, for tests and QA runs: point OMNI_TAILSCALE_BIN at it. `status --json` prints the
// file FAKE_TAILSCALE_STATUS names, as the real CLI prints its status. With no such file it fails the way the real one
// does when tailscaled is not running.
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
if (args[0] !== 'status' || !args.includes('--json')) {
  console.error(`fake-tailscale: only "status --json" is supported, not: ${args.join(' ')}`);
  process.exit(2);
}
try {
  process.stdout.write(readFileSync(process.env.FAKE_TAILSCALE_STATUS ?? '', 'utf8'));
} catch {
  console.error("failed to connect to local tailscaled; it doesn't appear to be running");
  process.exit(1);
}
