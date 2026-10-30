// @vitest-environment happy-dom
// Measures a thread held open for a long session (#411): the head of an 80-turn thread, then the rest of a longer one
// streamed live, 8 rows a frame. Each frame appends, bounds, folds and renders the desktop transcript, and folds the
// phone's turns. Runs only with OMNI_MEASURE=1 and writes JSON to OMNI_MEASURE_OUT (default stderr):
//   OMNI_MEASURE=1 OMNI_MEASURE_OUT=/tmp/m.json NODE_OPTIONS=--expose-gc npx vitest run tests/live-history-measure.test.ts
// OMNI_MEASURE_TURNS sets the thread's length (400), OMNI_MEASURE_BOUND=0 leaves the held rows unbounded.
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { describe, it, vi } from 'vitest';
import { appendLive, boundHistory, openHistory, type History } from '@omni/shared/history.ts';
import type { EventRow } from '../src/api.ts';
import { historyServer, longRows } from './history-sim.ts';

// The test transform emits jsxDEV calls; production React has only jsx.
vi.mock('react/jsx-dev-runtime', async () => {
  const r = await import('react/jsx-runtime');
  return { Fragment: r.Fragment, jsxDEV: (type: never, props: never, key: never) => r.jsx(type, props, key) };
});
vi.mock('../src/store.tsx', () => ({ useApp: () => ({ tasks: [], feedLive: false }), useNow: () => Date.now() }));

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;

describe.runIf(process.env.OMNI_MEASURE === '1')('a thread held open for a long session', () => {
  it('measures each frame', async () => {
    // Production React, so render times are what a browser spends. Set back after: the worker runs other files.
    const env = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const { createElement } = await import('react');
    const { flushSync } = await import('react-dom');
    const { createRoot } = await import('react-dom/client');
    const { Transcript } = await import('../src/components/Transcript.tsx');
    const { buildItems } = await import('../src/transcript/fold.ts');
    const { threadView } = await import('../src/mobile/thread-view.ts');

    const turns = Number(process.env.OMNI_MEASURE_TURNS ?? 400);
    const bound = process.env.OMNI_MEASURE_BOUND !== '0';
    const opts = { hugeResult: 20_000, hugeWrite: 20_000 };
    const all = longRows({ turns, ...opts });
    const opened = longRows({ turns: 80, ...opts }).length;
    const { events, head } = historyServer(all.slice(0, opened)).head();
    let h: History = openHistory(events, head);
    const live = all.slice(opened);
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const view = (x: History) =>
      createElement(Transcript, { threadId: 't', events: x.rows as EventRow[], running: true, history: { history: x, busy: () => false, error: () => null, load: () => {} } as never });
    flushSync(() => root.render(view(h)));

    const frames: { append: number; fold: number; render: number; phone: number; heap?: number }[] = [];
    for (let i = 0; i < live.length; i += 8) {
      const t0 = performance.now();
      // Copies, so the parsed-payload WeakMap can drop rows the bound cut; the source array stays alive all run.
      h = appendLive(h, live.slice(i, i + 8).map((r) => ({ ...r })));
      if (bound) h = boundHistory(h, true);
      const t1 = performance.now();
      buildItems(h.rows as EventRow[], h.spans);
      const t2 = performance.now();
      flushSync(() => root.render(view(h)));
      const t3 = performance.now();
      threadView({ events: h.rows as EventRow[], spans: h.spans, thread: { status: 'running', cwd: '/repo', harness: 'claude' }, artifacts: [], children: [] });
      const t4 = performance.now();
      const heap = frames.length % 50 === 0 ? (globalThis.gc?.(), process.memoryUsage().heapUsed / 2 ** 20) : undefined;
      frames.push({ append: t1 - t0, fold: t2 - t1, render: t3 - t2, phone: t4 - t3, heap });
    }
    const last = frames.slice(-200);
    const ms = (k: 'append' | 'fold' | 'render' | 'phone') => Number(median(last.map((f) => f[k])).toFixed(2));
    const heaps = frames.flatMap((f) => (f.heap === undefined ? [] : [Math.round(f.heap)]));
    const out = {
      bound,
      rowsStreamed: live.length,
      frames: frames.length,
      heldRows: { open: events.length, end: h.rows.length },
      lastFramesMedianMs: { append: ms('append'), fold: ms('fold'), render: ms('render'), phoneFold: ms('phone') },
      heapMiB: { first: heaps[0], last: heaps.at(-1) },
      domNodes: host.querySelectorAll('*').length,
    };
    writeFileSync(process.env.OMNI_MEASURE_OUT ?? '/dev/stderr', `${JSON.stringify(out, null, 1)}\n`);
    root.unmount();
    process.env.NODE_ENV = env;
  }, 600_000);
});
