// What the omni command's own formatting makes of a list of inputs: times in several time zones, numbers, sizes,
// tables, thread arguments and server addresses. The scenarios in packages/test-fixtures/native/cli run the whole
// command; this holds the parts whose answer depends on the clock, the time zone or JavaScript's rounding, which
// a scenario can only touch once. crates/omni-cli/src/corpus.rs holds the Rust command to the same file.
//
//   npx vitest run tests/native-corpus.test.ts                                  check the record against this Node
//   OMNI_RECORD_NATIVE_FIXTURES=1 npx vitest run tests/native-corpus.test.ts    record after adding an input below
import { readFileSync, writeFileSync } from 'node:fs';
import { diskLevel, freeSize } from '@omni/shared/disk-space.ts';
import { relTime } from '@omni/shared/format.ts';
import { elapsedShort } from '@omni/shared/ran-on.ts';
import { fixture } from '@omni/test-fixtures';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { appLaunch } from '../src/commands/open.ts';
import { connection } from '../src/connection.ts';
import { clip, fields, table } from '../src/format.ts';
import { CliError } from '../src/io.ts';
import { proofFor } from '../src/proof.ts';
import { idFromLink, looksLikeThread } from '../src/resolve.ts';

const FILE = fixture('native', 'cli-corpus.json');
const RECORD = process.env.OMNI_RECORD_NATIVE_FIXTURES === '1';

const S = 1000;
const M = 60 * S;
const H = 60 * M;
const D = 24 * H;
const GB = 1024 ** 3;
const MB = 1024 ** 2;

/**
 * Zones with a whole-hour, a half-hour and a 14-hour offset, a clock change of 30 minutes (Lord Howe) and one at
 * midnight (Havana), where the day has no 00:00.
 */
const ZONES = ['UTC', 'Europe/Amsterdam', 'America/Los_Angeles', 'Pacific/Kiritimati', 'Asia/Kolkata', 'America/St_Johns', 'Australia/Lord_Howe', 'America/Havana'];

/** Where a text with no offset is read: the zones whose clock changes the texts below land on. */
const DATE_ZONES = ['UTC', 'Europe/Amsterdam', 'America/Los_Angeles', 'Australia/Lord_Howe', 'America/Havana'];

/** An ordinary afternoon, the days the clocks change in Europe, North America and on Lord Howe, and the new year. */
const NOWS = ['2026-11-16T14:00:00.000Z', '2026-03-29T12:00:00.000Z', '2026-10-25T00:30:00.000Z', '2026-03-08T10:30:00.000Z', '2026-04-05T15:00:00.000Z', '2026-01-01T00:10:00.000Z'];

/** How long before `now`: each side of every boundary relTime has, then far enough back to name every month. */
const AGO = [
  -M, 0, 44 * S, 45 * S, 89 * S, 90 * S, 30 * M, 59 * M + 29 * S, 59 * M + 59 * S, H, H + 29 * M, H + 30 * M, 2 * H + 30 * M, 5 * H, 9 * H, 13 * H, 18 * H, 23 * H,
  25 * H, 30 * H, 47 * H, 49 * H, 3 * D, 5 * D, 5 * D + 23 * H, 6 * D, 6 * D + 12 * H, 7 * D, 8 * D, 20 * D,
  40 * D, 70 * D, 100 * D, 130 * D, 160 * D, 190 * D, 220 * D, 250 * D, 280 * D, 310 * D, 340 * D, 370 * D, 400 * D, 800 * D,
];

