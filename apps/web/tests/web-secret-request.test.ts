import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CrewSecretRequest, SecretAsk, ThreadSecretRequest } from '@omni/shared/secret-request.ts';
import { threadView } from '@omni/shared/thread-view.ts';
import { buildItems, isAsking, type TranscriptEvent } from '@omni/shared/transcript-fold.ts';
import { CrewQuestionList } from '../src/components/thread/CrewQuestions.tsx';
import { SecretRequestCard } from '../src/components/thread/SecretRequestCard.tsx';
import { cancel, cancelled, refused, save, saved, START, typed, type Phase } from '../src/components/thread/secret-request-state.ts';

// The secret card (request_secret) in the Web UI: the card itself, how its phases move, where the fold puts it, and the
// crew list. No test here holds a real secret: the dummy value is a made-up string.

const DUMMY = 'sk_test_not_a_real_key_0000';
const ASK: SecretAsk = { name: 'STRIPE_TEST_KEY', label: 'Stripe test secret key', scope: 'channel', reason: 'To run the checkout tests' };

const request = (extra: Partial<ThreadSecretRequest> = {}): ThreadSecretRequest => ({ id: 's1', event_id: 4, ask: ASK, exists: false, state: 'pending', replaced: false, ...extra });
const html = (r: ThreadSecretRequest, touch = false) => renderToStaticMarkup(createElement(SecretRequestCard, { threadId: 't', r, touch }));
const count = (s: string, needle: string) => s.split(needle).length - 1;

describe('the secret card, pending', () => {
  it('asks for the value in a masked field, with the name, scope and reason', () => {
    const out = html(request());
    expect(out).toContain('Secret');
    expect(out).toContain('Stripe test secret key');
    expect(out).toMatch(/<span class="font-mono">STRIPE_TEST_KEY<\/span> for this channel/);
    expect(out).toContain('To run the checkout tests');
    expect(count(out, '<input')).toBe(1);
    expect(out).toContain('type="password"');
    expect(out).not.toContain('type="text"');
    expect(out).toContain('autoComplete="new-password"');
    expect(out).toContain('maxLength="16384"');
    expect(out).toContain('data-1p-ignore');
    expect(out).toContain('data-lpignore="true"');
    expect(out).toContain('Needs your input');
  });

  it('names the scope in words and leaves out a reason the agent gave none of', () => {
    const out = html(request({ ask: { ...ASK, scope: 'global', reason: null } }));
    expect(out).toContain('for every channel');
    expect(out).not.toContain('this channel');
    expect(out).not.toContain('To run the checkout tests');
  });

  it('offers Save and Cancel, and Save waits for a value', () => {
    const out = html(request());
    expect(out).toMatch(/<button[^>]*>Cancel<\/button>/);
    expect(out).toMatch(/<button[^>]*type="submit"[^>]*disabled=""[^>]*>.*?Save<\/button>/);
    expect(out).not.toContain('Replace');
    expect(out).not.toContain('already saved');
  });

  it('says before Save that a value is already saved, and Save reads Replace', () => {
    const out = html(request({ exists: true }));
    expect(out).toContain('A value is already saved under STRIPE_TEST_KEY for this channel. Saving replaces it.');
    expect(out).toMatch(/type="submit"[^>]*>.*?Replace<\/button>/);
    expect(out).not.toContain('Confirm replace');
    // Only ever the field's own (empty) value: nothing about the old one.
    expect(count(out, '<input')).toBe(1);
  });

  it('gives the phone 44px targets', () => {
    expect(html(request(), true)).toContain('min-h-11');
    expect(html(request())).not.toContain('min-h-11');
  });
});

