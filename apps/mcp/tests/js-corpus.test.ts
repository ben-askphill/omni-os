// What Node makes of a list of JSON texts: whether each parses, how it prints back, and what JavaScript's own
// conversions say of the value. crates/omni-core/tests/node_parity.rs holds the Rust `js` module to the same file,
// so a binary that replaces a Node script reads and writes JSON the way the script did.
//
//   npx vitest run tests/js-corpus.test.ts                                  check the record against this Node
//   OMNI_RECORD_NATIVE_FIXTURES=1 npx vitest run tests/js-corpus.test.ts    add a { "text": … } case, then record
import { readFileSync, writeFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { fixture } from '@omni/test-fixtures';

interface Case {
  text: string;
  ok?: boolean;
  [key: string]: unknown;
}

const FILE = fixture('native', 'js-corpus.json');
const RECORD = process.env.OMNI_RECORD_NATIVE_FIXTURES === '1';

function attempt<T>(run: () => T): T | null {
  try {
    return run();
  } catch {
    return null;
  }
}

function record(text: string): Case {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { text, ok: false };
  }
  return {
    text,
    ok: true,
    compact: JSON.stringify(value),
    pretty: JSON.stringify(value, null, 2),
    // null where JavaScript throws: an object whose own `toString` key hides the method cannot be converted.
    string: attempt(() => String(value)),
    number: attempt(() => String(Number(value))),
    truthy: Boolean(value),
    ...(typeof value === 'string' && { trimmed: value.trim(), codePoints: [...value].length, uri: attempt(() => encodeURIComponent(value)) }),
  };
}

const corpus = JSON.parse(readFileSync(FILE, 'utf8')) as { cases: Case[] };

test('Node reads and prints every case as recorded', () => {
  const now = corpus.cases.map((c) => record(c.text));
  if (RECORD) writeFileSync(FILE, `${JSON.stringify({ cases: now }, null, 2)}\n`);
  else expect(now).toEqual(corpus.cases);
});

test('no case is listed twice', () => {
  const texts = corpus.cases.map((c) => c.text);
  expect(new Set(texts).size).toBe(texts.length);
});
