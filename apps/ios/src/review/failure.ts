import { OmniHttpError } from '@omni/client-core';

export type ReviewFailureKind = 'offline' | 'signed-out' | 'refused' | 'server';

/** Why a Changes or PR call failed, in words for the screen. Only a failure that can pass on its own is worth a Try again. */
export interface ReviewFailure {
  kind: ReviewFailureKind;
  message: string;
  retryable: boolean;
}

const OFFLINE = 'Cannot reach the server. Check the connection and try again.';
const SIGNED_OUT = 'The server no longer accepts this phone. Pair it again from Servers.';

export function describeFailure(error: unknown): ReviewFailure {
  if (!(error instanceof OmniHttpError)) {
    return { kind: 'server', message: error instanceof Error && error.message ? error.message : 'Something went wrong', retryable: true };
  }
  const f = error.failure;
  switch (f.kind) {
    case 'unreachable':
    case 'cancelled':
      return { kind: 'offline', message: OFFLINE, retryable: true };
    case 'http':
      if (f.status === 401) return { kind: 'signed-out', message: SIGNED_OUT, retryable: false };
      return { kind: f.status >= 500 ? 'server' : 'refused', message: f.message, retryable: f.status >= 500 };
    case 'not-json':
    case 'decoding':
    case 'redirect':
      return { kind: 'server', message: error.message, retryable: true };
  }
}

/** What one fetch has told a screen so far: its last answer, and why the latest try failed. */
export interface Fetched<T> {
  data: T | null;
  failure: ReviewFailure | null;
}