describe('the secret card, settled', () => {
  const fold = (r: Partial<ThreadSecretRequest>) => html(request(r));

  it('folds a saved secret to where it went and under what name, with no field or buttons', () => {
    const out = fold({ state: 'saved' });
    expect(out).toContain('Stripe test secret key');
    expect(out).toContain('Saved to this channel as STRIPE_TEST_KEY');
    expect(out).not.toContain('replacing');
    expect(out).not.toContain('<button');
    expect(out).not.toContain('<input');
    expect(out).not.toContain('Needs your input');
  });

  it('says when it replaced the old value, and for every channel', () => {
    expect(fold({ state: 'saved', replaced: true })).toContain('Saved to this channel as STRIPE_TEST_KEY, replacing the old value');
    expect(fold({ state: 'saved', ask: { ...ASK, scope: 'global' } })).toContain('Saved to every channel as STRIPE_TEST_KEY');
  });

  it('says cancelled and not entered', () => {
    const cancelledOut = fold({ state: 'cancelled' });
    expect(cancelledOut).toContain('Cancelled');
    expect(cancelledOut).not.toContain('<button');
    const dismissed = fold({ state: 'dismissed' });
    expect(dismissed).toContain('Not entered');
    expect(dismissed).toContain('Stripe test secret key');
    expect(dismissed).not.toContain('<input');
  });
});

describe('the secret card phases', () => {
  const sending = (p: Phase) => {
    if (p.at !== 'sending') throw new Error(`expected sending, got ${p.at}`);
    return p;
  };
  const typedIn = typed(START, DUMMY);

  it('sends on the first press when nothing is saved, without replacing', () => {
    expect(save(typedIn, false)).toEqual({ at: 'sending', value: DUMMY, replace: false });
  });

  it('asks once more before replacing a saved value, and the second press sends with replace', () => {
    const confirming = save(typedIn, true);
    expect(confirming).toEqual({ at: 'confirmReplace', value: DUMMY, error: null });
    expect(save(confirming, true)).toEqual({ at: 'sending', value: DUMMY, replace: true });
  });

  it('goes back to editing when Ben changes the value during the confirm step', () => {
    expect(typed(save(typedIn, true), `${DUMMY}x`)).toEqual({ at: 'editing', value: `${DUMMY}x`, error: null });
  });

  it('does nothing while a request is in flight', () => {
    const inFlight = sending(save(typedIn, false));
    expect(save(inFlight, false)).toBe(inFlight);
    expect(cancel(inFlight)).toBe(inFlight);
    expect(typed(inFlight, 'x')).toBe(inFlight);
  });

  it('leaves no value once saved, cancelled or settled from elsewhere', () => {
    for (const p of [saved(true), cancelled, refused(sending(save(typedIn, false)), 409, { error: 'x', state: 'saved' }, 'x')]) {
      expect(p.at).toBe('settled');
      expect(JSON.stringify(p)).not.toContain(DUMMY);
    }
    expect(saved(true)).toEqual({ at: 'settled', state: 'saved', replaced: true });
  });

  it('takes a 409 that a value exists into the confirm step, keeping the value for the second press', () => {
    const p = refused(sending(save(typedIn, false)), 409, { error: 'a value is saved', exists: true }, 'a value is saved');
    expect(p).toEqual({ at: 'confirmReplace', value: DUMMY, error: null });
  });

  it('waits for the stream when a 409 says it was settled elsewhere', () => {
    expect(refused(sending(save(typedIn, false)), 409, { error: 'already cancelled', state: 'cancelled' }, 'already cancelled')).toEqual({ at: 'settled', state: 'cancelled', replaced: false });
    expect(refused({ at: 'cancelling', value: DUMMY }, 409, { error: 'already saved', state: 'saved' }, 'already saved')).toMatchObject({ at: 'settled', state: 'saved' });
  });

  it('shows any other refusal as it came and keeps the value for another try', () => {
    expect(refused(sending(save(typedIn, false)), 409, { error: 'the thread runs on another machine' }, 'the thread runs on another machine')).toEqual({
      at: 'editing',
      value: DUMMY,
      error: 'the thread runs on another machine',
    });
    expect(refused(sending(save(typedIn, false)), 0, null, 'Cannot reach the Omni server. Is it running?')).toMatchObject({ at: 'editing', error: 'Cannot reach the Omni server. Is it running?' });
    // A failed replace goes back to the step it came from, not to a fresh first press.
    expect(refused(sending(save(save(typedIn, true), true)), 400, { error: 'bad' }, 'bad')).toEqual({ at: 'confirmReplace', value: DUMMY, error: 'bad' });
    expect(refused({ at: 'cancelling', value: DUMMY }, 500, null, 'Request failed (500)')).toEqual({ at: 'editing', value: DUMMY, error: 'Request failed (500)' });
  });
});

