// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Channel, PRDetail as PRDetailT } from '../src/api.ts';

// The PR page keeps its header to the title, one meta line and one line of thread links, the merge card to one block
// above the tabs, and Files and Diff in one Changes tab, so the description starts on the first screen.

const diff = ['a.ts', 'b.ts', 'c.ts']
  .map((f) => `diff --git a/${f} b/${f}\n--- a/${f}\n+++ b/${f}\n@@ -1,1 +1,1 @@\n-old\n+new\n`)
  .join('');

const base = {
  number: 771,
  title: 'Remove the TypeScript twins',
  url: 'https://github.com/acme/shop/pull/771',
  state: 'OPEN',
  isDraft: false,
  author: { login: 'ben' },
  headRefName: 'omni/cecd75d2',
  baseRefName: 'main',
  additions: 3,
  deletions: 3,
  mergeable: 'MERGEABLE',
  reviewDecision: null,
  checks: { passed: 0, failed: 0, pending: 0 },
  checkRuns: [],
  body: 'The description.',
  reviews: [],
  comments: [],
  // gh's file list stops at 100; the diff can hold more.
  files: [{ path: 'a.ts', additions: 1, deletions: 1 }],
  diff,
  autoMergeRequest: null,
  thread: { id: 't-child', title: 'Remove TS twins', channel_id: 'shop', parent: { id: 't-parent', title: 'Rust rewrite' } },
} as unknown as PRDetailT;

let pr: PRDetailT = base;
let posts: { path: string; body: unknown }[] = [];
let postFails: string | null = null;
// The phone layout takes over below DESKTOP_QUERY (store.tsx); each test picks a side.
let phone = false;

vi.mock('../src/api.ts', async (importActual) => {
  const actual = await importActual<typeof import('../src/api.ts')>();
  actual.api.get = vi.fn(async () => pr) as typeof actual.api.get;
  actual.api.post = vi.fn(async (path: string, body: unknown) => {
    posts.push({ path, body });
    if (postFails) throw new Error(postFails);
    return { ok: true, output: 'Squashed and merged #771' };
  }) as typeof actual.api.post;
  return actual;
});

const { PRDetail } = await import('../src/pages/PRs.tsx');

const channel = { id: 'shop', name: 'Acme Shop', github_repo: 'acme/shop' } as Channel;

let root: Root;
let host: HTMLDivElement;

async function show(p: PRDetailT) {
  pr = p;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(createElement(PRDetail, { channel, n: 771 })));
  await act(async () => {});
}

