// Exports Omni threads as markdown digests for the central brain to ingest.
//
//   npm run brain-export -- [--channel <id>] [--since <YYYY-MM-DD>] [--dry-run] [--out <dir>]
//
//   --out       export root; files land in <out>/omni/<channel-id>/. Default $OMNI_BRAIN_EXPORT_DIR or ~/central-brain/raw.
//   --channel   one channel, by id. Imported history counts as the channel its cwd matches.
//   --since     only threads updated on or after this date.
//   --dry-run   write nothing and leave the cursor alone; print what would be written and its size.
//
// One file per thread: <YYYY-MM-DD>-<thread id, 8 chars>.md. The kv key brain_export.cursor keeps the last exported
// event uid per thread, so a rerun skips what it already wrote and a resumed thread gets only its new events,
// as -part2, -part3. Tool calls and results never leave Omni; secret values, token-shaped strings, IP addresses
// and SSH details become [REDACTED] before anything is written. Secret values are never printed.
// A Conductor thread that delegated gets a stub: Ben's messages and the threads it handed work to.
// Imported history with no channel goes to imported/<project folder>; temp dirs, scratchpads and worktrees are skipped.
//
// Run it on one Mac only. The cursor syncs, so the follow-up automation should gate on the kv key
// automations.owner like the other scheduled automations (docs/adr/0004-supabase-sync.md).

import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { promisify } from 'node:util';
import { config, paths } from '../config.ts';
import { CURSOR_KEY, emptyCursor, envSecretValues, makeRedactor, plan, type Cursor, type SkipReason } from './lib/brain-export.ts';

const run = promisify(execFile);

interface Args {
  out: string;
  channel?: string;
  since?: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { out: process.env.OMNI_BRAIN_EXPORT_DIR || join(homedir(), 'central-brain', 'raw'), dryRun: false };
  const value = (i: number, flag: string) => {
    const v = argv[i];
    if (!v || v.startsWith('--')) {
      console.error(`${flag} needs a value`);
      process.exit(2);
    }
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--dry-run') a.dryRun = true;
    else if (v === '--out') a.out = value(++i, v);
    else if (v.startsWith('--out=')) a.out = v.slice(6);
    else if (v === '--channel') a.channel = value(++i, v);
    else if (v.startsWith('--channel=')) a.channel = v.slice(10);
    else if (v === '--since') a.since = value(++i, v);
    else if (v.startsWith('--since=')) a.since = v.slice(8);
    else if (v === '--help' || v === '-h') {
      console.log('usage: npm run brain-export -- [--channel <id>] [--since <YYYY-MM-DD>] [--dry-run] [--out <dir>]');
      process.exit(0);
    } else {
      console.error(`unknown argument: ${v}`);
      process.exit(2);
    }
  }
  if (a.since && Number.isNaN(Date.parse(a.since))) {
    console.error('--since must be a date like 2026-10-01');
    process.exit(2);
  }
  a.out = resolve(a.out.replace(/^~(?=\/|$)/, homedir()));
  return a;
}

/** Every secret value Omni stored, read from the Keychain by the names in the secrets table. Never logged. */
async function keychainValues(ro: DatabaseSync): Promise<string[]> {
  const rows = ro.prepare('SELECT scope, name FROM secrets').all() as unknown as { scope: string; name: string }[];
  const values: string[] = [];
  let missing = 0;
  for (const r of rows) {
    try {
      const { stdout } = await run('security', ['find-generic-password', '-s', 'omni-os', '-a', `${r.scope}/${r.name}`, '-w']);
      const v = stdout.replace(/\n$/, '');
      if (v) values.push(v);
    } catch {
      missing++;
    }
  }
  console.log(`redaction: ${values.length} Omni secret values loaded from the Keychain${missing ? `, ${missing} unreadable` : ''}`);
  return values;
}

const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(2);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!existsSync(paths.db)) {
    console.error(`no Omni database at ${paths.db}`);
    process.exit(1);
  }
  const ro = new DatabaseSync(paths.db, { readOnly: true });
  const stored = ro.prepare('SELECT value FROM kv WHERE key = ?').get(CURSOR_KEY) as { value: string } | undefined;
  const cursor: Cursor = stored ? JSON.parse(stored.value) : emptyCursor();

  const redact = makeRedactor([...(await keychainValues(ro)), ...envSecretValues(process.env)]);
  const planned = plan(ro, { channel: args.channel, since: args.since, cursor, redact, timezone: config.timezone, home: homedir() });

  const skips: Partial<Record<SkipReason, number>> = {};
  const perChannel = new Map<string, { files: number; bytes: number }>();
  let bytes = 0;
  let files = 0;
  const next: Cursor = { version: 1, threads: { ...cursor.threads } };
  // Only a real run opens db.ts (which migrates and records the kv write for sync).
  const kv = args.dryRun ? null : (await import('../db.ts')).kv;

  for (const p of planned) {
    if ('skip' in p) {
      skips[p.skip] = (skips[p.skip] ?? 0) + 1;
      continue;
    }
    const d = p.digest;
    const size = Buffer.byteLength(d.content);
    files++;
    bytes += size;
    const c = perChannel.get(d.channelId) ?? { files: 0, bytes: 0 };
    perChannel.set(d.channelId, { files: c.files + 1, bytes: c.bytes + size });
    if (args.dryRun) {
      console.log(`would write ${d.path} (${(size / 1024).toFixed(1)} KB)`);
      continue;
    }
    const file = join(args.out, d.path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, d.content);
    next.threads[d.threadId] = { uid: d.lastUid, part: d.part };
    // Save as we go, so an interrupted run never writes a part twice.
    if (files % 25 === 0) kv!.set(CURSOR_KEY, next);
  }
  if (kv && files) kv.set(CURSOR_KEY, next);

  console.log('');
  for (const [id, c] of [...perChannel].sort((a, b) => b[1].bytes - a[1].bytes)) {
    console.log(`${id.padEnd(22)} ${String(c.files).padStart(4)} files  ${mb(c.bytes).padStart(7)} MB`);
  }
  const skipped = Object.entries(skips).map(([k, n]) => `${n} ${k}`);
  console.log(
    `\n${args.dryRun ? 'Would write' : 'Wrote'} ${files} files, ${mb(bytes)} MB, ~${Math.round(bytes / 4 / 1000)}K tokens` +
      `${args.dryRun ? '' : ` to ${join(args.out, 'omni')}`}.${skipped.length ? ` Skipped: ${skipped.join(', ')}.` : ''}`,
  );
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});
