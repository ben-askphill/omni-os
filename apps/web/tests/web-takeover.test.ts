// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Device, HandoffView, Takeover } from '@omni/shared/handoff.ts';
import type { Thread } from '../src/api.ts';
import type { HandoffAnswer } from '../src/components/thread/Handoff.tsx';
import { ThreadMachineChip } from '../src/components/composer/MachineChip.tsx';
import { TakeoverConfirm } from '../src/components/thread/Takeover.tsx';

// The Machine chip on an open thread (components/composer/MachineChip.tsx): the machine that holds it, Hand off to the
// others from this Mac, Take over from the Mac that holds it (with the confirm that posts /takeover, on the desktop
// and a phone), and nothing at all with one machine.

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
const pro: Device = { id: 'm-pro', name: "Ben's MacBook Pro", reachability: 'online', dnsName: 'pro.tail.ts.net', lastSeen: null };
const answer = { thread: { id: 't1', status: 'running', updated_at: '2026-10-28T12:00:01Z' }, handoff: requested } as unknown as HandoffAnswer;
const thread = (status = 'running') => ({ id: 't1', status, title: 'A thread' }) as Thread;

let root: Root;
let host: HTMLDivElement;
let posts: string[];
let refuse: string | null;
let changed: HandoffAnswer[];
let errors: (string | null)[];
let devices: Device[];

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  posts = [];
  refuse = null;
  changed = [];
  errors = [];
  devices = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') posts.push(url);
      if (url === '/api/threads/t1/takeover') return refuse ? Response.json({ error: refuse }, { status: 409 }) : Response.json(answer);
      if (url === '/api/threads/t1/handoff') return Response.json(answer);
      if (url === '/api/sync/status') return Response.json({ configured: true, enabled: true, signedOut: false });
      if (url === '/api/devices') return Response.json(devices);
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

const mount = (takeover: Takeover | null, handoff: HandoffView | null = null, status = 'running') =>
  act(async () =>
    root.render(createElement(ThreadMachineChip, { thread: thread(status), held: { blocked: null, handoff, takeover, onChanged: (a) => changed.push(a) }, onError: (e) => errors.push(e) })),
  );
/** Until the sync status and the device list have come. */
const settle = () => act(async () => new Promise((r) => setTimeout(r, 20)));
const chip = () => host.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]');
const open = () => act(async () => chip()!.click());
const options = () => [...host.querySelectorAll<HTMLButtonElement>('[role="option"]')];
const option = (label: string) => options().find((o) => o.textContent?.startsWith(label));
const dialog = () => host.querySelector<HTMLElement>('[role="dialog"]');

describe('the Machine chip on a thread another Mac holds', () => {
  it('names that Mac, selected, with This Mac as Take over', async () => {
    await mount(held());
    expect(chip()!.getAttribute('aria-label')).toBe("Run on: Ben's MacBook Pro");
    expect(chip()!.closest('span[title]')!.getAttribute('title')).toBe("This thread is running on Ben's MacBook Pro.");
    await open();
    expect(options().map((o) => [o.textContent, o.getAttribute('aria-selected'), o.disabled])).toEqual([
      ["Ben's MacBook ProRunning there now", 'true', false],
      ['This MacTake over: stops there, continues here', 'false', false],
    ]);
  });

  it('says it last ran there between turns', async () => {
    await mount(held({ running: false }), null, 'done');
    expect(chip()!.closest('span[title]')!.getAttribute('title')).toBe("Last ran on Ben's MacBook Pro.");
    await open();
    expect(option('This Mac')!.textContent).toContain('Take over: next message runs here');
  });

  it('disables This Mac with why when it cannot be taken over now', async () => {
    await mount(held({ refused: 'It has crew threads running.' }));
    await open();
    expect(option('This Mac')!.disabled).toBe(true);
    expect(option('This Mac')!.textContent).toContain('It has crew threads running.');
  });

  it('is not there while the request is under way: the handoff card says so', async () => {
    await mount(held(), requested);
    expect(host.innerHTML).toBe('');
  });

  it('asks in takeoverConfirm words, posts /takeover and hands the answer on', async () => {
    await mount(held());
    await open();
    await act(async () => option('This Mac')!.click());
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
    await mount(held({ running: false }), null, 'done');
    await open();
    await act(async () => option('This Mac')!.click());
    expect(dialog()!.textContent).toContain("Your next message runs on Ben's MacBook Air.");
    await act(async () => [...dialog()!.querySelectorAll('button')].find((b) => b.textContent === 'Take over')!.click());
    expect(dialog()!.querySelector('[role="alert"]')!.textContent).toContain('This thread has crew threads running.');
    expect(changed).toEqual([]);
    await act(async () => [...dialog()!.querySelectorAll('button')].find((b) => b.textContent === 'Cancel')!.click());
    expect(dialog()).toBeNull();
    expect(posts).toEqual(['/api/threads/t1/takeover']);
  });
});

describe('the Machine chip on a thread this Mac holds', () => {
  it('reads This Mac and hands the thread to the Mac picked', async () => {
    devices = [pro];
    await mount(null);
    await settle();
    expect(chip()!.getAttribute('aria-label')).toBe('Run on: This Mac');
    await open();
    expect(options().map((o) => o.textContent)).toEqual(['This MacRunning here now', "Ben's MacBook ProHand off: Online on Tailscale"]);
    await act(async () => option("Ben's MacBook Pro")!.click());
    expect(posts).toEqual(['/api/threads/t1/handoff']);
    expect(changed).toEqual([answer]);
    expect(errors).toEqual([null]);
  });

  it('is hidden with one machine', async () => {
    await mount(null);
    await settle();
    expect(host.innerHTML).toBe('');
  });
});

describe('the phone sheet', () => {
  const mountSheet = () =>
    act(async () => root.render(createElement(TakeoverConfirm, { threadId: 't1', takeover: held(), mobile: true, onClose: () => {}, onChanged: (a) => changed.push(a) })));
  const slide = () => host.querySelector<HTMLButtonElement>(`button[aria-label="Slide to run on Ben's MacBook Air"]`);
  const enter = () => act(async () => void slide()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));

  it('asks with a slider named for this Mac, and posts once slid', async () => {
    await mountSheet();
    expect(dialog()!.getAttribute('aria-label')).toBe('Take over');
    expect(dialog()!.textContent).toContain("The agent continues on Ben's MacBook Air where it was cut off.");
    await enter();
    expect(posts).toEqual(['/api/threads/t1/takeover']);
    expect(changed).toEqual([answer]);
  });

  it('shows a refusal in the sheet and lets the slider go again', async () => {
    refuse = 'This thread has crew threads running.';
    await mountSheet();
    await enter();
    expect(dialog()!.querySelector('[role="alert"]')!.textContent).toContain('This thread has crew threads running.');
    expect(slide()!.disabled).toBe(false);
  });
});
