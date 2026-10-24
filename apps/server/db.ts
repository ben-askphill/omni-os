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
export type { ThreadStatus, ThreadSource, ThreadSetup, ThreadLimit, LimitStop, Thread, PastSession, Sessions, PendingHandover, SessionState, StoredSessionState } from './db/repos/threads.ts';
export { THREAD_COLUMNS, threads } from './db/repos/threads.ts';
export type { Folder } from './db/repos/folders.ts';
export { DEFAULT_FOLDER_NAME, FOLDER_NAME_MAX, FolderError, folderName, folders } from './db/repos/folders.ts';
export type { EventRow } from './db/repos/events.ts';
export { EVENT_COLUMNS, indexEvent, events } from './db/repos/events.ts';
export type { SearchHit } from './db/repos/search.ts';
export { search } from './db/repos/search.ts';
export type { Artifact } from './db/repos/artifacts.ts';
export { ARTIFACT_COLUMNS, artifacts } from './db/repos/artifacts.ts';
export { automationRuns } from './db/repos/automation-runs.ts';
export { kv } from './db/repos/kv.ts';
export type { DeliveryState, FileDigest, MessageRequest } from './db/repos/requests.ts';
export { EDITABLE, PARKED, fileDigests, messageRequests, requestFingerprint } from './db/repos/requests.ts';
export type { Completion, CompletionStatus, NeedsYou, NeedsYouBlocker, NeedsYouItem, NeedsYouResult, ResultRead } from './db/repos/needs-you.ts';
export { advanceRead, completions, needsYou, resultReads } from './db/repos/needs-you.ts';
export type { BaseHow, ThreadBase } from './db/repos/thread-bases.ts';
export { threadBases } from './db/repos/thread-bases.ts';
export { threadBasePicks } from './db/repos/thread-base-picks.ts';
export { actionRuns, channelActions, threadSetupRuns } from './db/repos/channel-actions.ts';
export type { SkippedFile, TurnSnapshot, TurnSnapshotState } from './db/repos/turn-snapshots.ts';
export { turnSnapshots } from './db/repos/turn-snapshots.ts';
export { continuations, type Continuation } from './db/repos/continuations.ts';
export type { SyncEntity, SyncOp, OutboxRow } from './db/sync.ts';
export { SEED_TS, outbox, syncMeta } from './db/sync.ts';
