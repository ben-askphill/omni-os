// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// PRD #667 (1.2): no GET starts a process. The Web UI opens a thread's shell and the channel browser with a POST, and
// only then attaches to their streams, which no longer start anything.

const calls: string[] = [];
let shellOpen = false;
let startStatus = 200;
let startGate: Promise<void> | null = null;
vi.mock('../src/api.ts', async (importActual) => {
  const actual = await importActual<typeof import('../src/api.ts')>();
  actual.api.get = vi.fn(async (path: string) => {
    calls.push(`GET ${path}`);
    return { open: shellOpen };
  }) as typeof actual.api.get;
  actual.api.post = vi.fn(async (path: string) => {
    calls.push(`POST ${path}`);
    if (path.endsWith('/browser/start') && startGate) await startGate;
    if (path.endsWith('/browser/start') && startStatus !== 200) throw new actual.ApiError('nope', startStatus);
    return { running: true };
  }) as typeof actual.api.post;
  return {
    ...actual,
    openSSE: vi.fn((url: () => string) => {
      calls.push(`STREAM ${url()}`);
      return { close: () => {} };
    }),
  };
});

import { attachInteractive, attachReadOnly, ensureShell } from '../src/components/terminal-session.ts';
import { useChannelBrowser } from '../src/components/LiveBrowser.tsx';

const flush = () => act(async () => {});
const fakeTerm = () =>
  ({
    cols: 100,
    rows: 30,
    onData: () => ({ dispose() {} }),
    onResize: () => ({ dispose() {} }),
    focus() {},
    write() {},
    reset() {},
    resize() {},
    dispose() {},
  }) as never;
const sink = () => ({ setState: vi.fn(), setError: vi.fn() });

beforeEach(() => {
  calls.length = 0;
  shellOpen = false;
  startStatus = 200;
  startGate = null;
});

describe('the thread shell', () => {
  it('POSTs to open a shell that is not there, then attaches', async () => {
    const stop = attachInteractive(fakeTerm(), { fit() {} } as never, document.createElement('div'), '/threads/t1/terminal', sink());
    await flush();
    expect(calls).toEqual(['GET /threads/t1/terminal', 'POST /threads/t1/terminal', 'STREAM /api/threads/t1/terminal/stream?cols=100&rows=30']);
    stop();
  });

  it('leaves an open shell alone, exited or not, and just attaches', async () => {
    shellOpen = true;
    await ensureShell('/threads/t1/terminal', { cols: 80, rows: 24 });
    expect(calls).toEqual(['GET /threads/t1/terminal']);
  });

  it('never starts a shell from the phone, which only watches', async () => {
    const s = sink();
    const stop = attachReadOnly(fakeTerm(), '/threads/t1/terminal', s);
    await flush();
    expect(calls.some((c) => c.startsWith('POST'))).toBe(false);
    expect(s.setError).toHaveBeenCalledWith(expect.stringContaining('No shell is running'));
    stop();
  });
});

describe('the channel browser', () => {
  function Probe({ id }: { id: string }) {
    useChannelBrowser(id);
    return null;
  }
  const mount = async () => {
    const root = createRoot(document.createElement('div'));
    await act(async () => root.render(createElement(Probe, { id: 'omni' })));
    await flush();
    return root;
  };

  it('starts Chrome with a POST and attaches to the stream', async () => {
    const root = await mount();
    expect(calls).toContain('POST /channels/omni/browser/start');
    expect(calls).toContain('STREAM /api/channels/omni/browser/stream');
    act(() => root.unmount());
  });

  it('attaches only once the start POST has answered', async () => {
    let release!: () => void;
    startGate = new Promise<void>((resolve) => (release = resolve));
    const root = await mount();
    expect(calls).toEqual(['POST /channels/omni/browser/start']);
    await act(async () => release());
    await flush();
    expect(calls).toEqual(['POST /channels/omni/browser/start', 'STREAM /api/channels/omni/browser/stream']);
    act(() => root.unmount());
  });

  it('still attaches when the start fails, so the state shows', async () => {
    startStatus = 500;
    const root = await mount();
    expect(calls).toEqual(['POST /channels/omni/browser/start', 'STREAM /api/channels/omni/browser/stream']);
    act(() => root.unmount());
  });

  it('still attaches to an older server with no start route', async () => {
    startStatus = 404;
    const root = await mount();
    expect(calls).toContain('STREAM /api/channels/omni/browser/stream');
    act(() => root.unmount());
  });
});