/** Texts the server writes (ISO from JavaScript, `datetime('now')` from SQLite), their near misses, and local times a clock change skips or repeats. */
const DATES = [
  '2026-11-16T10:30:00.000Z', '2026-11-16T10:30:00Z', '2026-11-16T10:30Z', '2026-11-16T10:30:00.1Z', '2026-11-16T10:30:00.12Z', '2026-11-16T10:30:00.123456Z',
  '2026-11-16T10:30:00.9999Z', '2026-11-16T11:30:00+01:00', '2026-11-16T11:30+01:00', '2026-11-16T05:00:00-05:30', '2026-11-16T10:30:00+00:00', '2026-11-16T10:30:00-00:00',
  '2026-11-16T10:30:00', '2026-11-16T10:30', '2026-11-16T10:30:00.5', '2026-11-16 10:30:00', '2026-11-16 10:30:00.000', '2026-11-16 10:30', '2026-11-16 10:30:00Z',
  '2026-03-29T02:30:00', '2026-10-25T02:30:00', '2026-03-08T00:30:00', '2026-03-08T02:30:00', '2026-04-05T01:45:00', '2026-11-01T00:30:00', '2026-01-01T00:00:00',
  '2026-11-16', '2026-11', '2026', '2021-02-30', '2021-02-29', '2024-02-29', '2026-11-31', '2026-00-10', '2026-11-00',
  '2026-11-16T24:00:00Z', '2026-11-16T24:00:01Z', '2026-11-16T25:00:00Z', '2026-11-16T10:60:00Z', '2026-11-16T10:30:60Z', '2026-11-16T10:30:00Zx',
  '0000-01-01T00:00:00Z', '9999-12-31T23:59:59.999Z', '+002026-11-16T10:30:00Z', '+010000-01-01T00:00:00Z', '+275760-09-13T00:00:00.001Z',
  '-000001-01-01T00:00:00Z', '-271821-04-19T23:59:59.999Z', '1970-01-01T00:00:00Z', '1969-12-31T23:59:59.999Z',
  'soon', 'null', '2026-13-01', '2026-11-16T', '2026-11-16T10', '20261116', '2026-11-16T10:30:00.Z',
];
// Not here: texts only V8's older date parser reads ("16 Nov 2026", "2026-1-6", a lower-case z) and years past
// 262142, which the Rust command reads as no date (docs/internals/rust-port.md). The server sends none of them.

const FIXED = [
  0, 0.5, 1.5, 2.5, 0.05, 0.15, 0.25, 0.35, 0.045, 1.005, 1.015, 1.025, 1.045, 1.255, 1.45, 2.675, 4.35, 8.345, 10.235, 0.125, 0.375, 99.995, 0.994, 0.995, 0.999, 0.1 + 0.2,
  1e-7, 5e-324, 123456789.125, 1234.5678, 3, 100, 1e20, 1e21, 1.5e21, 9007199254740993, -1.005, -0.5, -0.004, -0.005, -0.006, -2.5, -1e21, 0.95, 0.949, 37.5, 62.45,
];

const ROUNDED = [0, 0.4, 0.5, 0.49999999999999994, 0.6, 1.5, 2.5, 3.5, 2.4999, -0.4, -0.5, -0.6, -1.5, -2.5, -3.5, 1e21, 4503599627370497, 4503599627370496.5, 99.5, 12.345, -7.5000001];

const SIZES = [
  -5 * MB, 0, 1, 0.49 * MB, 0.5 * MB, 512 * MB, 849.5 * MB, GB - 1, GB, 1.04 * GB, 1.05 * GB, 1.15 * GB, 1.25 * GB, 1.95 * GB, 9.94 * GB, 9.95 * GB, 9.99 * GB,
  10 * GB - 1, 10 * GB, 10.49 * GB, 10.5 * GB, 11.5 * GB, 12.5 * GB, 26 * GB, 494.38 * GB, 2048 * GB,
];

const DISKS: [number, number][] = [
  [0, 500 * GB], [4.99 * GB, 500 * GB], [5 * GB, 500 * GB], [19.99 * GB, 500 * GB], [20 * GB, 500 * GB], [300 * GB, 500 * GB],
  [1.2 * GB, 26 * GB], [1.3 * GB, 26 * GB], [1.31 * GB, 26 * GB], [3.89 * GB, 26 * GB], [3.9 * GB, 26 * GB], [3.91 * GB, 26 * GB], [0, 0], [1, 0], [10 * GB, 100 * GB], [15 * GB, 100 * GB], [5 * GB, 100 * GB],
];

const ELAPSED = [-5 * S, 0, 1.5, 999, S, 59 * S + 999, M, 59 * M + 59 * S, H, H + M, H + 5 * M, 9 * H + 59 * M + 59 * S, 23 * H + 59 * M, D, D + 3 * H, 10 * D, 400 * D + 23 * H + 59 * M];

const CLIPPED: [string, number][] = [
  ['hello world', 5], ['hello world', 11], ['hello world', 10], ['  a \n\t b  ', 10], ['', 5], ['x', 1], ['xy', 1], ['one\r\ntwo\n\nthree', 9],
  ['a b c﻿d', 20], ['a​b', 20], ['héllo wörld', 6], ['日本語のタイトルです', 5], ['fix 🐛 in parser', 5], ['fix 🐛 in parser', 6], ['fix 🐛 in parser', 7],
  ['👩‍👩‍👧 family', 4], ['été', 3], ['x'.repeat(70), 70], ['x'.repeat(71), 70], [`${'word '.repeat(30)}end`, 60], ['   ', 3], ['a b c', 9],
];

