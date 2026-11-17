// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { CrewPR } from '../src/api.ts';

// The Details panel's Merge on a PR's row: it only opens a confirm under the row, Cancel takes the focus, Escape closes
// it, and only Squash and merge runs gh, with the same squash and delete-branch as before. A refusal stays in the confirm.

const posts: { path: string; body: unknown }[] = [];
let refuse: string | null = null;

vi.mock('../src/api.ts', async (importActual) => {
  const actual = await importActual<typeof import('../src/api.ts')>();
  actual.api.post = vi.fn(async (path: string, body: unknown) => {
    posts.push({ path, body });
    if (refuse) throw new Error(refuse);
    return { ok: true };
  }) as typeof actual.api.post;
  return actual;
});

import { CrewGlance } from '../src/components/thread/panel/GlanceCard.tsx';

const crewPR = (over: Partial<CrewPR> = {}): CrewPR => ({
  number: 771,
  title: 'Remove the TypeScript twins',
  state: 'OPEN',
  isDraft: false,
  url: 'https://github.com/o/r/pull/771',
  repo: 'o/r',
  thread_id: 'c1',
  thread_title: 'Twins',
  channel_id: 'omni',
  task_id: null,
  mergeable: 'MERGEABLE',
  reviewDecision: null,
  checks: { passed: 3, failed: 0, pending: 0 },
  ...over,
});

let root: Root;
let host: HTMLDivElement;
let merged = 0;
let tabs: string[] = [];

const $ = (sel: string) => host.querySelector<HTMLElement>(sel);
const button = (text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) ?? null;
const click = (el: HTMLElement | null) => act(async () => void el!.click());
const key = (el: HTMLElement | null, k: string) => act(async () => void el!.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })));

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  posts.length = 0;
  refuse = null;
  merged = 0;
  tabs = [];
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  const crew = [crewPR(), crewPR({ number: 772, url: 'u772', title: 'Deferred sync', checks: { passed: 1, failed: 1, pending: 0 } })];
  await act(async () => root.render(createElement(CrewGlance, { crew, onMerged: () => void merged++, onTab: (t: string) => void tabs.push(t) })));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('Merge on a delegated PR row', () => {
  it('opens a confirm under its row, with Cancel focused, and merges nothing yet', async () => {
    expect($('[aria-label="Merge #772"]')).toBeNull();
    const trigger = $('[aria-label="Merge #771"]');
    expect(trigger?.getAttribute('aria-expanded')).toBe('false');
    await click(trigger);
    expect(trigger?.getAttribute('aria-expanded')).toBe('true');
    const confirm = $('[role="group"][aria-label="Merge #771"]');
    expect(confirm?.id).toBe(trigger?.getAttribute('aria-controls'));
    expect(confirm?.textContent).toContain('Squash-merges #771, then deletes its branch. Can’t be undone from here.');
    expect(document.activeElement?.textContent).toBe('Cancel');
    // The row and its Merge are siblings: pressing Merge does not open the PRs tab.
    expect(tabs).toEqual([]);
    expect(posts).toEqual([]);
  });

  it('closes on Escape or Cancel and gives the focus back to Merge', async () => {
    await click($('[aria-label="Merge #771"]'));
    await key($('[role="group"]'), 'Escape');
    expect($('[role="group"]')).toBeNull();
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Merge #771');
    await click($('[aria-label="Merge #771"]'));
    await click(button('Cancel'));
    expect($('[role="group"]')).toBeNull();
    expect(posts).toEqual([]);
  });

  it('squash-merges and deletes the branch from Squash and merge, then reads the PRs again', async () => {
    await click($('[aria-label="Merge #771"]'));
    await click(button('Squash and merge'));
    expect(posts).toEqual([{ path: '/channels/omni/prs/771/merge', body: { method: 'squash', delete_branch: true, confirm: true } }]);
    expect(merged).toBe(1);
    expect($('[role="group"]')).toBeNull();
  });

  it("keeps gh's refusal in the confirm, so it can be read and tried again", async () => {
    refuse = 'Pull request is not mergeable: the base branch policy prohibits the merge.';
    await click($('[aria-label="Merge #771"]'));
    await click(button('Squash and merge'));
    expect($('[role="group"] [role="alert"]')?.textContent).toContain('the base branch policy prohibits the merge');
    expect(merged).toBe(0);
    refuse = null;
    await click(button('Squash and merge'));
    expect(posts).toHaveLength(2);
    expect(merged).toBe(1);
  });
});
