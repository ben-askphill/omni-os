// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { HandoffView, Takeover } from '@omni/shared/handoff.ts';
import type { HandoffAnswer } from '../src/components/thread/Handoff.tsx';
import { TakeoverNote } from '../src/components/thread/Takeover.tsx';

// The Take over note over the reply box (components/thread/Takeover.tsx), on the desktop and a phone: what it says
// about the Mac that holds the thread, when it offers Take over, and the confirm that posts /takeover.

const held = (over: Partial<Takeover> = {}): Takeover => ({
  from: { id: 'm-pro', name: "Ben's MacBook Pro" },
  to: { id: 'm-air', name: "Ben's MacBook Air" },
  running: true,
  refused: null,
  ...over,
});
const requested: HandoffView = {
  id: 'req-1',
  from: { id: 'm-pro', name: "Ben's MacBook Pro" },
  to: { id: 'm-air', name: "Ben's MacBook Air" },
  outgoing: false,
  at: '2026-10-28T12:00:00Z',
  state: { phase: 'requested', stale: false },
  leftBehind: null,
  idle: false,
  requested: true,
};
const answer = { thread: { id: 't1', status: 'running', updated_at: '2026-10-28T12:00:01Z' }, handoff: requested } as unknown as HandoffAnswer;

let root: Root;
let host: HTMLDivElement;
let posts: string[];
let refuse: string | null;
let changed: HandoffAnswer[];

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  posts = [];
  refuse = null;
  changed = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') posts.push(url);
      if (url === '/api/threads/t1/takeover') return refuse ? Response.json({ error: refuse }, { status: 409 }) : Response.json(answer);
      throw new Error(`Unexpected request: ${url}`);
    }),
  );
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const mount = (takeover: Takeover | null, handoff: HandoffView | null = null, mobile = false) =>
  act(async () => root.render(createElement(TakeoverNote, { threadId: 't1', takeover, handoff, mobile, onChanged: (a) => changed.push(a) })));
const note = () => host.querySelector<HTMLElement>('section[aria-label="Take over"]');
const byText = (text: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === text);
const dialog = () => host.querySelector<HTMLElement>('[role="dialog"]');

describe('the Take over note', () => {
  it('says where the thread runs, with a live dot and Take over', async () => {
    await mount(held());
    expect(note()!.textContent).toContain("This thread is running on Ben's MacBook Pro.");
    expect(note()!.querySelector('.glyph')!.getAttribute('data-s')).toBe('running');
    expect(byText('Take over')).toBeTruthy();
  });

  it('says where it last ran between turns, with a quiet dot', async () => {
    await mount(held({ running: false }));
    expect(note()!.textContent).toContain("Last ran on Ben's MacBook Pro.");
    expect(note()!.querySelector('.glyph')!.getAttribute('data-s')).toBe('idle');
    expect(byText('Take over')).toBeTruthy();
  });

  it('says why it cannot be taken over now, in place of the button, and is no alert', async () => {
    await mount(held({ refused: 'It has crew threads running.' }));
    expect(note()!.textContent).toContain('It has crew threads running.');
    expect(byText('Take over')).toBeUndefined();
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it('is not there when no other Mac holds the thread, or while the request is under way', async () => {
    await mount(null);
    expect(host.innerHTML).toBe('');
    await mount(held(), requested);
    expect(host.innerHTML).toBe('');
  });
});

describe('the desktop confirm', () => {
  it('asks in takeoverConfirm words, posts /takeover and hands the answer on', async () => {
    await mount(held());
    await act(async () => byText('Take over')!.click());
    expect(dialog()!.textContent).toContain("Take over from Ben's MacBook Pro?");
    expect(dialog()!.textContent).toContain("Ben's MacBook Pro stops the current turn and hands the thread here.");
    expect(posts).toEqual([]);
    await act(async () => [...dialog()!.querySelectorAll('button')].find((b) => b.textContent === 'Take over')!.click());
    expect(posts).toEqual(['/api/threads/t1/takeover']);
    expect(changed).toEqual([answer]);
    expect(dialog()).toBeNull();
  });

  it('keeps a refusal in the dialog, and Cancel posts nothing', async () => {
    refuse = 'This thread has crew threads running.';
    await mount(held({ running: false }));
    await act(async () => byText('Take over')!.click());
    expect(dialog()!.textContent).toContain('Your next message runs on Ben\'s MacBook Air.');
    await act(async () => [...dialog()!.querySelectorAll('button')].find((b) => b.textContent === 'Take over')!.click());
    expect(dialog()!.querySelector('[role="alert"]')!.textContent).toContain('This thread has crew threads running.');
    expect(changed).toEqual([]);
    await act(async () => byText('Cancel')!.click());
    expect(dialog()).toBeNull();
    expect(posts).toEqual(['/api/threads/t1/takeover']);
  });
});

describe('the phone sheet', () => {
  const slide = () => host.querySelector<HTMLButtonElement>(`button[aria-label="Slide to run on Ben's MacBook Air"]`);
  const enter = () => act(async () => void slide()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));

  it('asks with a slider named for this Mac, and posts once slid', async () => {
    await mount(held(), null, true);
    await act(async () => byText('Take over')!.click());
    expect(dialog()!.getAttribute('aria-label')).toBe('Take over');
    expect(dialog()!.textContent).toContain('The agent continues on Ben\'s MacBook Air where it was cut off.');
    await enter();
    expect(posts).toEqual(['/api/threads/t1/takeover']);
    expect(changed).toEqual([answer]);
    expect(dialog()).toBeNull();
  });

  it('shows a refusal in the sheet and lets the slider go again', async () => {
    refuse = 'This thread has crew threads running.';
    await mount(held(), null, true);
    await act(async () => byText('Take over')!.click());
    await enter();
    expect(dialog()!.querySelector('[role="alert"]')!.textContent).toContain('This thread has crew threads running.');
    expect(slide()!.disabled).toBe(false);
  });
});