const TABLES: string[][][] = [
  [],
  [['ID', 'STATUS', 'TITLE']],
  [['ID', 'STATUS', 'TITLE'], ['11111111', 'running', 'Fix the parser'], ['22222222', 'done', '']],
  [['ID', 'WHY'], ['a', ''], ['', '']],
  [['A', 'B'], ['🐛🐛', 'x'], ['日本', 'y'], ['é', 'z']],
  [['only']],
  [['a', 'b', 'c'], ['', '', ''], ['long cell', '', 'end  ']],
];

const FIELDS: [string, string | null][][] = [
  [],
  [['id', '11111111'], ['status', 'running'], ['needs you', null], ['url', 'http://127.0.0.1:4747/#/t/1']],
  [['a', ''], ['bb', null]],
  [['🐛', 'bug'], ['plain', 'text']],
  [['run', 'builder · claude'], ['machine', 'Running on MacBook Air']],
];

const ID = 'b10b4545-f440-41dc-a076-29c0fa829259';
const THREADS = [
  'parent', 'Parent', ID, ID.toUpperCase(), `${ID}0`, ID.slice(0, 35), ID.slice(0, 8), ID.slice(0, 4), ID.slice(0, 3), 'b10b-', '-b10b', 'b10g4545', 'inbox', 'omni-os', 'deadbeef', 'DEAD', 'cafe', 'face-off',
  `http://127.0.0.1:4747/#/t/${ID}`, `http://127.0.0.1:4747/#/t/${ID}?pair=abc`, `https://omni.example.com/app/#/t/${ID}/changes`, '#/t/abc', '#/t/a%20b/more', '#/t/%E2%82%AC', '#/t/', '#/t/#/t/x',
  '#/t/?x', '#/t/ abc', '#/t/ abc', '#/c/inbox', 'see #/t/one and #/t/two', '#/t/%zz', '#/t/%E2%82', '#/t/%', '#/t/a%2Fb', '#/T/abc', '', ' ', '.',
];

const ADDRESSES = [
  'http://127.0.0.1:4757', ' http://127.0.0.1:4757/ ', 'http://localhost', 'http://localhost:4747/', 'HTTP://LOCALHOST:4747', 'https://omni.example.com', 'https://omni.example.com/prefix//',
  'https://omni.example.com:8443/a/b/', 'http://[::1]:8080', 'http://[::1]:8080/a/b', 'http://192.168.1.20:4747', 'http://omarchy.tail1234.ts.net:4747', 'http://host:80', 'https://host:443', 'https://host:80',
  'ftp://host', 'host:4747', '127.0.0.1:4747', 'http://', 'http:///path', 'http://user@host', 'http://user:pass@host', 'http://host?x=1', 'http://host/#a', 'http://ho st', 'file:///tmp/x', 'ws://host',
];

const LAUNCHES: [string, NodeJS.Platform, string][] = [
  ['/Applications/Omni.app/Contents/MacOS/Omni', 'darwin', '#/t/abc'],
  ['/Applications/Omni.app/Contents/MacOS/Omni', 'linux', '#/'],
  ['/Users/ben/Applications/Omni Beta.app/Contents/MacOS/Omni', 'darwin', '#/c/inbox'],
  ['/opt/Omni.AppImage', 'darwin', '#/'],
  ['/opt/Omni.AppImage', 'linux', '#/t/abc'],
  ['/a.app/Contents/MacOS/b.app/Contents/MacOS/c', 'darwin', '#/'],
];

const PROOFS: [string, number, string][] = [
  ['test-token', 4747, '0123456789abcdef0123456789abcdef'],
  ['', 1, ''],
  ['tökén with spaces', 65535, 'ffffffffffffffffffffffffffffffff'],
];

/** Runs `run` with the process in `zone`, as a machine set to it would. */
function inZone<T>(zone: string, run: () => T): T {
  const before = process.env.TZ;
  process.env.TZ = zone;
  try {
    // The clock on the wall there, against the process's own local time. (Its zone name can be an older alias.)
    const probe = new Date('2026-07-01T12:00:00Z');
    const there = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(probe);
    const here = `${String(probe.getHours()).padStart(2, '0')}:${String(probe.getMinutes()).padStart(2, '0')}`;
    if (there !== here) throw new Error(`this Node did not move to ${zone} (${here}, not ${there}): the corpus cannot be checked here`);
    return run();
  } finally {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  }
}

