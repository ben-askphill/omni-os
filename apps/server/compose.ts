// The composition root: the one place the runner meets the modules it reports to and routes through. The runner's
// files (runner/) import none of run-on.ts, handoff.ts or published.ts; they call the ports in runner/ports.ts, which
// this file binds to those modules, and build each thread's controller (runner/controller.ts) with the reporting,
// scheduling and persistence bound here. app.ts and the test boot import this before the runner is used; a port
// used before that throws naming this file. The ownership lines this keeps are checked by
// tests/import-boundaries.test.ts and drawn in docs/internals/execution-state.md.
import { publishFeed, publishThread } from './bus.ts';
import { assignments, events, threads } from './db.ts';
import { sendNewThread } from './handoff.ts';
import { onToolResult } from './published.ts';
import { forwardMessage, forwardReport, targetFor } from './run-on.ts';
import { bindRunner } from './runner/ports.ts';

bindRunner({
  ports: {
    routing: { targetFor, forwardMessage, forwardReport },
    handoff: { sendNewThread },
    reporting: { toolResult: onToolResult },
  },
  deps: {
    reporting: {
      event: (threadId, kind, payload) => {
        const row = events.add(threadId, kind, payload);
        publishThread(threadId, row);
        return row;
      },
      thread: (threadId) => {
        const t = threads.get(threadId);
        if (t) publishFeed({ type: 'thread', thread: t });
      },
    },
    scheduling: {
      after: (ms, fn, opts) => {
        const t = setTimeout(fn, ms);
        if (opts?.unref) t.unref();
        return t;
      },
      cancel: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout> | undefined),
    },
    persistence: {
      claimTurn: (threadId) => {
        threads.update(threadId, { status: 'running' });
        return assignments.get(threadId)?.generation;
      },
    },
  },
});
