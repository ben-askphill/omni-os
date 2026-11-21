import { apiPath, type HttpClient } from '../http.ts';
import type { CrewLocks } from '@omni/shared/crew-settings.ts';
import type { RemoteServer } from '@omni/shared/remote-agent.ts';

/** A crew role: a charter with the run it defaults to. A new thread can start as one (`createThread`'s `role`). */
export interface CrewRole {
  id: string;
  name: string;
  description: string;
  /**
   * The role's own look: the path of an image Ben uploaded (`/api/crew/:id/avatar?v=…`, read with the token), else a
   * shared icon (`icon:<name>`) or an emoji, and a hex background. Unset: a built-in's mark, else its initials disc.
   * `shape`: a crew shape id (ADR 0021), sent only when the file names one. One this build does not know is ignored.
   */
  avatar?: { image?: string; icon?: string; shape?: string; bg?: string };
  /** A harness id from the server's catalog. An open string, not a fixed list: outside runtimes join the catalog by id. */
  harness?: string;
  /** A remote agent's server (ADR 0020): set exactly when the agent runs on Hermes or a server Ben connected. Never a key. */
  server?: RemoteServer;
  model?: string;
  effort?: string;
  channel?: string;
  mcp: string[];
  /** full, no-edits (no file-edit tools, shell kept) or delegate-only. A server from before no-edits sends only delegateOnly. */
  tools?: 'full' | 'no-edits' | 'delegate-only';
  /** Routes work only, without the tools that do it. */
  delegateOnly: boolean;
  /** The Conductor may delegate to it. False for the Conductor and usage-scan. */
  delegatable: boolean;
  /** A review role: held at high effort on GPT, and a delegation with `review_of` runs on the other model family. */
  review: boolean;
  /** Whether its threads read its lessons and propose new ones. A server from before role memory sends none: read-write. */
  memory?: 'off' | 'read' | 'read-write';
  /** Whether a lesson its threads propose waits for the user. A server from before role memory sends none: review. */
  memoryWrites?: 'review' | 'auto';
  /** How many lessons its threads proposed wait for the user, when any do. */
  memoryWaiting?: number;
  charter: string;
  /** Shipped with Omni, a built-in with the user's edit, or the user's own. */
  kind: 'shipped' | 'edited' | 'own';
  /** Hidden on this machine. GET /crew lists it only with ?all=1. */
  hidden: boolean;
  /** An edited built-in's: whether its text is added to the shipped charter or replaces it. */
  charterMode?: 'append' | 'replace';
  /** An edited built-in that replaces a shipped charter which changed since the edit. */
  builtInChanged?: boolean;
  /** What a save may not change on a built-in Omni relies on, and what may not be done to it, with why. */
  locks?: CrewLocks;
  /** Why the role's own run defaults are unusable, when they are. */
  error?: string;
}

export function crewApi(http: HttpClient) {
  return {
    crew: () => http.request<CrewRole[]>('GET', apiPath`/crew`),
  };
}
