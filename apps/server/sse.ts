// The one way a route opens an SSE stream. It is streamSSE, plus: a stream opened with a device session ends the
// moment that session does (apps/server/session-streams.ts). tests/session-streams.test.ts fails on any other
// streamSSE call in the server.
import type { Context } from 'hono';
import { streamSSE, type SSEStreamingApi } from 'hono/streaming';
import { reconcileStreams, sessionIsLive } from './google-auth.ts';
import { trackStream } from './session-streams.ts';

/** Sessions that went stale without a revoke are noticed within this long. */
const SWEEP_MS = 15_000;
let sweeper: ReturnType<typeof setInterval> | null = null;
let live = 0;

function sweepWhileOpen(): () => void {
  live++;
  sweeper ??= setInterval(() => reconcileStreams(), SWEEP_MS).unref();
  return () => {
    if (--live === 0 && sweeper) {
      clearInterval(sweeper);
      sweeper = null;
    }
  };
}

export function sessionSSE(c: Context, run: (stream: SSEStreamingApi) => Promise<void>) {
  const auth = c.get('omniAuth');
  return streamSSE(c, async (stream) => {
    if (auth?.via !== 'session') return run(stream);
    // Aborting cancels the response body, so the client sees the stream end at once and the route's onAbort cleanup runs.
    if (!sessionIsLive(auth.session)) return stream.abort();
    const forget = trackStream(auth.session, () => stream.abort());
    const unsweep = sweepWhileOpen();
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      forget();
      unsweep();
    };
    stream.onAbort(release);
    try {
      await run(stream);
    } finally {
      release();
    }
  });
}