const merge = () => host.querySelector('section[aria-label="Merge"]')!;
const mergeButton = () => [...merge().querySelectorAll<HTMLButtonElement>('button:not([aria-label])')].find((b) => /^(Squash and merge|Merge commit|Rebase and merge)$/.test(b.textContent ?? ''));
const tab = (name: string) => [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((t) => t.textContent?.startsWith(name));

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  posts = [];
  postFails = null;
  phone = false;
  const real = window.matchMedia.bind(window);
  vi.stubGlobal('matchMedia', (q: string) => (q === '(min-width: 768px)' ? { ...real(q), matches: !phone, addEventListener() {}, removeEventListener() {} } : real(q)));
  location.hash = '#/c/shop/prs/771';
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it('puts the actions on the back link row, above the title', async () => {
  await show(base);
  const row = host.querySelector('a[href="#/c/shop/prs"]')!.parentElement!;
  expect(row.textContent).toContain('GitHub');
  expect(row.textContent).toContain('Ask builder to review');
  expect(row.compareDocumentPosition(host.querySelector('h2')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it('links the parent thread, then the thread that opened the PR, on one line', async () => {
  await show(base);
  const links = [...host.querySelectorAll('nav[aria-label="Threads"] a')];
  expect(links.map((a) => a.getAttribute('href'))).toEqual(['#/t/t-parent', '#/t/t-child']);
  expect(links.map((a) => a.textContent)).toEqual(['Rust rewrite', 'Remove TS twins']);
});

it('keeps method, delete branch and auto-merge on the merge card, with a merge button and a one-line note', async () => {
  await show(base);
  const card = merge();
  expect(card.querySelector('button[aria-label^="Merge method"]')).not.toBeNull();
  expect(card.querySelector('[role="switch"]')?.getAttribute('aria-label')).toBe('Delete branch after merge');
  expect(card.querySelector('[aria-label="Auto-merge"]')?.textContent).toContain('Turn on auto-merge');
  // The desktop shell gets a plain button named for the method; a mouse drag on the slide often never registered.
  expect(mergeButton()?.textContent).toBe('Squash and merge');
  expect(card.querySelector('.sld')).toBeNull();
  expect(card.querySelector('p')?.textContent).toBe('Runs gh pr merge, then deletes the branch. Can’t be undone from here.');
  expect(card.textContent).not.toContain('Rerun failed checks');
});

it('merges from the button with the method and delete-branch, then shows what gh said', async () => {
  await show(base);
  await act(async () => mergeButton()!.click());
  expect(posts).toEqual([{ path: '/channels/shop/prs/771/merge', body: { method: 'squash', delete_branch: true, confirm: true } }]);
  expect(merge()).toBeNull();
  expect(host.textContent).toContain('Squashed and merged #771');
});

it('keeps the card and shows the error when the merge fails', async () => {
  postFails = 'Pull request is not mergeable';
  await show(base);
  await act(async () => mergeButton()!.click());
  expect(merge()).not.toBeNull();
  expect(merge().textContent).toContain('Pull request is not mergeable');
  expect(mergeButton()?.textContent).toBe('Squash and merge');
});

it('keeps the slide on the phone layout, which shows this card on its channel PR screen', async () => {
  phone = true;
  await show(base);
  const slide = merge().querySelector('button[aria-label="Slide to squash and merge"]');
  expect(slide).not.toBeNull();
  // A control's width, not the card's, and it shrinks on a phone.
  expect(slide!.closest('.sld')?.className).toMatch(/\bw-full\b.*\bmax-w-\[20rem\]/);
  expect(mergeButton()).toBeUndefined();
});

it('says what auto-merge does under the slide while it is on', async () => {
  await show({ ...base, autoMergeRequest: { mergeMethod: 'SQUASH', enabledBy: { login: 'ben' } } } as PRDetailT);
  expect(merge().querySelector('[aria-label="Auto-merge"]')?.textContent).toContain('Auto-merge is on');
  expect(merge().querySelector('p')?.textContent).toContain('Auto-merge: squashes once checks and reviews pass. Turned on by ben.');
});

it('offers Rerun failed checks beside what blocks the merge', async () => {
  const failing = [{ name: 'check', state: 'FAILURE', url: 'https://github.com/acme/shop/actions/runs/9/job/1' }];
  await show({ ...base, mergeable: 'CONFLICTING', checkRuns: failing, checks: { passed: 0, failed: 1, pending: 0 } } as PRDetailT);
  const text = merge().textContent ?? '';
  expect(text).toContain('Has conflicts');
  expect(text).toContain('1 check failing');
  expect(text).toContain('Rerun failed checks');
  const blocked = [...merge().querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Resolve conflicts first');
  expect(blocked?.disabled).toBe(true);
});

it('shows Conversation, Checks and Changes, counting the files in the diff', async () => {
  await show(base);
  expect([...host.querySelectorAll('[role="tab"]')].map((t) => t.firstChild?.textContent)).toEqual(['Conversation', 'Checks', 'Changes']);
  expect(tab('Changes')?.textContent).toBe('Changes3');
  await act(async () => tab('Changes')!.click());
  const files = [...host.querySelectorAll('button[aria-expanded]')].map((b) => b.textContent?.match(/^[a-c]\.ts/)?.[0]).filter(Boolean);
  expect(files).toEqual(['a.ts', 'b.ts', 'c.ts']);
});

it('lists the changed files when gh could not load the diff', async () => {
  await show({ ...base, diff: 'Could not load diff: HTTP 406' } as PRDetailT);
  expect(tab('Changes')?.textContent).toBe('Changes1');
  await act(async () => tab('Changes')!.click());
  expect(host.textContent).toContain('Could not load diff: HTTP 406');
  expect(host.textContent).toContain('a.ts');
});

it('lists the files a truncated diff left out, and counts them in the badge', async () => {
  // The server cuts a diff at 400,000 characters (github.ts getPR); a big first file can push later ones out.
  const cut = `diff --git a/big.ts b/big.ts\n--- a/big.ts\n+++ b/big.ts\n@@ -1,1 +1,1 @@\n-old\n+new\n... diff truncated ...`;
  const files = [
    { path: 'big.ts', additions: 1, deletions: 1 },
    { path: 'later.ts', additions: 4, deletions: 2 },
  ];
  await show({ ...base, diff: cut, files } as PRDetailT);
  expect(tab('Changes')?.textContent).toBe('Changes2');
  await act(async () => tab('Changes')!.click());
  expect(host.querySelector('button[aria-expanded]:not([aria-label])')?.textContent).toContain('big.ts');
  expect(host.querySelector('[role="note"]')?.textContent).toContain('Diff truncated');
  const rest = host.querySelector('[role="note"]')!.parentElement!.textContent;
  expect(rest).toContain('later.ts');
  expect(rest).toContain('+4');
  expect(rest).not.toContain('big.ts');
});

it('lists files missing from a diff that holds fewer files than the list', async () => {
  const files = ['a.ts', 'b.ts', 'c.ts', 'd.ts'].map((path) => ({ path, additions: 1, deletions: 1 }));
  await show({ ...base, files } as PRDetailT);
  expect(tab('Changes')?.textContent).toBe('Changes4');
  await act(async () => tab('Changes')!.click());
  expect(host.querySelector('[role="note"]')?.textContent).toContain('Not in the loaded diff: 1 file.');
  expect(host.querySelector('[role="note"]')!.parentElement!.textContent).toContain('d.ts');
});

it('adds no list when the diff holds every file', async () => {
  await show(base);
  await act(async () => tab('Changes')!.click());
  expect(host.querySelector('[role="note"]')).toBeNull();
});
