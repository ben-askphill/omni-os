import { describe, expect, it } from 'vitest';
import type { SecretAsk } from '../secret-request.ts';
import { settledWords } from '../secret-request-words.ts';

const ask = (scope: SecretAsk['scope']): SecretAsk => ({ name: 'STRIPE_TEST_KEY', label: 'Stripe test secret key', scope, reason: null });

describe('settledWords', () => {
  it('says where a saved secret went and under what name', () => {
    expect(settledWords({ ask: ask('channel'), state: 'saved', replaced: false })).toBe('Saved to this channel as STRIPE_TEST_KEY');
    expect(settledWords({ ask: ask('global'), state: 'saved', replaced: false })).toBe('Saved to every channel as STRIPE_TEST_KEY');
  });

  it('says when it replaced the old value', () => {
    expect(settledWords({ ask: ask('channel'), state: 'saved', replaced: true })).toBe('Saved to this channel as STRIPE_TEST_KEY, replacing the old value');
  });

  it('says cancelled and not entered, and nothing while it waits', () => {
    expect(settledWords({ ask: ask('channel'), state: 'cancelled', replaced: false })).toBe('Cancelled');
    expect(settledWords({ ask: ask('channel'), state: 'dismissed', replaced: false })).toBe('Not entered');
    expect(settledWords({ ask: ask('channel'), state: 'pending', replaced: false })).toBe('');
  });
});
