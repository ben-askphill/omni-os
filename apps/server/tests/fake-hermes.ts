// In-process Hermes API server for tests. No sockets leave the machine: it listens on 127.0.0.1:0.
// The token is a fixed test double, not a credential.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';

export interface FakeCall {
  method: string;
  path: string;
  body: unknown;
  idempotencyKey: string | null;
  authorization: string | null;
}

interface Run {
  id: string;
  status: string;
  output: string;
  error: string;
  session_id: string;
  usage?: unknown;
  runtime?: unknown;
  sse: ServerResponse | null;
  /** The worktree reads this run asks Omni for, one at a time, and the answer each one is waiting for. */
  reads: FakeRead[];
  waiting: { call_id: string; resolve: () => void } | null;
}

/** A read the fake asks Omni for with `tool.requested` (docs/internals/remote-harness-protocol.md, the read call). */
export interface FakeRead {
  arguments: unknown;
  /** Stamp the call with another run's id: a server replaying a call from a turn that has ended. */
  run_id?: string;
}

/** What Omni answered a read with: POST /v1/runs/{id}/tool_result. */
export interface FakeToolResult {
  run_id: string;
  call_id: string;
  output: string;
  is_error: boolean;
}

const USAGE = { input_tokens: 11, output_tokens: 7, total_tokens: 18, cache_read_tokens: 2, cache_write_tokens: 1 };
const RUNTIME = { provider: 'anthropic', model: 'claude-opus-5-5', route_source: 'global' };

function defaultEvents(runId: string) {
  return [
    { event: 'tool.started', run_id: runId, timestamp: 1, tool: 'terminal', preview: 'echo hi', seq: 0 },
    { event: 'tool.completed', run_id: runId, timestamp: 2, tool: 'terminal', duration: 0.339, error: false, preview: '{"output": "hi"}', seq: 1 },
    { event: 'message.delta', run_id: runId, timestamp: 3, delta: ' The command printed "hi".', seq: 3 },
    { event: 'reasoning.available', run_id: runId, timestamp: 4, text: 'ignored', seq: 4 },
    { event: 'run.completed', run_id: runId, timestamp: 5, output: 'The command printed "hi".', usage: USAGE, runtime: RUNTIME, seq: 5 },
  ];
}

const readBody = async (req: IncomingMessage) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
};

const writeEvent = (res: ServerResponse, evt: unknown, id: number) => {
  res.write(`id: ${id}\ndata: ${JSON.stringify(evt)}\n\n`);
};

export interface FakeHermes {
  url: string;
  /** Test double. Not a real key. */
  token: string;
  calls: FakeCall[];
  /** The next N creates answer 429, then succeed. */
  failPosts: number;
  /** 400 any create that includes `instructions`. */
  rejectInstructions: boolean;
  /** End the event stream after one delta. GET reports the run completed. */
  dropStream: boolean;
  /** Leave the run running until complete() or POST /stop. */
  hold: boolean;
  /** POST /steer answers 409 even while the run is running. */
  steerConflict: boolean;
  /** When set, the event stream is these events instead of the default script. */
  script: unknown[] | null;
  /** Write one non-JSON data line before the events, to prove the client skips it. */
  injectBadData: boolean;
  /** The avatar its signed-in GET /v1/capabilities offers, as image data (ADR 0020), or null for none. */
  avatar: string | null;
  /** The next runs ask Omni for these worktree reads, each waiting for its answer, then reply and complete. */
  reads: FakeRead[] | null;
  /** Omni's answers to reads, in order. */
  toolResults: FakeToolResult[];
  /** What a run that read replies, from its answers. Null says how many reads it made. */
  reply: ((answers: FakeToolResult[]) => string) | null;
  /** 400 any create that includes `tools`, as a server that takes no client tools may. */
  rejectTools: boolean;
  complete(output?: string): void;
  reset(): void;
  close(): Promise<void>;
}