/** null where the function throws: a link whose id is not valid percent-encoding. */
function attempt<T>(run: () => T): T | false {
  try {
    return run();
  } catch {
    return false;
  }
}

/** The address OMNI_URL names as the command reads it, or null where it refuses it. */
function address(input: string): unknown[] {
  try {
    const conn = connection({ env: { OMNI_URL: input }, readFile: () => null });
    return [input, conn.baseUrl, conn.port, conn.remote];
  } catch (error) {
    if (error instanceof CliError) return [input, null];
    throw error;
  }
}

function relTimes(): unknown[] {
  const out: unknown[] = [];
  for (const zone of ZONES) {
    inZone(zone, () => {
      for (const now of NOWS) {
        const at = Date.parse(now);
        // shortDate reads the year from the clock, not from `now`.
        vi.useFakeTimers({ now: at, toFake: ['Date'] });
        for (const ago of AGO) {
          const iso = new Date(at - ago).toISOString();
          out.push([zone, now, iso, relTime(iso, at)]);
        }
        vi.useRealTimers();
      }
    });
  }
  return out;
}

function dates(): unknown[] {
  const out: unknown[] = [];
  for (const zone of DATE_ZONES) {
    inZone(zone, () => {
      for (const text of DATES) {
        const t = new Date(text).getTime();
        out.push([zone, text, Number.isFinite(t) ? t : null]);
      }
    });
  }
  return out;
}

const SECTIONS: Record<string, () => unknown[]> = {
  relTime: relTimes,
  date: dates,
  toFixed: () => FIXED.flatMap((x) => [0, 1, 2].map((digits) => [x, digits, x.toFixed(digits)])),
  round: () => ROUNDED.map((x) => [x, String(Math.round(x))]),
  freeSize: () => SIZES.map((bytes) => [bytes, freeSize(bytes)]),
  diskLevel: () => DISKS.map(([free, total]) => [free, total, diskLevel(free, total)]),
  elapsedShort: () => ELAPSED.map((ms) => [ms, elapsedShort(ms)]),
  clip: () => CLIPPED.map(([text, max]) => [text, max, clip(text, max)]),
  table: () => TABLES.map((rows) => [rows, table(rows)]),
  fields: () => FIELDS.map((rows) => [rows, fields(rows)]),
  thread: () => THREADS.map((text) => [text, attempt(() => idFromLink(text)), attempt(() => looksLikeThread(text))]),
  address: () => ADDRESSES.map(address),
  launch: () => LAUNCHES.map(([app, platform, route]) => [app, platform === 'darwin', route, ...appLaunch(app, platform, route)]),
  proof: () => PROOFS.map(([token, port, nonce]) => [token, port, nonce, proofFor(token, port, nonce)]),
};

/** One case a line, so a change to one answer is one line of diff. */
function render(corpus: Record<string, unknown[]>): string {
  const sections = Object.entries(corpus).map(([name, cases]) => `  ${JSON.stringify(name)}: [\n${cases.map((c) => `    ${JSON.stringify(c)}`).join(',\n')}\n  ]`);
  return `{\n${sections.join(',\n')}\n}\n`;
}

const recorded = JSON.parse(readFileSync(FILE, 'utf8')) as Record<string, unknown[]>;
const now: Record<string, unknown[]> = {};

describe('the TypeScript command against the corpus', () => {
  for (const [name, cases] of Object.entries(SECTIONS)) {
    it(`${name} answers as recorded`, () => {
      // Through JSON, as the record went: a number such as -0 has one spelling there.
      now[name] = JSON.parse(JSON.stringify(cases())) as unknown[];
      if (!RECORD) expect(now[name], 'Record again with OMNI_RECORD_NATIVE_FIXTURES=1 if this is on purpose, and bring crates/omni-cli in line (npm run test:rust).').toEqual(recorded[name]);
    });
  }

  it('holds no section the code no longer has', () => {
    if (!RECORD) expect(Object.keys(recorded)).toEqual(Object.keys(SECTIONS));
  });

  afterAll(() => {
    if (RECORD) writeFileSync(FILE, render(now));
  });
});
