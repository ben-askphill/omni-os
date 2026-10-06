// Open, migrate on import, and re-export the repositories. Callers keep importing from here.
import { migrate } from './db/migrate.ts';
import { seedSystemChannels } from './db/repos/channels.ts';
import { loadArmed } from './db/sync.ts';

migrate();
loadArmed();
seedSystemChannels();

export { db, tx } from './db/connection.ts';
export { migrate } from './db/migrate.ts';
export type { ChannelKind, Channel } from './db/repos/channels.ts';
export { channels, publicChannel } from './db/repos/channels.ts';
export type { ThreadStatus, ThreadSource, Thread } from './db/repos/threads.ts';
export { THREAD_COLUMNS, threads } from './db/repos/threads.ts';
export type { EventRow } from './db/repos/events.ts';
export { EVENT_COLUMNS, indexEvent, events } from './db/repos/events.ts';
export type { SearchHit } from './db/repos/search.ts';
export { search } from './db/repos/search.ts';
export type { Artifact } from './db/repos/artifacts.ts';
export { ARTIFACT_COLUMNS, artifacts } from './db/repos/artifacts.ts';
export { automationRuns } from './db/repos/automation-runs.ts';
export { kv } from './db/repos/kv.ts';
export type { SyncEntity, SyncOp, OutboxRow } from './db/sync.ts';
export { SEED_TS, outbox, syncMeta } from './db/sync.ts';