let id = 0;
const ev = (kind: string, payload: unknown): TranscriptEvent => ({ id: ++id, kind, payload: JSON.stringify(payload), created_at: `2026-11-04T10:00:${String(id).padStart(2, '0')}.000Z` });
const TOOL = 'mcp__omni-ask__request_secret';

function asked(settle: 'pending' | 'saved' | 'cancelled') {
  id = 0;
  return [
    ev('user', { text: 'Run the checkout tests' }),
    ev('tool_use', { id: 'r', name: 'Read', input: { file_path: '/w/app.ts' } }),
    ev('tool_result', { tool_use_id: 'r', text: 'ok', is_error: false, truncated: false }),
    ev('tool_use', { id: 'ask', name: TOOL, input: ASK }),
    ev('secret_request', { id: 's1', ask: ASK, exists: false }),
    ...(settle === 'pending'
      ? []
      : [
          ev('secret_request_answer', { id: 's1', state: settle, replaced: false, via: 'tool' }),
          ev('tool_result', { tool_use_id: 'ask', text: 'The user saved STRIPE_TEST_KEY as a secret for this channel.', is_error: false, truncated: false }),
          ev('tool_use', { id: 'e', name: 'Edit', input: { file_path: '/w/app.ts' } }),
          ev('assistant_text', { text: 'On it.' }),
        ]),
  ];
}

describe('the transcript fold', () => {
  it('puts the card where the secret was asked for and leaves out the tool call', () => {
    const { items } = buildItems(asked('saved'));
    expect(items.map((i) => i.type)).toEqual(['user', 'tools', 'secret', 'tools', 'text']);
    expect(items.filter((i) => i.type === 'tools').flatMap((t) => t.calls.map((c) => c.name))).toEqual(['Read', 'Edit']);
    expect(items.find((i) => i.type === 'secret')).toMatchObject({ r: { id: 's1', state: 'saved', ask: { name: 'STRIPE_TEST_KEY' } } });
  });

  it('knows when the thread waits on a secret', () => {
    expect(isAsking(asked('pending'))).toBe(true);
    expect(isAsking(asked('saved'))).toBe(false);
    expect(isAsking(asked('cancelled'))).toBe(false);
  });
});

describe('the phone thread', () => {
  it('lists the request in its turn, counts no step for it and is not busy while it waits', () => {
    const v = threadView({ events: asked('pending'), thread: { status: 'running', cwd: '/w', harness: 'claude-code' }, artifacts: [], children: [] });
    expect(v.turns).toHaveLength(1);
    expect(v.turns[0].secrets.map((r) => [r.id, r.state])).toEqual([['s1', 'pending']]);
    expect(v.turns[0].questions).toEqual([]);
    expect(v.turns[0].steps).toBe(1);
    expect(v.asking).toBe(true);
    expect(v.now).toBeNull();
  });
});

describe('secret requests from delegated threads', () => {
  const crew = (thread_id: string, task_id: string | null, thread_title: string, rid: string): CrewSecretRequest => ({ thread_id, thread_title, task_id, channel_id: 'shop', request: request({ id: rid }) });
  const list = (secrets?: CrewSecretRequest[], touch = false) => renderToStaticMarkup(createElement(CrewQuestionList, { items: [], secrets, touch }));

  it('shows each pending card under the thread and task that asked, linked to that thread', () => {
    const out = list([crew('child-1', 'T-AB12', 'Run the checkout tests', 'a'), crew('member-1', null, 'Write the copy', 'b')]);
    expect(out).toContain('T-AB12 · Run the checkout tests asks');
    expect(out).toContain('href="#/t/child-1"');
    expect(out).toContain('>Write the copy asks<');
    expect(count(out, 'type="password"')).toBe(2);
    expect(out).toContain('Needs your input');
  });

  it('reads a server that sends no secrets as none', () => {
    expect(list(undefined)).not.toContain('type="password"');
    expect(list([])).not.toContain('type="password"');
  });
});
