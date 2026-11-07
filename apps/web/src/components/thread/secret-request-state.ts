import type { SecretRequestState } from '@omni/shared/secret-request.ts';

export type Settled = Exclude<SecretRequestState, 'pending'>;

/** Where a secret request's card stands. */
export type Phase =
  | { at: 'editing'; value: string; error: string | null }
  /** A secret of that name is set: saving replaces it, so the card asks once more. */
  | { at: 'confirmReplace'; value: string; error: string | null }
  | { at: 'sending'; value: string; replace: boolean }
  | { at: 'cancelling'; value: string }
  | { at: 'settled'; state: Settled; replaced: boolean };

export const START: Phase = { at: 'editing', value: '', error: null };

/** Ben typed: back to editing, whatever the card asked before. */
export function typed(p: Phase, value: string): Phase {
  return p.at === 'editing' || p.at === 'confirmReplace' ? { at: 'editing', value, error: null } : p;
}

/**
 * Save pressed (or Enter). A request that found a secret there asks once before it replaces it; the second press sends.
 * `exists` is what the agent saw when it asked: a 409 from the server turns an unexpected one into the same step.
 */
export function save(p: Phase, exists: boolean): Phase {
  if (p.at === 'editing') return exists ? { at: 'confirmReplace', value: p.value, error: null } : { at: 'sending', value: p.value, replace: false };
  if (p.at === 'confirmReplace') return { at: 'sending', value: p.value, replace: true };
  return p;
}

export const cancel = (p: Phase): Phase => (p.at === 'editing' || p.at === 'confirmReplace' ? { at: 'cancelling', value: p.value } : p);

export const saved = (replaced: boolean): Phase => ({ at: 'settled', state: 'saved', replaced });
export const cancelled: Phase = { at: 'settled', state: 'cancelled', replaced: false };

const SETTLED: readonly string[] = ['saved', 'cancelled', 'dismissed'];
const field = (body: unknown, key: string) => (body && typeof body === 'object' ? (body as Record<string, unknown>)[key] : undefined);

/**
 * The server refused a send or a cancel (apps/server/secret-requests-api.ts). A 409 with `exists` is the replace step. A
 * 409 with a `state` means it was settled from another device or by a message: that is the answer, and the stream brings
 * the rest. Anything else says why, and the value stays for another try.
 */
export function refused(p: Phase, status: number, body: unknown, message: string): Phase {
  if (p.at !== 'sending' && p.at !== 'cancelling') return p;
  if (status === 409) {
    const state = field(body, 'state');
    if (typeof state === 'string' && SETTLED.includes(state)) return { at: 'settled', state: state as Settled, replaced: false };
    if (p.at === 'sending' && field(body, 'exists') === true) return { at: 'confirmReplace', value: p.value, error: null };
  }
  return p.at === 'sending' && p.replace ? { at: 'confirmReplace', value: p.value, error: message } : { at: 'editing', value: p.value, error: message };
}