export async function startFakeHermes(token = 'test-key'): Promise<FakeHermes> {
  const runs = new Map<string, Run>();
  const sockets = new Set<Socket>();
  let seq = 0;
  const fake: FakeHermes = {
    url: '',
    token,
    calls: [],
    failPosts: 0,
    rejectInstructions: false,
    dropStream: false,
    hold: false,
    steerConflict: false,
    script: null,
    injectBadData: false,
    avatar: null,
    reads: null,
    toolResults: [],
    reply: null,
    rejectTools: false,
    complete(output = 'done') {
      for (const run of runs.values()) {
        if (run.status !== 'running') continue;
        run.status = 'completed';
        run.output = output;
        run.usage = USAGE;
        run.runtime = RUNTIME;
        endSse(run, { event: 'run.completed', run_id: run.id, output, usage: USAGE, runtime: RUNTIME, seq: 9 });
      }
    },
    reset() {
      fake.avatar = null;
      fake.failPosts = 0;
      fake.rejectInstructions = false;
      fake.dropStream = false;
      fake.hold = false;
      fake.steerConflict = false;
      fake.script = null;
      fake.injectBadData = false;
      fake.reads = null;
      fake.toolResults = [];
      fake.reply = null;
      fake.rejectTools = false;
      fake.calls = [];
      for (const run of runs.values()) {
        if (run.sse && !run.sse.writableEnded) run.sse.end();
      }
      runs.clear();
    },
    close() {
      for (const s of sockets) s.destroy();
      return new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    },
  };

  const endSse = (run: Run, evt: unknown) => {
    const res = run.sse;
    run.sse = null;
    if (!res || res.writableEnded) return;
    writeEvent(res, evt, 9);
    res.write(': stream closed\n');
    res.end();
  };

  const json = (res: ServerResponse, status: number, body: unknown) => {
    const text = JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text) });
    res.end(text);
  };

  const applyScript = (run: Run, events: unknown[]) => {
    for (const evt of events) {
      const o = evt as { event?: string; output?: string; error?: string; usage?: unknown; runtime?: unknown };
      if (o.event === 'run.completed') {
        run.status = 'completed';
        run.output = o.output ?? '';
        run.usage = o.usage;
        run.runtime = o.runtime;
      } else if (o.event === 'run.failed') {
        run.status = 'failed';
        run.error = typeof o.error === 'string' ? o.error : 'failed';
      } else if (o.event === 'run.cancelled') run.status = 'cancelled';
      else if (o.event === 'run.interrupted') run.status = 'interrupted';
    }
  };

  const openEvents = (run: Run, res: ServerResponse) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(': open\n\n');
    if (fake.injectBadData) res.write('data: not-json\n\n');
    run.sse = res;
    res.on('close', () => {
      if (run.sse === res) run.sse = null;
    });

    // A dropped stream never delivers the ending, including on the one reconnect.
    // The run is already completed so GET can reconcile it.
    if (fake.dropStream) {
      run.status = 'completed';
      run.output = 'reconciled answer';
      run.usage = USAGE;
      run.runtime = RUNTIME;
      writeEvent(res, { event: 'message.delta', run_id: run.id, delta: 'partial', seq: 0 }, 1);
      res.write(': keepalive\n\n');
      run.sse = null;
      res.end();
      return;
    }

    // The run can be stopped before this request arrives. Replay the ending, not a fresh script.
    if (run.status !== 'running') {
      const evt =
        run.status === 'completed'
          ? { event: 'run.completed', run_id: run.id, output: run.output, usage: run.usage, runtime: run.runtime, seq: 9 }
          : run.status === 'failed'
            ? { event: 'run.failed', run_id: run.id, error: run.error, seq: 9 }
            : { event: run.status === 'interrupted' ? 'run.interrupted' : 'run.cancelled', run_id: run.id, seq: 9 };
      writeEvent(res, evt, 9);
      res.write(': stream closed\n');
      run.sse = null;
      res.end();
      return;
    }

    if (run.reads.length) {
      void askReads(run, res);
      return;
    }
    if (fake.hold && run.status === 'running') {
      writeEvent(res, { event: 'tool.started', run_id: run.id, tool: 'terminal', preview: 'echo hi', seq: 0 }, 1);
      return;
    }
    const events = fake.script ?? defaultEvents(run.id);
    applyScript(run, events);
    events.forEach((evt, i) => writeEvent(res, evt, i + 1));
    res.write(': stream closed\n');
    run.sse = null;
    res.end();
  };

  // Each read is a `tool.requested` the run waits on until Omni posts its answer; then it replies and completes.
  const askReads = async (run: Run, res: ServerResponse) => {
    let n = 0;
    writeEvent(res, { event: 'run.started', run_id: run.id, seq: n }, ++n);
    for (const [i, read] of run.reads.entries()) {
      const call_id = `call_${run.id}_${i + 1}`;
      const answered = new Promise<void>((resolve) => (run.waiting = { call_id, resolve }));
      writeEvent(res, { event: 'tool.requested', run_id: read.run_id ?? run.id, call_id, name: 'omni_worktree', arguments: read.arguments, seq: n }, ++n);
      await answered;
      if (res.writableEnded) return;
    }
    run.reads = [];
    const answers = fake.toolResults.filter((r) => r.run_id === run.id);
    const output = fake.reply ? fake.reply(answers) : `Read ${answers.length} times.`;
    run.status = 'completed';
    run.output = output;
    run.usage = USAGE;
    run.runtime = RUNTIME;
    writeEvent(res, { event: 'message.delta', run_id: run.id, delta: output, seq: n }, ++n);
    writeEvent(res, { event: 'run.completed', run_id: run.id, output, usage: USAGE, runtime: RUNTIME, seq: n }, ++n);
    run.sse = null;
    res.end();
  };

  const server: Server = createServer(async (req, res) => {
    req.on('error', () => {});
    res.on('error', () => {});
    const path = (req.url ?? '/').split('?')[0];
    const raw = req.method === 'GET' || req.method === 'HEAD' ? '' : await readBody(req);
    let body: unknown = null;
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        body = raw;
      }
    }
    fake.calls.push({
      method: req.method ?? 'GET',
      path,
      body,
      idempotencyKey: typeof req.headers['idempotency-key'] === 'string' ? req.headers['idempotency-key'] : null,
      authorization: typeof req.headers.authorization === 'string' ? req.headers.authorization : null,
    });
    if (req.headers.authorization !== `Bearer ${fake.token}`) {
      json(res, 401, { error: 'unauthorized' });
      return;
    }

    if (req.method === 'GET' && path === '/v1/capabilities') {
      json(res, 200, {
        model: 'hermes',
        ...(fake.avatar && { avatar: fake.avatar }),
        features: { run_submission: true, run_status: true, run_events_sse: true, run_stop: true, run_steer: true, run_approval_response: true, runs_idempotency: {} },
      });
      return;
    }

    if (req.method === 'POST' && path === '/v1/runs') {
      if (fake.failPosts > 0) {
        fake.failPosts -= 1;
        json(res, 429, { error: 'cap' });
        return;
      }
      const input = body as { instructions?: string; session_id?: string; tools?: unknown };
      if (fake.rejectInstructions && input?.instructions) {
        json(res, 400, { error: 'unknown field instructions' });
        return;
      }
      if (fake.rejectTools && input?.tools) {
        json(res, 400, { error: 'unknown field tools' });
        return;
      }
      const id = `run_${++seq}`;
      const run: Run = { id, status: 'running', output: '', error: '', session_id: String(input?.session_id ?? ''), usage: undefined, runtime: undefined, sse: null, reads: fake.reads ?? [], waiting: null };
      runs.set(id, run);
      json(res, 202, { run_id: id, status: 'started' });
      return;
    }

    const m = path.match(/^\/v1\/runs\/([^/]+)(?:\/(events|steer|stop|approval|tool_result))?$/);
    if (!m) {
      json(res, 404, { error: 'not found' });
      return;
    }
    const run = runs.get(m[1]);
    if (!run) {
      json(res, 404, { error: 'not found' });
      return;
    }
    const action = m[2];

    if (req.method === 'GET' && !action) {
      json(res, 200, { status: run.status, output: run.output, error: run.error, usage: run.usage, runtime: run.runtime, session_id: run.session_id, last_event: null });
      return;
    }
    if (req.method === 'GET' && action === 'events') {
      openEvents(run, res);
      return;
    }
    if (req.method === 'POST' && action === 'steer') {
      if (fake.steerConflict || run.status !== 'running') {
        json(res, 409, { error: 'not running' });
        return;
      }
      json(res, 200, { accepted: true });
      return;
    }
    if (req.method === 'POST' && action === 'stop') {
      if (run.status === 'running') {
        run.status = 'cancelled';
        endSse(run, { event: 'run.cancelled', run_id: run.id, seq: 8 });
      }
      json(res, 200, { status: 'stopping' });
      return;
    }
    if (req.method === 'POST' && action === 'tool_result') {
      const b = body as { call_id?: unknown; output?: unknown; is_error?: unknown };
      if (!run.waiting || b?.call_id !== run.waiting.call_id) {
        json(res, 409, { error: 'no such call waiting' });
        return;
      }
      fake.toolResults.push({ run_id: run.id, call_id: String(b.call_id), output: String(b.output ?? ''), is_error: b.is_error === true });
      const { resolve } = run.waiting;
      run.waiting = null;
      json(res, 200, { accepted: true });
      resolve();
      return;
    }
    if (req.method === 'POST' && action === 'approval') {
      json(res, 200, { ok: true });
      return;
    }
    json(res, 404, { error: 'not found' });
  });

  server.on('connection', (s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('fake hermes failed to bind');
  fake.url = `http://127.0.0.1:${addr.port}`;
  return fake;
}
