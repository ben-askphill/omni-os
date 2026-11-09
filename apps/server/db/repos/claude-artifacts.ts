import { artifactKey, DEFAULT_SCHEDULE, isSchedule, type ClaudeArtifact, type ClaudeArtifactsSchedule, type ClaudeArtifactsState, type ListedArtifact } from '@omni/shared/claude-artifacts.ts';
import { db, tx } from '../connection.ts';

// The cache behind the claude.ai Artifacts screen (apps/server/claude-artifacts.ts). Machine-local: nothing here is
// recorded for sync.

interface Row {
  id: string;
  url: string;
  title: string;
  scope: 'mine' | 'shared';
  type: string | null;
  updated_on: string | null;
  rank: number;
}

/** The run state, without `refreshing`, which only the running process knows. */
export type StoredState = Omit<ClaudeArtifactsState, 'refreshing'>;

const EMPTY: StoredState = {
  schedule: DEFAULT_SCHEDULE,
  last_attempt_at: null,
  last_success_at: null,
  types_at: null,
  total: null,
  complete: true,
  error: null,
  cli_version: null,
};

const meta = {
  get: <T>(key: string): T | undefined => {
    const row = db.prepare('SELECT value FROM claude_artifacts_meta WHERE key = ?').get(key) as { value: string } | undefined;
    return row ? (JSON.parse(row.value) as T) : undefined;
  },
  set: (key: string, value: unknown) =>
    db.prepare('INSERT INTO claude_artifacts_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value)),
};

/** Local files threads published, newest per page, keyed by page so both link forms join. */
function localPublished(): Map<string, NonNullable<ClaudeArtifact['local']>> {
  const rows = db
    .prepare(
      `SELECT a.id, a.url, a.thread_id, t.title AS thread_title, t.channel_id FROM artifacts a JOIN threads t ON t.id = a.thread_id
       WHERE a.url IS NOT NULL ORDER BY a.updated_at ASC, a.id ASC`,
    )
    .all() as unknown as { id: number; url: string; thread_id: string; thread_title: string; channel_id: string }[];
  const out = new Map<string, NonNullable<ClaudeArtifact['local']>>();
  // Oldest first, so the newest file per page is the one left.
  for (const r of rows) {
    const key = artifactKey(r.url);
    if (key) out.set(key, { artifact_id: r.id, thread_id: r.thread_id, thread_title: r.thread_title, channel_id: r.channel_id });
  }
  return out;
}

export const claudeArtifacts = {
  /** Every page the last good listing had, in the tool's order, each with the local file a thread published as it. */
  list(): ClaudeArtifact[] {
    const rows = db
      .prepare('SELECT id, url, title, scope, type, updated_on, rank FROM claude_artifacts WHERE gone_at IS NULL ORDER BY rank, title')
      .all() as unknown as Row[];
    const local = localPublished();
    return rows.map((r) => ({ ...r, local: local.get(r.id) ?? null }));
  },

  /**
   * Save one good listing. Each row takes its place in the order; a page seen before keeps its type unless `types`
   * maps it. `complete`: the listing had every page, so one it lacks is hidden as gone. `types`: the daily type pass,
   * key to slug, where a page in no type list is `plain`.
   */
  save(rows: ListedArtifact[], opts: { complete: boolean; at: string; types?: Map<string, string>; plain?: string }) {
    tx(() => {
      const upsert = db.prepare(
        `INSERT INTO claude_artifacts (id, url, title, scope, type, updated_on, rank, first_seen_at, last_seen_at, gone_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
         ON CONFLICT(id) DO UPDATE SET url = excluded.url, title = excluded.title, scope = excluded.scope,
           type = COALESCE(excluded.type, claude_artifacts.type), updated_on = excluded.updated_on, rank = excluded.rank,
           last_seen_at = excluded.last_seen_at, gone_at = NULL`,
      );
      rows.forEach((r, i) => {
        const type = opts.types ? (opts.types.get(r.key) ?? opts.plain ?? null) : null;
        upsert.run(r.key, r.url, r.title, r.scope, type, r.updated_on, i, opts.at, opts.at);
      });
      if (opts.complete) db.prepare('UPDATE claude_artifacts SET gone_at = ? WHERE gone_at IS NULL AND last_seen_at <> ?').run(opts.at, opts.at);
    });
  },

  state(): StoredState {
    return { ...EMPTY, ...(meta.get<Partial<StoredState>>('state') ?? {}), schedule: claudeArtifacts.schedule() };
  },
  /** Merge into the saved run state. The schedule has its own setter. */
  setState(patch: Partial<Omit<StoredState, 'schedule'>>) {
    const { schedule: _schedule, ...cur } = claudeArtifacts.state();
    meta.set('state', { ...cur, ...patch });
  },
  schedule(): ClaudeArtifactsSchedule {
    const s = meta.get<string>('schedule');
    return isSchedule(s) ? s : DEFAULT_SCHEDULE;
  },
  setSchedule: (s: ClaudeArtifactsSchedule) => meta.set('schedule', s),
};
