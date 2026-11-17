// The record the Rust port of the omni command is held to (docs/internals/rust-port.md).
//
// Each scenario in packages/test-fixtures/native/cli is one run of the command as a process: its arguments,
// environment, files and stdin, what Omni's API answers, and what the command printed, exited with, asked the API
// and started. This test runs them against the TypeScript command; crates/omni-cli/tests/goldens.rs runs the same
// files against the Rust binary. A change to what the command prints or sends fails here first.
//
// To record after a change made on purpose:
//   OMNI_RECORD_NATIVE_FIXTURES=1 npx vitest run --config apps/cli/vitest.config.ts tests/native-fixtures.test.ts
// To run the same scenarios against a built Rust binary through this runner:
//   OMNI_NATIVE_CLI=target/debug/omni npx vitest run --config apps/cli/vitest.config.ts tests/native-fixtures.test.ts
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fixture } from '@omni/test-fixtures';
import { afterAll, describe, expect, it } from 'vitest';
import { type Expected, type Scenario, runScenario } from './scenarios.ts';

const RECORD = process.env.OMNI_RECORD_NATIVE_FIXTURES === '1';
const NATIVE = process.env.OMNI_NATIVE_CLI;
const HINT =
  'What the omni command prints or sends changed. If that is on purpose, record the scenarios again with ' +
  'OMNI_RECORD_NATIVE_FIXTURES=1 npx vitest run --config apps/cli/vitest.config.ts tests/native-fixtures.test.ts and bring crates/omni-cli in line (npm run test:rust).';

const ROOT = resolve(import.meta.dirname, '../../..');
const DIR = fixture('native', 'cli');

/** One Node process per run, with nothing on PATH: the loader is named by its file. */
const command = NATIVE
  ? { bin: resolve(ROOT, NATIVE), args: [] }
  : { bin: process.execPath, args: ['--import', pathToFileURL(join(ROOT, 'node_modules/tsx/dist/loader.mjs')).href, join(ROOT, 'apps/cli/src/main.ts')] };

/**
 * The TypeScript command sends some requests together, so the stand-in can see them in either order. The record
 * holds them in the order the code names them, which is the order the Rust command sends them one by one.
 */
const anyOrder = (e: Expected): Expected => ({ ...e, requests: [...e.requests].sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1)) });

const files = readdirSync(DIR).filter((f) => f.endsWith('.json'));
const seen = new Set<string>();

for (const name of files) {
  const file = join(DIR, name);
  const recorded = JSON.parse(readFileSync(file, 'utf8')) as { scenarios: Scenario[] };

  describe(`${name}: ${NATIVE ? 'the Rust binary' : 'the TypeScript command'} against the record`, () => {
    it('names every scenario once', () => {
      for (const s of recorded.scenarios) {
        expect(seen.has(s.name), `${s.name} is named twice`).toBe(false);
        seen.add(s.name);
      }
    });

    for (const scenario of recorded.scenarios) {
      it.concurrent(scenario.name, { timeout: 60_000 }, async () => {
        const got = await runScenario(scenario, command);
        if (RECORD && !NATIVE) {
          scenario.expected = got;
          return;
        }
        expect(scenario.expected, `${scenario.name} has no record yet. ${HINT}`).toBeDefined();
        if (NATIVE) expect(got, HINT).toEqual(scenario.expected);
        else expect(anyOrder(got), HINT).toEqual(anyOrder(scenario.expected as Expected));
      });
    }

    afterAll(() => {
      if (RECORD && !NATIVE) writeFileSync(file, `${JSON.stringify(recorded, null, 2)}\n`);
    });
  });
}

it('has a record to hold the command to', () => {
  expect(files.length).toBeGreaterThan(0);
});
