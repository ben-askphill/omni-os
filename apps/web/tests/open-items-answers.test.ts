// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { WIRE_FIXTURES } from '@omni/test-fixtures';
import { storeOpenItems, type OpenItem } from '@omni/shared/open-items.ts';
import type { Thread } from '../src/api.ts';
import { OpenItemsCard } from '../src/components/thread/OpenItemsCard.tsx';
import { readDisplay, takeDisplay } from '../src/display.ts';

// What Ben types on the card belongs to that set of items: it never comes back prefilled on a later turn's card.
const base = (JSON.parse(readFileSync(resolve(WIRE_FIXTURES, 'recent.json'), 'utf8')) as Thread[])[0];
const Q: OpenItem = { kind: 'question', text: 'Should the export include archived threads?' };
const B: OpenItem = { kind: 'blocker', text: 'Needs a login.' };

let root: Root;
let host: HTMLDivElement;
const render = (t: Partial<Thread>) =>
  act(() => root.render(createElement(OpenItemsCard, { thread: { ...base, status: 'done', ...t }, onThread: () => {}, onSpawn: () => {} })));
const field = (item: OpenItem) => host.querySelector<HTMLInputElement>(`input[aria-label="Answer: ${item.text}"]`);
const type = (item: OpenItem, text: string) =>
  act(() => {
    const input = field(item)!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });

beforeEach(() => {
  // Settings > Threads > Open items card, off by default.
  takeDisplay({ ...readDisplay(), openItems: true });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('OpenItemsCard answers', () => {
  it('starts empty when a later turn asks the same question after a reply from the composer', async () => {
    await render({ open_items: storeOpenItems([Q, B]) });
    await type(Q, 'No, active threads only');
    expect(field(Q)!.value).toBe('No, active threads only');

    // Ben replies in the main composer: the message clears the items and the turn runs.
    await render({ open_items: null, status: 'running' });
    expect(field(Q)).toBeNull();
    // The next turn asks the same question again.
    await render({ open_items: storeOpenItems([Q]) });
    expect(field(Q)!.value).toBe('');
  });

  it('starts empty when the items change straight to a new set with the same question in it', async () => {
    await render({ open_items: storeOpenItems([Q]) });
    await type(Q, 'Yes');
    await render({ open_items: storeOpenItems([Q, B]) });
    expect(field(Q)!.value).toBe('');
  });

  it('keeps what was typed on the other items when one is dismissed', async () => {
    await render({ open_items: storeOpenItems([Q, B]) });
    await type(Q, 'No, active threads only');
    await type(B, 'Signed in');
    await render({ open_items: storeOpenItems([Q]) });
    expect(field(Q)!.value).toBe('No, active threads only');
    expect(field(B)).toBeNull();
  });
});
