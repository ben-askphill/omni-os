import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WIRE_FIXTURES } from '@omni/test-fixtures';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { storeOpenItems } from '@omni/shared/open-items.ts';
import type { Thread } from '../src/api.ts';
import { OpenItemsCard } from '../src/components/thread/OpenItemsCard.tsx';
import { readDisplay, takeDisplay } from '../src/display.ts';

const base = (JSON.parse(readFileSync(resolve(WIRE_FIXTURES, 'recent.json'), 'utf8')) as Thread[])[0];
const OPEN = storeOpenItems([
  { kind: 'question', text: 'Should the export include archived threads?' },
  { kind: 'decision', text: 'Store the cache in SQLite or in Postgres?', options: ['SQLite', 'Postgres'] },
  { kind: 'blocker', text: 'The APNs key is missing from the secret store.' },
]);
const render = (t: Partial<Thread>, mobile = false) =>
  renderToStaticMarkup(createElement(OpenItemsCard, { thread: { ...base, status: 'done', ...t }, onThread: () => {}, onSpawn: () => {}, mobile }));

describe('OpenItemsCard with the setting off', () => {
  it('is off by default and shows nothing for a turn that left items open', () => {
    expect(readDisplay().openItems).toBe(false);
    expect(render({ open_items: OPEN })).toBe('');
  });
});

describe('OpenItemsCard', () => {
  beforeAll(() => takeDisplay({ ...readDisplay(), openItems: true }));
  afterAll(() => takeDisplay({ ...readDisplay(), openItems: false }));

  it('lists what a finished turn left open, each with an answer, a new thread and a dismiss', () => {
    const html = render({ open_items: OPEN });
    expect(html).toContain('aria-label="Open items"');
    expect(html).toContain('3 open items before this thread is done');
    for (const label of ['Question', 'Decision', 'Blocker']) expect(html).toContain(`>${label}<`);
    expect(html).toContain('Store the cache in SQLite or in Postgres?');
    // A decision's options are one tap each.
    expect(html).toMatch(/aria-pressed="false"[^>]*>SQLite</);
    expect(html).toMatch(/aria-pressed="false"[^>]*>Postgres</);
    expect(html.match(/aria-label="New thread for this"/g)).toHaveLength(3);
    expect(html.match(/aria-label="Dismiss"/g)).toHaveLength(3);
    expect(html.match(/aria-label="Answer: /g)).toHaveLength(3);
    expect(html).toContain('aria-label="Dismiss all"');
    // Nothing to send until something is answered.
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*Send answers<\/button>/);
  });

  it('says one open item in the singular', () => {
    expect(render({ open_items: storeOpenItems([{ kind: 'blocker', text: 'Needs a login.' }]) })).toContain('Open item before this thread is done');
  });

  it('shows nothing for a clean thread, a bad row or a turn still going', () => {
    expect(render({ open_items: null })).toBe('');
    expect(render({ open_items: '{not json' })).toBe('');
    expect(render({ open_items: OPEN, status: 'running' })).toBe('');
  });

  it('uses the 16px input size on the phone, so focusing a field does not zoom', () => {
    expect(render({ open_items: OPEN }, true)).toContain('!text-[length:var(--fs-input)]');
    expect(render({ open_items: OPEN })).not.toContain('--fs-input');
  });
});
