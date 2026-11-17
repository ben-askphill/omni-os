// The record the Rust port of ask, render and threads is held to (docs/internals/rust-port.md).
//
// Each scenario in packages/test-fixtures/native/mcp is a conversation with one of the servers: the lines a harness
// writes to its stdin, what Omni's API answers, and what the server wrote back and asked the API. This test runs them
// against the TypeScript servers; crates/omni-mcp/tests/goldens.rs runs the same files against the Rust binary. A
// change to what a server says or sends fails here first.
//
// To record after a change made on purpose:
//   OMNI_RECORD_NATIVE_FIXTURES=1 npx vitest run --config apps/mcp/vitest.config.ts
// To run the same scenarios against a built Rust binary through this runner:
//   OMNI_NATIVE_MCP=target/debug/omni-mcp npx vitest run --config apps/mcp/vitest.config.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fixture } from '@omni/test-fixtures';
import { afterAll, describe, expect, it } from 'vitest';
import { type Scenario, runScenario } from './scenarios.ts';

const RECORD = process.env.OMNI_RECORD_NATIVE_FIXTURES === '1';
const NATIVE = process.env.OMNI_NATIVE_MCP;
const HINT =
  'What a per-thread MCP server says or sends changed. If that is on purpose, record the scenarios again with ' +
  'OMNI_RECORD_NATIVE_FIXTURES=1 npx vitest run --config apps/mcp/vitest.config.ts and bring crates/omni-mcp in line (npm run test:rust).';

const ROOT = resolve(import.meta.dirname, '../../..');
const SERVERS = ['ask', 'render', 'threads'];

function command(server: string): { bin: string; args: string[] } {
  if (NATIVE) return { bin: resolve(ROOT, NATIVE), args: [server] };
  return { bin: join(ROOT, 'node_modules/.bin/tsx'), args: [join(ROOT, 'apps/mcp', `${server}.ts`)] };
}

for (const server of SERVERS) {
  const file = fixture('native', 'mcp', `${server}.json`);
  const recorded = JSON.parse(readFileSync(file, 'utf8')) as { scenarios: Scenario[] };

  describe(`${server}: ${NATIVE ? 'the Rust binary' : 'the TypeScript server'} against the record`, () => {
    it('names every scenario once', () => {
      const names = recorded.scenarios.map((s) => s.name);
      expect(new Set(names).size).toBe(names.length);
      expect(recorded.scenarios.every((s) => s.server === server)).toBe(true);
    });

    for (const scenario of recorded.scenarios) {
      it(scenario.name, async () => {
        const got = await runScenario(scenario, command(scenario.server));
        if (RECORD && !NATIVE) {
          scenario.expected = got;
          return;
        }
        expect(scenario.expected, `${scenario.name} has no record yet. ${HINT}`).toBeDefined();
        expect(got, HINT).toEqual(scenario.expected);
      });
    }

    afterAll(() => {
      if (RECORD && !NATIVE) writeFileSync(file, `${JSON.stringify(recorded, null, 2)}\n`);
    });
  });
}
