import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect } from 'vitest';

// The shape of the JSON the Mac app reads (apps/mac/OmniKit decodes the fixtures): the keys and value types, compared
// between a recorded fixture and what the server sends now. apps/server/tests/mac-fixtures.test.ts records most of
// them from one server; a test that makes a response one server cannot (two Macs) checks its own with macFixture.

export type Kind = 'null' | 'boolean' | 'number' | 'string' | 'array' | 'object';

/** The keys and value types seen across values, merged. Array items are kept apart by their kind or type. */
export interface Shape {
  kinds: Set<Kind>;
  objects: number;
  fields: Map<string, { shape: Shape; seen: number }>;
  items: Map<string, Shape>;
}

const blank = (): Shape => ({ kinds: new Set(), objects: 0, fields: new Map(), items: new Map() });

/** What tells array items apart: an event's kind, a stream message's kind or type, an SSE frame's event. */
export function tagOf(v: unknown): string {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return '';
  const o = v as Record<string, unknown>;
  if (typeof o.kind === 'string') return o.kind;
  if (typeof o.type === 'string') return o.type;
  if (typeof o.event === 'string') return `event:${o.event}`;
  return 'data' in o ? tagOf(o.data) : '';
}

function add(s: Shape, v: unknown) {
  if (v === null) s.kinds.add('null');
  else if (Array.isArray(v)) {
    s.kinds.add('array');
    for (const x of v) {
      const tag = tagOf(x);
      if (!s.items.has(tag)) s.items.set(tag, blank());
      add(s.items.get(tag)!, x);
    }
  } else if (typeof v === 'object') {
    s.kinds.add('object');
    s.objects++;
    const o = v as Record<string, unknown>;
    for (const [k, x] of Object.entries(o)) {
      const f = s.fields.get(k) ?? { shape: blank(), seen: 0 };
      f.seen++;
      // An event row's payload is JSON inside the JSON.
      add(f.shape, k === 'payload' && typeof x === 'string' && typeof o.kind === 'string' ? JSON.parse(x) : x);
      s.fields.set(k, f);
    }
  } else s.kinds.add(typeof v as Kind);
}

export function shapeOf(values: unknown[]): Shape {
  const s = blank();
  for (const v of values) add(s, v);
  return s;
}

/**
 * The differences between a recorded and a fresh shape. Null counts as any type, so a field that is sometimes
 * null only fails when its other type changes. A key found on only one side fails unless that side has it on
 * some items only, since optional keys come and go with the data.
 */
export function diff(want: Shape, have: Shape, path: string, out: string[]) {
  const strip = (k: Set<Kind>) => [...k].filter((x) => x !== 'null' || k.size === 1).sort().join('|');
  if (strip(want.kinds) !== strip(have.kinds)) {
    out.push(`${path}: recorded ${[...want.kinds].sort().join('|')}, now ${[...have.kinds].sort().join('|')}`);
    return;
  }
  for (const k of new Set([...want.fields.keys(), ...have.fields.keys()])) {
    const a = want.fields.get(k);
    const b = have.fields.get(k);
    if (a && b) diff(a.shape, b.shape, `${path}.${k}`, out);
    else if (a && a.seen === want.objects) out.push(`${path}.${k}: no longer sent`);
    else if (b && b.seen === have.objects) out.push(`${path}.${k}: new`);
  }
  // An empty array says nothing about its items.
  if (!want.items.size || !have.items.size) return;
  for (const tag of new Set([...want.items.keys(), ...have.items.keys()])) {
    const a = want.items.get(tag);
    const b = have.items.get(tag);
    const p = `${path}[${tag || '*'}]`;
    if (a && b) diff(a, b, p, out);
    else out.push(`${p}: ${a ? 'no longer sent' : 'new'}`);
  }
}

export const MAC_FIXTURES = resolve(import.meta.dirname, '../../mac/OmniKit/Tests/OmniKitTests/Fixtures');

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const TIME = /\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z/g;

/** The value as a fixture: paths that change from run to run, ids, times and commit ids swapped for fixed stand-ins. */
function normalized(value: unknown, places: string[]): string {
  let t = `${JSON.stringify(value, null, 2)}\n`;
  for (const p of [...places].sort((a, b) => b.length - a.length)) t = t.split(p).join('/tmp/omni-fixtures');
  const ids = new Map<string, string>();
  const shas = new Map<string, string>();
  return t
    .replace(UUID, (u) => {
      if (!ids.has(u)) ids.set(u, `00000000-0000-4000-8000-${String(ids.size + 1).padStart(12, '0')}`);
      return ids.get(u)!;
    })
    .replace(TIME, (s) => (s.includes('.') ? '2026-01-05T09:00:00.000Z' : '2026-01-05T09:00:00Z'))
    .replace(/\b[0-9a-f]{40}\b/g, (sha) => {
      if (!shas.has(sha)) shas.set(sha, String(shas.size + 1).padStart(40, 'c'));
      return shas.get(sha)!;
    })
    .replace(/omni\/[0-9a-f]{8}\b/g, 'omni/00000000');
}

/** Check a response against its recorded fixture, or record it with OMNI_RECORD_MAC_FIXTURES=1. */
export function macFixture(name: string, value: unknown, places: string[] = []) {
  const file = join(MAC_FIXTURES, name);
  if (process.env.OMNI_RECORD_MAC_FIXTURES === '1') return writeFileSync(file, normalized(value, places));
  expect(existsSync(file), `${file} is missing. Record it with OMNI_RECORD_MAC_FIXTURES=1`).toBe(true);
  const out: string[] = [];
  diff(shapeOf([JSON.parse(readFileSync(file, 'utf8'))]), shapeOf([value]), name, out);
  expect(out, `The server JSON the Mac app reads changed shape. If that is on purpose, record ${name} again with OMNI_RECORD_MAC_FIXTURES=1, then run npm run test:mac`).toEqual([]);
}
