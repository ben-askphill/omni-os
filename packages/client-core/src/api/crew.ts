import { apiPath, type HttpClient } from '../http.ts';
import type { CrewLocks } from '@omni/shared/crew-settings.ts';

/** A crew role: a charter with the run it defaults to. A new thread can start as one (`createThread`'s `role`). */
export interface CrewRole {
  id: string;
  name: string;
  description: string;
  /** The role's own look: a shared icon (`icon:<name>`) or an emoji, and a hex background. Unset: its mark or monogram. */
  avatar?: { icon?: string; bg?: string };
  /** A harness id from the server's catalog. An open string, not a fixed list: outside runtimes join the catalog by id. */
  harness?: string;
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
