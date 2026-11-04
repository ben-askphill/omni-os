// What a settled secret request says, for the card in the Web UI and the row in the iOS app. Names only, never a value.
import { scopeWords, type SecretRequestState, type ThreadSecretRequest } from './secret-request.ts';

/** What became of a request: where it went and under what name, or that Ben said no. Empty while it is pending. */
export function settledWords(r: Pick<ThreadSecretRequest, 'ask' | 'state' | 'replaced'>): string {
  const state: SecretRequestState = r.state;
  if (state === 'saved') return `Saved to ${scopeWords(r.ask.scope)} as ${r.ask.name}${r.replaced ? ', replacing the old value' : ''}`;
  if (state === 'cancelled') return 'Cancelled';
  if (state === 'dismissed') return 'Not entered';
  return '';
}
