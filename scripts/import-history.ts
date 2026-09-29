// Imports existing Claude Code sessions (~/.claude/projects/*/*.jsonl) into Omni as resumable threads.
//
//   npx tsx scripts/import-history.ts [--days 30] [--dry-run] [--project <dir-substring>] [--all-entrypoints]
//                                     [--min-idle 10] [--remap] [--verbose]
//
//   --min-idle N      skip sessions written to in the last N minutes (probably still open elsewhere). Default 10.
//   --all-entrypoints also import headless SDK sessions (sdk-py/sdk-ts); skipped by default.
//   --remap           after creating channels, move threads sitting in #imported to the channel whose
//                     repo_path/base_dir now matches their cwd. Nothing else is imported in this mode.
//
// Each session becomes a thread with id = session_id = the jsonl uuid, status 'imported', source 'import',
// has_run 1 (so a new message runs `claude --resume <id>` in the original cwd). Idempotent: existing ids are skipped.

import { readdirSync, readFileSync, statSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, basename } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { paths, artifactsDir, browserOutDir } from '../server/config.ts';
import { parseSession, matchChannel, type ParsedSession } from './lib/claude-session.ts';

const IMPORTED_CHANNEL = { id: 'imported', name: 'Imported history', kind: 'internal' as const };
/** Headless, machine-driven sessions. Omni's own runs already live in the DB. */
const AUTOMATED_ENTRYPOINTS = new Set(['sdk-py', 'sdk-ts', 'omni-os', 'omni-os-title']);
const UUID_FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/i;

interface Args {
  days: number;
  minIdle: number;
  remap: boolean;
  dryRun: boolean;
  project?: string;
  allEntrypoints: boolean;
  verbose: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { days: 30, minIdle: 10, remap: false, dryRun: false, allEntrypoints: false, verbose: false };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--dry-run') a.dryRun = true;
    else if (v === '--all-entrypoints') a.allEntrypoints = true;
    else if (v === '--verbose' || v === '-v') a.verbose = true;
    else if (v === '--remap') a.remap = true;
    else if (v === '--min-idle') a.minIdle = Number(argv[++i]);
    else if (v.startsWith('--min-idle=')) a.minIdle = Number(v.slice(11));
    else if (v === '--days') a.days = Number(argv[++i]);
    else if (v.startsWith('--days=')) a.days = Number(v.slice(7));
    else if (v === '--project') a.project = argv[++i];
    else if (v.startsWith('--project=')) a.project = v.slice(10);
    else if (v === '--help' || v === '-h') {
      console.log(
        'usage: npx tsx scripts/import-history.ts [--days 30] [--dry-run] [--project <dir-substring>] [--all-entrypoints] [--min-idle 10] [--remap] [--verbose]',
      );
      process.exit(0);
    } else {
      console.error(`unknown argument: ${v}`);
      process.exit(2);
    }
  }
  if (!Number.isFinite(a.days) || a.days <= 0) {
    console.error('--days must be a positive number');
    process.exit(2);
  }
  if (!Number.isFinite(a.minIdle) || a.minIdle < 0) {
    console.error('--min-idle must be a number of minutes >= 0');
    process.exit(2);
  }
  return a;
}

interface ChannelLite {
  id: string;
  name: string;
  repo_path: string | null;
  base_dir: string | null;
}

/** What the import needs from the DB. Dry runs use a read-only connection and never create anything. */
interface Store {
  channels(): ChannelLite[];
  threadExists(id: string): boolean;
  ensureImportedChannel(): void;
  insert(s: ParsedSession & { id: string; cwd: string }, channelId: string): void;
}

function readOnlyStore(): Store {
  if (!existsSync(paths.db)) {
    return {
      channels: () => [],
      threadExists: () => false,
      ensureImportedChannel: () => {},
      insert: () => {},
    };
  }
  const ro = new DatabaseSync(paths.db, { readOnly: true });
  return {
    channels: () => ro.prepare('SELECT id, name, repo_path, base_dir FROM channels WHERE archived = 0').all() as unknown as ChannelLite[],
    threadExists: (id) => !!ro.prepare('SELECT 1 FROM threads WHERE id = ?').get(id),
    ensureImportedChannel: () => {},
    insert: () => {},
  };
}

