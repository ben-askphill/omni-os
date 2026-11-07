import { describe, expect, it } from 'vitest';
import {
  parseSecretAsk,
  SECRET_ANSWER_EVENT,
  SECRET_REQUEST_EVENT,
  secretRequestsIn,
  secretResultText,
  secretSavedMessage,
  settledWords,
  secretScopeKey,
  valueProblem,
  type SecretAsk,
} from '../secret-request.ts';

const ASK: SecretAsk = { name: 'STRIPE_TEST_KEY', label: 'Stripe test secret key', scope: 'channel', reason: 'To run the checkout tests' };

describe('parseSecretAsk', () => {
  it('trims, defaults scope to channel and an empty reason to null', () => {
    expect(parseSecretAsk({ name: ' STRIPE_TEST_KEY ', label: ' Stripe test secret key ', reason: '  ' })).toEqual({
      ok: true,
      value: { name: 'STRIPE_TEST_KEY', label: 'Stripe test secret key', scope: 'channel', reason: null },
    });
    expect(parseSecretAsk({ ...ASK, scope: 'global' })).toEqual({ ok: true, value: { ...ASK, scope: 'global' } });
  });

  it.each([
    ['not an object', 'STRIPE_TEST_KEY'],
    ['a lower case name', { ...ASK, name: 'stripe_key' }],
    ['a name with a dash', { ...ASK, name: 'STRIPE-KEY' }],
    ["one of Omni's names", { ...ASK, name: 'OMNI_RELAY_TOKEN' }],
    ['PATH', { ...ASK, name: 'PATH' }],
    ['a loader variable', { ...ASK, name: 'LD_PRELOAD' }],
    ['a harness setting', { ...ASK, name: 'CLAUDE_ENV_FILE' }],
    ['an empty label', { ...ASK, label: ' ' }],
    ['a long label', { ...ASK, label: 'x'.repeat(81) }],
    ['an unknown scope', { ...ASK, scope: 'channel:inbox' }],
    ['a reason that is not text', { ...ASK, reason: 42 }],
    ['a long reason', { ...ASK, reason: 'x'.repeat(301) }],
  ])('refuses %s', (_name, raw) => {
    const r = parseSecretAsk(raw);
    expect(r.ok).toBe(false);
  });

  it('accepts names that only start like a reserved one', () => {
    expect(parseSecretAsk({ ...ASK, name: 'GITHUB_TOKEN' }).ok).toBe(true);
    expect(parseSecretAsk({ ...ASK, name: 'PATHFINDER_KEY' }).ok).toBe(true);
  });
});

describe('valueProblem', () => {
  it('takes one non-empty line', () => {
    expect(valueProblem('dummy-value-123')).toBeNull();
    expect(valueProblem('')).not.toBeNull();
    expect(valueProblem('a\nb')).not.toBeNull();
    expect(valueProblem('x'.repeat(16_385))).not.toBeNull();
  });
});

describe('secretScopeKey', () => {
  it("names the thread's channel or global", () => {
    expect(secretScopeKey('channel', 'omni-os')).toBe('channel:omni-os');
    expect(secretScopeKey('global', 'omni-os')).toBe('global');
  });
});

describe('what the agent reads', () => {
  it('names the env var and tells the agent to end its turn once saved', () => {
    const t = secretResultText(ASK, 'saved');
    expect(t).toContain('$STRIPE_TEST_KEY');
    expect(t).toContain('end your turn');
    expect(secretSavedMessage(ASK)).toContain('$STRIPE_TEST_KEY');
  });

  it('says what happened otherwise', () => {
    expect(secretResultText(ASK, 'cancelled')).toContain('cancelled');
    expect(secretResultText(ASK, 'dismissed')).toContain('latest message');
    expect(secretResultText(ASK, 'pending')).toContain('not entered');
  });
});

describe('secretRequestsIn', () => {
  const asked = (id: number, rid: string, exists = false) => ({ id, kind: SECRET_REQUEST_EVENT, payload: JSON.stringify({ id: rid, ask: ASK, exists }) });
  const answered = (id: number, rid: string, state: string, replaced = false) => ({
    id,
    kind: SECRET_ANSWER_EVENT,
    payload: { id: rid, state, replaced, via: 'tool' },
  });

  it('pairs each request with its first answer', () => {
    const list = secretRequestsIn([asked(1, 'a', true), asked(2, 'b'), answered(3, 'a', 'saved', true), answered(4, 'a', 'cancelled'), { id: 5, kind: 'user', payload: {} }]);
    expect(list).toEqual([
      { id: 'a', event_id: 1, ask: ASK, exists: true, state: 'saved', replaced: true },
      { id: 'b', event_id: 2, ask: ASK, exists: false, state: 'pending', replaced: false },
    ]);
  });
});

describe('settledWords', () => {
  it('says where a saved secret went and under what name', () => {
    expect(settledWords({ ask: ASK, state: 'saved', replaced: false })).toBe('Saved to this channel as STRIPE_TEST_KEY');
    expect(settledWords({ ask: { ...ASK, scope: 'global' }, state: 'saved', replaced: false })).toBe('Saved to every channel as STRIPE_TEST_KEY');
    expect(settledWords({ ask: ASK, state: 'saved', replaced: true })).toBe('Saved to this channel as STRIPE_TEST_KEY, replacing the old value');
  });

  it('says cancelled and not entered, and nothing while it waits', () => {
    expect(settledWords({ ask: ASK, state: 'cancelled', replaced: false })).toBe('Cancelled');
    expect(settledWords({ ask: ASK, state: 'dismissed', replaced: false })).toBe('Not entered');
    expect(settledWords({ ask: ASK, state: 'pending', replaced: false })).toBe('');
  });
});
