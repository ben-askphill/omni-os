import { OmniHttpError } from '@omni/client-core';

import { classifyFailure } from './send/outbox';

/**
 * Why a machine or continue request did not go through.
 * `offline`: the machine it names is asleep or off Tailscale. `busy`: the thread is not in a state the request needs
 * (another machine runs it, a handoff is in flight, a turn is running). `revoked`: the server no longer accepts this
 * phone. `other`: anything else, including a server that cannot be reached.
 */
export type FailureKind = 'offline' | 'busy' | 'revoked' | 'other';

export interface Failure {
  kind: FailureKind;
  /** One sentence for the user. A refusal carries the server's own words. */
  error: string;
}

export const SIGNED_OUT_ERROR = 'This phone was signed out of the server. Pair it again to continue.';

const OFFLINE = /\b(offline|asleep)\b/i;

/**
 * A 401 here already went through `hub.request`'s refresh, which asked the server whether it still accepts this phone
 * and, if not, forgot the server (see `src/session/paired-session.ts`), so the app is on its way back to Connect.
 * What this adds is the sentence, not a second sign-out path.
 */
export function failureOf(error: unknown): Failure {
  if (classifyFailure(error).kind === 'signed-out') return { kind: 'revoked', error: SIGNED_OUT_ERROR };
  const message = error instanceof Error && error.message ? error.message : 'Something went wrong';
  if (error instanceof OmniHttpError && error.failure.kind === 'http' && error.failure.status === 409) {
    return { kind: OFFLINE.test(message) ? 'offline' : 'busy', error: message };
  }
  return { kind: 'other', error: message };
}