async function writableStore(): Promise<Store> {
  // Imported lazily so --dry-run never opens (or creates) the DB for writing.
  const { db, channels, threads, events } = await import('../server/db.ts');
  return {
    channels: () => channels.list(false),
    threadExists: (id) => !!threads.get(id),
    ensureImportedChannel() {
      if (!channels.get(IMPORTED_CHANNEL.id)) {
        channels.create({ ...IMPORTED_CHANNEL, use_worktree: 0, notes: 'Claude Code sessions imported from ~/.claude/projects.' });
      }
    },
    insert(s, channelId) {
      db.exec('BEGIN');
      try {
        threads.create({
          id: s.id,
          channel_id: channelId,
          title: s.title,
          status: 'imported',
          role: null,
          model: null,
          session_id: s.id,
          has_run: 1,
          cwd: s.cwd,
          branch: null,
          parent_id: null,
          task_id: null,
          source: 'import',
          automation: null,
          created_at: s.createdAt ?? undefined,
        });
        for (const ev of s.events) events.add(s.id, ev.kind, ev.payload, ev.createdAt || undefined);
        threads.update(s.id, { last_text: s.lastText, updated_at: s.updatedAt ?? s.createdAt ?? new Date().toISOString() });
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
      // The runner writes mcp.json into the thread dir before spawning; prepareWorkdir normally creates it.
      mkdirSync(artifactsDir(s.id), { recursive: true });
      mkdirSync(browserOutDir(s.id), { recursive: true });
    },
  };
}

type Skip = 'exists' | 'active' | 'no-cwd' | 'no-prompt' | 'automated' | 'unreadable';

interface ChannelStats {
  name: string;
  threads: number;
  events: number;
  missingCwd: number;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = join(homedir(), '.claude', 'projects');
  if (!existsSync(root)) {
    console.error(`no Claude Code projects dir at ${root}`);
    process.exit(1);
  }

  if (args.remap) return remap(args.dryRun);

  const store = args.dryRun ? readOnlyStore() : await writableStore();
  const channelList = store.channels();
  const cutoff = Date.now() - args.days * 86_400_000;
  const idleCutoff = Date.now() - args.minIdle * 60_000;

  const files: { path: string; dir: string; mtime: number }[] = [];
  for (const dir of readdirSync(root)) {
    if (args.project && !dir.toLowerCase().includes(args.project.toLowerCase())) continue;
    const full = join(root, dir);
    let entries: string[];
    try {
      if (!statSync(full).isDirectory()) continue;
      entries = readdirSync(full);
    } catch {
      continue;
    }
    for (const f of entries) {
      if (!UUID_FILE.test(f)) continue;
      const p = join(full, f);
      const st = statSync(p);
      if (st.isFile() && st.mtimeMs >= cutoff) files.push({ path: p, dir, mtime: st.mtimeMs });
    }
  }
  files.sort((a, b) => a.mtime - b.mtime);

  const skips: Record<Skip, number> = { exists: 0, active: 0, 'no-cwd': 0, 'no-prompt': 0, automated: 0, unreadable: 0 };
  const skippedEntrypoints: Record<string, number> = {};
  const perChannel = new Map<string, ChannelStats>();
  const entrypoints: Record<string, number> = {};
  let importedChannelNeeded = false;
  let failures = 0;

  for (const f of files) {
    const id = basename(f.path, '.jsonl').toLowerCase();
    if (store.threadExists(id)) {
      skips.exists++;
      continue;
    }
    if (f.mtime > idleCutoff) {
      skips.active++;
      if (args.verbose) console.log(`  skip active ${f.path}`);
      continue;
    }
    let parsed: ParsedSession;
    try {
      parsed = parseSession(readFileSync(f.path, 'utf8'), f.dir);
    } catch (err) {
      skips.unreadable++;
      if (args.verbose) console.warn(`  unreadable ${f.path}: ${(err as Error).message}`);
      continue;
    }
    const ep = parsed.entrypoint ?? 'unknown';
    if (!args.allEntrypoints && AUTOMATED_ENTRYPOINTS.has(ep)) {
      skips.automated++;
      skippedEntrypoints[ep] = (skippedEntrypoints[ep] ?? 0) + 1;
      continue;
    }
    if (!parsed.cwd) {
      skips['no-cwd']++;
      continue;
    }
    if (parsed.prompts < 1) {
      skips['no-prompt']++;
      continue;
    }

    const ch = matchChannel(parsed.cwd, channelList);
    const channelId = ch?.id ?? IMPORTED_CHANNEL.id;
    if (!ch && !importedChannelNeeded) {
      importedChannelNeeded = true;
      store.ensureImportedChannel();
    }

    try {
      store.insert({ ...parsed, id, cwd: parsed.cwd }, channelId);
    } catch (err) {
      failures++;
      console.error(`  failed ${id} (${f.path}): ${(err as Error).message}`);
      continue;
    }

    entrypoints[ep] = (entrypoints[ep] ?? 0) + 1;
    const stats = perChannel.get(channelId) ?? { name: ch?.name ?? IMPORTED_CHANNEL.name, threads: 0, events: 0, missingCwd: 0 };
    stats.threads++;
    stats.events += parsed.events.length;
    if (!existsSync(parsed.cwd)) stats.missingCwd++;
    perChannel.set(channelId, stats);
    if (args.verbose) {
      console.log(`  ${args.dryRun ? 'would import' : 'imported'} #${channelId} ${id} ${parsed.updatedAt?.slice(0, 16) ?? ''} [${ep}] ${parsed.title}`);
      console.log(`      cwd=${parsed.cwd}  prompts=${parsed.prompts} events=${parsed.events.length}`);
    }
  }

  const total = [...perChannel.values()].reduce((n, s) => n + s.threads, 0);
  const totalEvents = [...perChannel.values()].reduce((n, s) => n + s.events, 0);
  console.log('');
  console.log(`${args.dryRun ? 'DRY RUN: would import' : 'Imported'} ${total} session(s), ${totalEvents} event(s)`);
  console.log(`scanned ${files.length} jsonl file(s) modified in the last ${args.days} day(s)${args.project ? ` matching "${args.project}"` : ''}`);
  console.log('');
  console.log('channel'.padEnd(28) + 'threads'.padStart(8) + 'events'.padStart(9) + '  cwd gone'.padStart(10));
  for (const [id, s] of [...perChannel.entries()].sort((a, b) => b[1].threads - a[1].threads)) {
    console.log(`#${id}`.padEnd(28) + String(s.threads).padStart(8) + String(s.events).padStart(9) + String(s.missingCwd).padStart(10));
  }
  console.log('');
  console.log(`by entrypoint: ${Object.entries(entrypoints).map(([k, v]) => `${k}=${v}`).join(', ') || 'none'}`);
  console.log(
    `skipped: ${Object.entries(skips).map(([k, v]) => `${k}=${v}`).join(', ')}` +
      (skips.automated ? ` (automated: ${Object.entries(skippedEntrypoints).map(([k, v]) => `${k}=${v}`).join(', ')}; use --all-entrypoints to include)` : ''),
  );
  if (failures) console.log(`failed: ${failures}`);
  if (failures) process.exitCode = 1;
}

/** Moves threads parked in #imported to a channel that now matches their cwd. */
async function remap(dryRun: boolean) {
  const moves: { id: string; title: string; to: string }[] = [];
  if (dryRun) {
    if (!existsSync(paths.db)) return console.log('no database yet');
    const ro = new DatabaseSync(paths.db, { readOnly: true });
    const chans = ro.prepare('SELECT id, name, repo_path, base_dir FROM channels WHERE archived = 0').all() as unknown as ChannelLite[];
    const rows = ro.prepare(`SELECT id, title, cwd FROM threads WHERE channel_id = ? AND source = 'import'`).all(IMPORTED_CHANNEL.id) as {
      id: string;
      title: string;
      cwd: string;
    }[];
    for (const r of rows) {
      const ch = matchChannel(r.cwd, chans);
      if (ch && ch.id !== IMPORTED_CHANNEL.id) moves.push({ id: r.id, title: r.title, to: ch.id });
    }
  } else {
    const { db, channels, threads } = await import('../server/db.ts');
    const chans = channels.list(false);
    const rows = db.prepare(`SELECT id, title, cwd FROM threads WHERE channel_id = ? AND source = 'import'`).all(IMPORTED_CHANNEL.id) as {
      id: string;
      title: string;
      cwd: string;
    }[];
    for (const r of rows) {
      const ch = matchChannel(r.cwd, chans);
      if (!ch || ch.id === IMPORTED_CHANNEL.id) continue;
      // Through the repo, so with sync on the move reaches the other Mac.
      threads.setChannel(r.id, ch.id);
      moves.push({ id: r.id, title: r.title, to: ch.id });
    }
  }
  const by: Record<string, number> = {};
  for (const m of moves) by[m.to] = (by[m.to] ?? 0) + 1;
  console.log(`${dryRun ? 'DRY RUN: would move' : 'Moved'} ${moves.length} imported thread(s) out of #${IMPORTED_CHANNEL.id}`);
  for (const [ch, n] of Object.entries(by).sort((a, b) => b[1] - a[1])) console.log(`  #${ch}`.padEnd(30) + String(n).padStart(6));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
