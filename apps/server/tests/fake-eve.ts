// A stand-in eve agent for the tests: eve's default /eve/v1 channel (health, info, sessions, the NDJSON stream,
// cancel, reset) behind a bearer key, and the Omni pairing route an eve agent serves at its root
// (docs/internals/remote-harness-protocol.md, eve agents). Each message runs one scripted turn.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

export interface FakeEveCall {
  method: string;
  path: string;
  authorization: string | null;
  body: unknown;
}

interface Session {
  id: string;
  events: unknown[];
  listeners: Set<() => void>;
  /** A turn waiting for Stop (the `hang` script). */
  hanging: string | null;
}

export interface FakeEve {
  url: string;
  key: string;
  calls: FakeEveCall[];
  sessions: Map<string, Session>;
  /** The next turn waits until it is cancelled instead of finishing. */
  hangNext: boolean;
  /** The pairing code POST /v1/omni/pair takes once. */
  code: string;
  /** What GET /v1/omni/pair offers; null serves no pairing route at all. */
  offer: Record<string, unknown> | null;
  reset(): void;
  close(): Promise<void>;
}

const MODEL = 'deepseek/deepseek-v4-pro';

export async function startFakeEve(key = 'eve-key-0123456789'): Promise<FakeEve> {
  let seq = 0;
  const fake: FakeEve = {
    url: '',
    key,
    calls: [],
    sessions: new Map(),
    hangNext: false,
    code: 'GB8Z-DP5J-0TGX-R608-WYSB-WV2T-G8SV',
    offer: { name: 'Nomos', description: 'An eve agent for tests.', code_url: '/omni' },
    reset() {
      fake.calls = [];
      fake.sessions.clear();
      fake.hangNext = false;
      fake.offer = { name: 'Nomos', description: 'An eve agent for tests.', code_url: '/omni' };
    },
    close: () => new Promise((r) => server.close(() => r())),
  };

  const push = (s: Session, type: string, data: Record<string, unknown> = {}) => {
    s.events.push({ type, data, meta: { id: `evt_${++seq}`, at: new Date().toISOString() } });
    for (const l of s.listeners) l();
  };

  function runTurn(s: Session, message: string) {
    const turnId = `turn_${++seq}`;
    const hang = fake.hangNext;
    fake.hangNext = false;
    setTimeout(() => {
      push(s, 'message.received', { message, turnId });
      push(s, 'turn.started', { turnId, sequence: 0 });
      if (hang) {
        s.hanging = turnId;
        return;
      }
      push(s, 'step.started', { modelId: MODEL, stepIndex: 0, sequence: 0, turnId });
      push(s, 'actions.requested', { actions: [{ kind: 'tool-call', callId: 'c1', toolName: 'list_reminders', input: { day: 'today' } }], stepIndex: 0, sequence: 0, turnId });
      push(s, 'action.result', { result: { kind: 'tool-result', callId: 'c1', toolName: 'list_reminders', output: { reminders: 2 } }, status: 'completed', stepIndex: 0, sequence: 0, turnId });
      push(s, 'message.appended', { messageDelta: 'You have ', messageSoFar: 'You have ', stepIndex: 1, sequence: 0, turnId });
      push(s, 'message.appended', { messageDelta: 'two reminders.', messageSoFar: 'You have two reminders.', stepIndex: 1, sequence: 0, turnId });
      push(s, 'message.completed', { message: 'You have two reminders.', finishReason: 'stop', stepIndex: 1, sequence: 0, turnId });
      push(s, 'step.completed', { finishReason: 'stop', usage: { inputTokens: 40, outputTokens: 9 }, stepIndex: 1, sequence: 0, turnId });
      push(s, 'turn.completed', { turnId, sequence: 0 });
      push(s, 'session.waiting', {});
    }, 5);
  }

  const send = (res: ServerResponse, status: number, json?: unknown, headers: Record<string, string> = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(json === undefined ? '' : JSON.stringify(json));
  };

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const text = Buffer.concat(chunks).toString('utf8');
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    const u = new URL(req.url ?? '/', 'http://x');
    const path = u.pathname;
    const authorization = req.headers.authorization ?? null;
    fake.calls.push({ method: req.method ?? '', path, authorization, body });
    const b = (body ?? {}) as Record<string, unknown>;

    if (path === '/eve/v1/health') return send(res, 200, { ok: true });
    if (path === '/v1/omni/pair') {
      if (!fake.offer) return send(res, 404, { error: 'not found' });
      if (req.method === 'GET') return send(res, 405, { error: 'POST a pairing code', ...fake.offer });
      if (b.code !== fake.code) return send(res, 404, { error: 'unknown or used code' });
      return send(res, 200, { protocol: 1, kind: 'eve', name: 'Nomos', url: fake.url, key: fake.key, key_id: 'omni-k1', shared_key: false, revoke: true });
    }
    if (path === '/v1/omni/revoke') return send(res, authorization === `Bearer ${fake.key}` ? 204 : 401);
    if (!path.startsWith('/eve/v1/')) return send(res, 404, { error: 'not found' });
    if (authorization !== `Bearer ${fake.key}`) return send(res, 401, { ok: false, code: 'unauthorized', error: 'Sign in.' }, { 'www-authenticate': 'Bearer' });

    if (path === '/eve/v1/info') return send(res, 200, { model: { id: MODEL }, instructions: [] });
    if (path === '/eve/v1/session' && req.method === 'POST') {
      const s: Session = { id: `wrun_${++seq}`, events: [], listeners: new Set(), hanging: null };
      fake.sessions.set(s.id, s);
      push(s, 'session.started', {});
      runTurn(s, String(b.message ?? ''));
      return send(res, 202, { ok: true, sessionId: s.id, status: 'accepted' }, { 'x-eve-session-id': s.id });
    }
    const m = /^\/eve\/v1\/session\/([^/]+)(?:\/(stream|cancel|reset))?$/.exec(path);
    const s = m ? fake.sessions.get(decodeURIComponent(m[1])) : undefined;
    // eve answers 404 for a stream it has no session for, and 409 for a message to one that is not active.
    if (!m || !s) return m && !m[2] ? send(res, 409, { ok: false, code: 'session_not_active', error: 'The session is no longer active.' }) : send(res, 404, { ok: false, error: 'Session not found.' });
    if (m[2] === 'cancel') {
      if (!s.hanging) return send(res, 200, { ok: true, status: 'no_active_turn' });
      const turnId = s.hanging;
      s.hanging = null;
      setTimeout(() => {
        push(s, 'turn.cancelled', { turnId, sequence: 0 });
        push(s, 'session.waiting', {});
      }, 5);
      return send(res, 202, { ok: true, sessionId: s.id, status: 'accepted' });
    }
    if (m[2] === 'reset') {
      fake.sessions.delete(s.id);
      return send(res, 200, { ok: true, status: 'reset', previousSessionId: s.id });
    }
    if (m[2] === 'stream') {
      const start = Number(u.searchParams.get('startIndex') ?? 0);
      const tailOnly = u.searchParams.get('includeTailIndex') === '1';
      const tail = s.events.length - 1;
      const from = start < 0 ? Math.max(0, s.events.length + start) : start;
      res.writeHead(200, { 'content-type': 'application/x-ndjson', ...(tailOnly && { 'x-eve-stream-tail-index': String(tail) }) });
      let at = from;
      const flush = () => {
        while (at < s.events.length) res.write(`${JSON.stringify(s.events[at++])}\n`);
      };
      flush();
      if (tailOnly) return res.end();
      const listener = () => flush();
      s.listeners.add(listener);
      req.on('close', () => s.listeners.delete(listener));
      return;
    }
    // A follow-up message.
    if (req.method === 'POST') {
      runTurn(s, String(b.message ?? ''));
      return send(res, 202, { ok: true, sessionId: s.id, status: 'accepted' });
    }
    send(res, 404, { error: 'not found' });
  }

  const server: Server = createServer((req, res) => void handle(req, res));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  fake.url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return fake;
}
