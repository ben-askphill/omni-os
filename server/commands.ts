// The command list service: each harness's own commands for a folder, read live from its CLI.
// Omni copies nothing. A list is cached per harness and folder, served at once, and refreshed in
// the background once it is 30 seconds old. One probe runs at a time per harness and folder, and
// a failed probe keeps the last good list.
import { runnableCommands, type SlashCommand } from '../shared/slash.ts';
import { probeClaudeCommands } from './harness/claude/commands.ts';
import { probeCodexSkills } from './harness/codex/commands.ts';
import { probeCursorCommands } from './harness/cursor/commands.ts';
import type { HarnessId } from './harness/types.ts';

export interface CommandList {
  /** `loading`: nothing cached yet and a probe is running. `unavailable`: the harness didn't answer. */
  status: 'ready' | 'loading' | 'unavailable';
  /** When unavailable, the command that fixes it. */
  fix?: string;
  commands: SlashCommand[];
  /** When the list was read from the harness (epoch ms). */
  fetchedAt: number | null;
}

interface Source {
  probe: (cwd: string) => Promise<SlashCommand[] | null>;
  fix: string;
}

const SOURCES: Partial<Record<HarnessId, Source>> = {
  'claude-code': { probe: probeClaudeCommands, fix: 'claude doctor' },
  codex: { probe: probeCodexSkills, fix: 'codex doctor' },
  // Cursor Agent has no doctor; `status` says whether it is logged in.
  cursor: { probe: probeCursorCommands, fix: 'cursor-agent status' },
};

/** A list older than this is served, then refreshed. */
const STALE_MS = 30_000;
/** A harness that didn't answer is asked again after this long. */
const RECHECK_MS = 10_000;

interface Entry {
  list?: SlashCommand[];
  fetchedAt?: number;
  /** When the last probe finished, and whether it answered. */
  checkedAt?: number;
  ok?: boolean;
  inflight?: Promise<void>;
  /** Bumped by each invalidation, so a probe that was running then doesn't count as fresh. */
  gen: number;
}

const entries = new Map<string, Entry>();

function refresh(e: Entry, src: Source, cwd: string) {
  const gen = e.gen;
  e.inflight = src
    .probe(cwd)
    .catch(() => null)
    .then((list) => {
      const now = Date.now();
      // The harness may have read its commands before the change, so the next call asks again.
      if (e.gen === gen) e.checkedAt = now;
      e.ok = !!list;
      if (list) {
        e.list = runnableCommands(list);
        e.fetchedAt = now;
      }
    })
    .finally(() => {
      e.inflight = undefined;
    });
}

function snapshot(e: Entry, src: Source): CommandList {
  if (e.list) return { status: 'ready', commands: e.list, fetchedAt: e.fetchedAt! };
  if (e.inflight) return { status: 'loading', commands: [], fetchedAt: null };
  return { status: 'unavailable', fix: src.fix, commands: [], fetchedAt: null };
}

function entry(harness: HarnessId, cwd: string, src: Source): Entry {
  const key = `${harness}\0${cwd}`;
  let e = entries.get(key);
  if (!e) entries.set(key, (e = { gen: 0 }));
  const due = e.checkedAt === undefined || Date.now() - e.checkedAt >= (e.ok ? STALE_MS : RECHECK_MS);
  if (due && !e.inflight) refresh(e, src, cwd);
  return e;
}

const NONE: CommandList = { status: 'ready', commands: [], fetchedAt: null };

/** What is cached for a harness and folder right now. A stale or missing list starts a refresh. */
export function peekCommands(harness: HarnessId, cwd: string): CommandList {
  const src = SOURCES[harness];
  return src ? snapshot(entry(harness, cwd, src), src) : NONE;
}

/**
 * Mark every cached list of a harness out of date, so the next call asks it again. A change to
 * personal commands shows in every folder.
 */
export function invalidateCommands(harness: HarnessId) {
  for (const [key, e] of entries) {
    if (!key.startsWith(`${harness}\0`)) continue;
    e.checkedAt = undefined;
    e.gen++;
  }
}

/**
 * A harness's commands for a folder. Serves the cache and refreshes a stale one in the
 * background; `wait` waits for a refresh that is running.
 */
export async function listCommands(harness: HarnessId, cwd: string, opts: { wait?: boolean } = {}): Promise<CommandList> {
  const src = SOURCES[harness];
  if (!src) return NONE;
  const e = entry(harness, cwd, src);
  if (opts.wait && e.inflight) await e.inflight;
  return snapshot(e, src);
}
