// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { SecretAsk, ThreadSecretRequest } from '@omni/shared/secret-request.ts';

// Ben types a secret into the card and presses Save: what goes to the server, which step the card takes on each answer,
// and that no value is left on the page once it is saved. The value here is a made-up string.

const calls = vi.hoisted(() => [] as { path: string; body: unknown }[]);
const answers = vi.hoisted(() => [] as (() => unknown)[]);

vi.mock('../src/api.ts', async (importActual) => {
  const actual = await importActual<typeof import('../src/api.ts')>();
  actual.api.post = vi.fn(async (path: string, body?: unknown) => {
    calls.push({ path, body });
    const next = answers.shift();
    if (!next) throw new Error('unexpected request');
    return next();
  }) as typeof actual.api.post;
  return actual;
});

import { ApiError } from '../src/api.ts';
import { SecretRequestCard } from '../src/components/thread/SecretRequestCard.tsx';

const DUMMY = 'sk_test_not_a_real_key_0000';
const ASK: SecretAsk = { name: 'STRIPE_TEST_KEY', label: 'Stripe test secret key', scope: 'channel', reason: null };
const SUBMIT = '/threads/t/secret-requests/s1/submit';
const CANCEL = '/threads/t/secret-requests/s1/cancel';

let root: Root;
let host: HTMLDivElement;

const mount = (exists: boolean) => {
  const r: ThreadSecretRequest = { id: 's1', event_id: 4, ask: ASK, exists, state: 'pending', replaced: false };
  return act(async () => root.render(createElement(SecretRequestCard, { threadId: 't', r })));
};
const field = () => host.querySelector('input') as HTMLInputElement;
const button = (label: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === label) as HTMLButtonElement;
const type = (value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field(), value);
    field().dispatchEvent(new Event('input', { bubbles: true }));
  });
const press = (label: string) => act(async () => button(label).click());
const ok = (body: unknown) => answers.push(() => body);
const refuse = (status: number, body: Record<string, unknown>) =>
  answers.push(() => {
    throw new ApiError(String(body.error), status, body);
  });

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  calls.length = 0;
  answers.length = 0;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe('saving a secret', () => {
  it('sends the typed value once, then folds to where it went with no value left on the page', async () => {
    await mount(false);
    await type(DUMMY);
    ok({ state: 'saved', replaced: false });
    await press('Save');
    expect(calls).toEqual([{ path: SUBMIT, body: { value: DUMMY, replace: false } }]);
    expect(host.textContent).toContain('Saved to this channel as STRIPE_TEST_KEY');
    expect(host.querySelector('input')).toBeNull();
    expect(host.querySelector('button')).toBeNull();
    expect(host.innerHTML).not.toContain(DUMMY);
  });

  it('sends nothing while the field is empty', async () => {
    await mount(false);
    expect(button('Save').disabled).toBe(true);
    await press('Save');
    expect(calls).toEqual([]);
  });

  it('sends on Enter', async () => {
    await mount(false);
    await type(DUMMY);
    ok({ state: 'saved', replaced: false });
    await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(calls.map((c) => c.path)).toEqual([SUBMIT]);
  });

  it('asks once more before it replaces a saved value, then sends with replace', async () => {
    await mount(true);
    expect(host.textContent).toContain('A value is already saved under STRIPE_TEST_KEY for this channel. Saving replaces it.');
    await type(DUMMY);
    await press('Replace');
    expect(calls).toEqual([]);
    expect(host.textContent).toContain('This overwrites the value saved under STRIPE_TEST_KEY for this channel.');
    expect(field().value).toBe(DUMMY);
    ok({ state: 'saved', replaced: true });
    await press('Confirm replace');
    expect(calls).toEqual([{ path: SUBMIT, body: { value: DUMMY, replace: true } }]);
    expect(host.textContent).toContain('Saved to this channel as STRIPE_TEST_KEY, replacing the old value');
  });

  it('takes the replace step when the server finds a value there that the agent did not see', async () => {
    await mount(false);
    await type(DUMMY);
    refuse(409, { error: 'a secret named STRIPE_TEST_KEY is already set', exists: true });
    await press('Save');
    expect(host.textContent).toContain('This overwrites the value saved under STRIPE_TEST_KEY');
    expect(field().value).toBe(DUMMY);
    ok({ state: 'saved', replaced: true });
    await press('Confirm replace');
    expect(calls.map((c) => c.body)).toEqual([
      { value: DUMMY, replace: false },
      { value: DUMMY, replace: true },
    ]);
  });

  it('folds to what the other device did when the request was settled there', async () => {
    await mount(false);
    await type(DUMMY);
    refuse(409, { error: 'already cancelled', state: 'cancelled' });
    await press('Save');
    expect(host.textContent).toContain('Cancelled');
    expect(host.querySelector('input')).toBeNull();
    expect(host.innerHTML).not.toContain(DUMMY);
  });

  it('shows the server message and keeps the value for another try when it is refused', async () => {
    await mount(false);
    await type(DUMMY);
    refuse(409, { error: 'The thread runs on another machine.' });
    await press('Save');
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('The thread runs on another machine.');
    expect(field().value).toBe(DUMMY);
    ok({ state: 'saved', replaced: false });
    await press('Save');
    expect(calls).toHaveLength(2);
    expect(host.textContent).toContain('Saved to this channel as STRIPE_TEST_KEY');
  });
});

describe('cancelling a request', () => {
  it('posts the cancel, sends no value and folds to Cancelled', async () => {
    await mount(false);
    await type(DUMMY);
    ok({ state: 'cancelled' });
    await press('Cancel');
    expect(calls.map((c) => c.path)).toEqual([CANCEL]);
    expect(JSON.stringify(calls)).not.toContain(DUMMY);
    expect(host.textContent).toContain('Cancelled');
    expect(host.innerHTML).not.toContain(DUMMY);
  });
});
