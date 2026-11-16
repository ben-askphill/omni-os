// A fake Io for the commands: a server that answers from the recorded wire fixtures (packages/test-fixtures/wire,
// pinned to the real server by apps/server/tests/wire-fixtures.test.ts), and a machine that is only what a test says.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FetchResponse } from '@omni/client-core';
import { WIRE_FIXTURES } from '@omni/test-fixtures';
import type { FileStat, Io, RunResult } from '../src/io.ts';
import { run } from '../src/main.ts';
import { proofFor } from '../src/proof.ts';

/** A recorded answer, parsed fresh each time so a test can change its copy. Typed loosely: each test reads the fields it needs. */
export const wire = (name: string): any => JSON.parse(readFileSync(join(WIRE_FIXTURES, name), 'utf8'));

export const BASE = 'http://127.0.0.1:4747';
export const TOKEN = 'test-token';

export interface Sent {
  method: string;
  /** The path under the server, with its query: /api/threads?limit=20. */
  path: string;
  body?: unknown;
  auth: string | undefined;
}

export type Reply = { status?: number; json?: unknown } | { refused: true } | { hang: true };

export interface Route {
  method: string;
  /** An exact path (query included), or a pattern. */
  path: string | RegExp;
  /** One answer, or one per call in turn (the last one repeats). */
  reply: Reply | Reply[];
}

export interface FakeOptions {
  env?: Record<string, string | undefined>;
  routes?: Route[];
  cwd?: string;
  stdin?: string | null;
  platform?: NodeJS.Platform;
  files?: Record<string, string>;
  stats?: Record<string, Partial<FileStat>>;
  run?: (bin: string, args: string[]) => Partial<RunResult>;
  disk?: Record<string, { free: number; total: number }>;
  launch?: (bin: string, args: string[]) => boolean;
  now?: number;
  /**
   * What answers GET /api/auth/proof when no route does: this install's Omni signing with TOKEN on 4747 (the default),
   * an impostor whose proof does not match, or nothing.
   */
  proof?: 'mine' | 'wrong' | 'refused';
}

const GB = 1024 ** 3;

export function fake(o: FakeOptions = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const sent: Sent[] = [];
  /** GET /api/auth/proof calls, which carry no token: kept apart from `sent`. */
  const probes: Sent[] = [];
  let proofMode = o.proof ?? 'mine';
  const launched: [string, string[]][] = [];
  const ran: [string, string[]][] = [];
  const slept: number[] = [];
  const calls = new Map<Route, number>();
  const routes = [...(o.routes ?? [])];
  let uuids = 0;

  const fetch: Io['fetch'] = async (url, init) => {
    const path = url.startsWith(BASE) ? url.slice(BASE.length) : url;
    const isProbe = path.startsWith('/api/auth/proof?');
    (isProbe ? probes : sent).push({ method: init.method, path, ...(init.body !== undefined && { body: JSON.parse(init.body) }), auth: init.headers.authorization });
    const route = routes.find((r) => r.method === init.method && (typeof r.path === 'string' ? r.path === path : r.path.test(path)));
    let reply: Reply;
    if (route) {
      const n = calls.get(route) ?? 0;
      calls.set(route, n + 1);
      reply = Array.isArray(route.reply) ? route.reply[Math.min(n, route.reply.length - 1)] : route.reply;
    } else if (isProbe) {
      const nonce = new URL(path, BASE).searchParams.get('nonce') ?? '';
      const proof = proofMode;
      reply = proof === 'refused' ? { refused: true } : { json: { proof: proof === 'wrong' ? 'deadbeef' : proofFor(TOKEN, 4747, nonce) } };
    } else {
      throw new Error(`no route for ${init.method} ${path}`);
    }
    if ('refused' in reply) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    if ('hang' in reply) throw Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    const text = JSON.stringify(reply.json ?? {});
    const res: FetchResponse = { status: reply.status ?? 200, headers: { get: (h) => (h === 'content-type' ? 'application/json' : null) }, text: async () => text };
    return res;
  };

  const stats = o.stats ?? {};
  const files = o.files ?? {};
  const io: Io = {
    env: { OMNI_TOKEN: TOKEN, ...o.env },
    cwd: o.cwd ?? '/home/me',
    platform: o.platform ?? 'linux',
    out: (t) => void out.push(t),
    err: (t) => void err.push(t),
    stdin: async () => o.stdin ?? null,
    fetch,
    sleep: async (ms) => void slept.push(ms),
    now: () => o.now ?? Date.parse('2026-01-05T09:05:00.000Z'),
    uuid: () => `00000000-0000-4000-9000-${String(++uuids).padStart(12, '0')}`,
    async run(bin, args) {
      ran.push([bin, args]);
      const r = o.run?.(bin, args) ?? { missing: true };
      return { code: 0, stdout: '', stderr: '', missing: false, ...r };
    },
    async launch(bin, args) {
      launched.push([bin, args]);
      return o.launch ? o.launch(bin, args) : true;
    },
    readFile: (p) => files[p] ?? null,
    stat: (p) => (stats[p] ? { mode: 0o100600, size: 0, mtimeMs: Date.parse('2026-01-05T09:00:00.000Z'), dir: false, ...stats[p] } : p in files ? { mode: 0o100600, size: files[p].length, mtimeMs: Date.parse('2026-01-05T09:00:00.000Z'), dir: false } : null),
    disk: (p) => o.disk?.[p] ?? { free: 500 * GB, total: 1000 * GB },
    tail: (p, bytes) => (p in files ? files[p].slice(-bytes) : null),
  };

  return {
    io,
    sent,
    probes,
    launched,
    ran,
    slept,
    route: (r: Route) => routes.unshift(r),
    /** Changes what holds the port from here on: another program can take it while Omni restarts. */
    setProof: (mode: NonNullable<FakeOptions['proof']>) => void (proofMode = mode),
    out: () => out.join(''),
    err: () => err.join(''),
    /** Runs `omni <argv>` and answers its exit code. */
    run: (...argv: string[]) => run(argv, io),
  };
}

/** A thread detail (GET /threads/:id) as recorded, with its thread changed. */
export function detail(name: string, thread: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  const d = wire(name);
  return { ...d, thread: { ...d.thread, ...thread }, ...extra };
}

/** GET /needs-you?thread=<id>: the recorded item of the thread with that id's suffix, moved to `id`, or none. */
export function needsYouFor(id: string, recordedSuffix: string | null) {
  const all = wire('needs-you.json');
  const item = recordedSuffix ? all.items.find((i: { thread: { id: string } }) => i.thread.id.endsWith(recordedSuffix)) : null;
  if (!item) return { items: [], unread: 0, blocked: 0 };
  return { items: [{ ...item, thread: { ...item.thread, id } }], unread: 1, blocked: item.blockers.length ? 1 : 0 };
}
