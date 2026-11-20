// Remote agents (ADR 0020): an agent whose run is a server Omni reaches over HTTP, Hermes (`hermes`) or one Ben
// connected (`custom:<slug>`). The server (its address, kind, key and cap) is a detail of the agent, so it never shows in
// the harness and model pickers. A thread led by one talks only: local agents seated in it change the files. Pure, for
// every client and the server.
import { isCustomHarnessId } from './custom-harness.ts';

/** A harness id that is a remote agent's server: Hermes, or a custom harness. Cursor Cloud is a harness, not an agent. */
export const isRemoteAgentHarness = (h: string | null | undefined): boolean => h === 'hermes' || isCustomHarnessId(h);

/** The harnesses the pickers list: every one that is not a remote agent's server. */
export const localHarnesses = <T extends { id: string }>(list: readonly T[]): T[] => list.filter((h) => !isRemoteAgentHarness(h.id));

/** The most an avatar a server offers when it connects may weigh, as image data (Q29). */
export const OFFERED_AVATAR_MAX_BYTES = 256 * 1024;

/** A remote agent's server as an agent's page shows it (GET /api/crew). Never the key, only its secret's name. */
export interface RemoteServer {
  /** The harness id its threads run on: `hermes` or `custom:<slug>`. */
  harness: string;
  /** Hermes's Settings entry, rather than a file Ben connected (data/harnesses/). */
  builtIn: boolean;
  kind: 'runs-api' | 'eve';
  /** The base URL and its host. Empty when none is set on this machine. */
  url: string;
  host: string;
  /** The secret its key is read from, on each machine. */
  secret: string;
  /** How many of its turns run at once. */
  cap: number;
  /** It answered the last check with its key. */
  available: boolean;
  /** Why it cannot run, when it cannot. */
  fix?: string;
  /** Its avatar is the one the server offered, which Test connection reads again (Q29). */
  avatarOffered?: boolean;
}

/** The connection status line on the Server card, shown with technical details off too (Q30). */
export const serverStatus = (s: Pick<RemoteServer, 'available' | 'fix'>) => (s.available ? 'Connected' : s.fix ? `Not connected: ${s.fix}` : 'Not connected');

/**
 * Remote agents can see this channel's work (ADR 0020, Q36): its messages, and its threads' git-tracked files through
 * the read tool. Off in a channel from an older server, which has no such switch.
 */
export const remoteReadsOpen = (channel: { remote_work?: number } | null | undefined): boolean => channel?.remote_work === 1;

/** What a remote agent may do with a thread's files, for the quick-actions card's Files row. */
export const remoteFiles = (open: boolean) => (open ? "Can read, can't change" : "Can't read or change");

/** The crumbs' note on a thread a remote agent leads. */
export const TALKS_ONLY = 'talks only';

/** The composer's placeholder in a thread a remote agent leads: who gets the message, and who changes files. */
export const remoteLeadPlaceholder = (lead: string) => `Message ${lead}. A local agent changes files: @ one to seat it`;

/** The lock line under a remote agent's reply that could not read files, linking Channel settings. */
export const remoteLockLine = (channel: string) => `Remote agents can't read files in #${channel}`;

/**
 * A thread whose files are on its machine although a remote agent leads it: every one since slice 4 (Q31). One from
 * before has only its own data folder (`<data>/threads/<id>`), so no Changes, branch or Commit.
 */
export const remoteLedCheckout = (t: { id: string; harness: string; cwd?: string | null }): boolean =>
  isRemoteAgentHarness(t.harness) && !!t.cwd && !new RegExp(`[\\\\/]threads[\\\\/]${t.id}[\\\\/]?$`).test(t.cwd);

/** A commit's default subject in a remote-led thread: the thread's title, as Ben would name the work. */
export const commitSubject = (title: string) => title.trim().slice(0, 120) || 'Changes from this thread';
