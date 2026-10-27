// Sends one request to Ben's Grok Bot webhook. The URL and Authorization value come from the
// Keychain (global secrets GROKBOT_WEBHOOK_URL and GROKBOT_WEBHOOK_AUTH) and fall back to the
// process environment. A bare key is sent as "Bearer <key>". Callers get a result. This function does not throw.
import { Hono } from 'hono';
import { z } from 'zod';
import { events, threads } from './db.ts';
import { GROKBOT_WEBHOOK_AUTH, GROKBOT_WEBHOOK_URL } from './harness/env-guard.ts';
import { globalSecret } from './secrets.ts';

const SOURCE = 'omni-os';
const TIMEOUT_MS = 15_000;
const MAX_REQUEST = 100_000;
const MAX_THREAD_TEXT = 50_000;
const MAX_CONTEXT = 8_000;

export type GrokBotFailureReason = 'unconfigured' | 'invalid' | 'rejected' | 'network';

export type GrokBotResult = { ok: true; status: number } | { ok: false; error: string; reason: GrokBotFailureReason };

export interface GrokBotInput {
  request: string;
  context?: Record<string, unknown>;
}

export interface GrokBotDeps {
  fetch?: typeof fetch;
  /** Keychain read. Defaults to the global secret of that name. */
  secret?: (name: string) => Promise<string | null>;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

const TEXT_KINDS = new Set(['user', 'assistant_text', 'crew_report', 'error']);

function speaker(kind: string): string {
  switch (kind) {
    case 'user':
      return 'User';
    case 'assistant_text':
      return 'Assistant';
    case 'crew_report':
      return 'Crew report';
    case 'error':
      return 'Error';
    default: {
      const unreachable: never = kind as never;
      return unreachable;
    }
  }
}

/** Title plus the thread's messages. Null when there is nothing to send. Tool calls stay out. */
export function threadGrokText(thread: { title: string }, rows: { kind: string; payload: string }[]): string | null {
  const parts: string[] = [];
  const title = thread.title.trim();
  if (title) parts.push(title);
  for (const row of rows) {
    if (!TEXT_KINDS.has(row.kind)) continue;
    let payload: { text?: unknown; dropped?: unknown };
    try {
      payload = JSON.parse(row.payload) as { text?: unknown; dropped?: unknown };
    } catch {
      continue;
    }
    if (payload.dropped) continue;
    const text = typeof payload.text === 'string' ? payload.text.trim() : '';
    if (!text) continue;
    parts.push(`${speaker(row.kind)}: ${text}`);
  }
  let request = parts.join('\n\n').trim();
  if (!request) return null;
  if (request.length > MAX_THREAD_TEXT) request = `[Earlier text omitted]\n\n${request.slice(request.length - MAX_THREAD_TEXT)}`;
  return request;
}

function scrub(text: string, hidden: string[]): string {
  let out = text;
  for (const secret of hidden) {
    const value = secret.trim();
    // A very short value would punch holes in an ordinary sentence.
    if (value.length < 4) continue;
    out = out.split(value).join('[redacted]');
  }
  return out;
}

function fail(reason: GrokBotFailureReason, error: string): GrokBotResult {
  return { ok: false, error, reason };
}

async function setting(
  name: string,
  deps: Required<Pick<GrokBotDeps, 'secret' | 'env'>>,
  normalize: (raw: string) => string | null = (raw) => raw.trim() || null,
): Promise<string | null> {
  let fromKeychain: string | null = null;
  try {
    fromKeychain = await deps.secret(name);
  } catch {
    fromKeychain = null;
  }
  for (const raw of [fromKeychain, deps.env[name]]) {
    if (typeof raw !== 'string') continue;
    const value = normalize(raw);
    if (value) return value;
  }
  return null;
}

/** Trim spaces, newlines and surrounding quotes. Add `Bearer ` unless that scheme is already there. */
function authorizationHeader(raw: string): string | null {
  let value = raw.trim();
  for (let i = 0; i < 2; i++) {
    if (value.length < 2) break;
    const quote = value[0];
    if ((quote !== '"' && quote !== "'") || value[value.length - 1] !== quote) break;
    value = value.slice(1, -1).trim();
  }
  if (!value) return null;
  if (/^bearer /i.test(value)) return value;
  return `Bearer ${value}`;
}

/** The header and the key inside it, so an error body that repeats either one can be scrubbed. */
function authSecrets(header: string): string[] {
  const key = /^bearer (.*)$/i.exec(header)?.[1]?.trim() ?? '';
  return key && key !== header ? [header, key] : [header];
}

function webhookUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  return url;
}

/**
 * POST `{ request, source: "omni-os", context? }` to the webhook.
 * Keychain wins over the environment. A bare key is sent as `Bearer <key>`. A value that
 * already starts with `Bearer ` (any case) is sent unchanged, after trimming. A redirect is
 * an error: following it would send the Authorization value to another host.
 */
export async function sendToGrokBot(input: GrokBotInput, deps: GrokBotDeps = {}): Promise<GrokBotResult> {
  const secret = deps.secret ?? ((name: string) => globalSecret(name));
  const env = deps.env ?? process.env;
  const doFetch = deps.fetch ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = deps.timeoutMs && deps.timeoutMs > 0 ? deps.timeoutMs : TIMEOUT_MS;

  const request = input.request.trim();
  if (!request) return fail('invalid', 'There is no text to send.');
  if (request.length > MAX_REQUEST) return fail('invalid', 'The text is too long to send.');

  const urlValue = await setting(GROKBOT_WEBHOOK_URL, { secret, env });
  const auth = await setting(GROKBOT_WEBHOOK_AUTH, { secret, env }, authorizationHeader);
  const missing = [!urlValue && GROKBOT_WEBHOOK_URL, !auth && GROKBOT_WEBHOOK_AUTH].filter((name): name is string => !!name);
  if (missing.length) {
    return fail(
      'unconfigured',
      `Grok Bot is not configured. Add ${missing.join(' and ')} in Settings, Secrets, scope global, or in .env. The values are in the Omni OS requests routine in Grok Bot.`,
    );
  }
  const url = webhookUrl(urlValue!);
  if (!url) return fail('invalid', `${GROKBOT_WEBHOOK_URL} must be an http or https URL.`);

  const hidden = [...authSecrets(auth!), urlValue!];
  const payload: { request: string; source: typeof SOURCE; context?: Record<string, unknown> } = { request, source: SOURCE };
  if (input.context && Object.keys(input.context).length) payload.context = input.context;

  let body: string;
  try {
    body = JSON.stringify(payload);
  } catch {
    return fail('invalid', 'The request could not be encoded as JSON.');
  }

  let res: Response;
  try {
    res = await doFetch(url.toString(), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: auth! },
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const name = err && typeof err === 'object' && 'name' in err ? String(err.name) : '';
    const timedOut = name === 'TimeoutError' || name === 'AbortError';
    return fail('network', timedOut ? 'Grok Bot did not answer in time.' : 'Could not reach Grok Bot.');
  }

  if (res.status >= 300 && res.status < 400) {
    await res.body?.cancel().catch(() => {});
    return fail('rejected', 'Grok Bot redirected the request. Omni does not follow it.');
  }
  if (!res.ok) {
    // 401 is a refused key. Leave the body out: it can repeat the key.
    if (res.status === 401) {
      await res.body?.cancel().catch(() => {});
      return fail(
        'rejected',
        'Grok Bot returned HTTP 401. Check that the Authorization value is the key from the Omni OS requests routine.',
      );
    }
    const snippet = scrub((await res.text().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 180), hidden);
    const detail = snippet ? ` ${snippet}` : '';
    return fail('rejected', scrub(`Grok Bot returned HTTP ${res.status}.${detail}`, hidden));
  }
  await res.body?.cancel().catch(() => {});
  return { ok: true, status: res.status };
}

function statusFor(reason: GrokBotFailureReason): 400 | 502 | 503 {
  switch (reason) {
    case 'invalid':
      return 400;
    case 'unconfigured':
      return 503;
    case 'rejected':
    case 'network':
      return 502;
    default: {
      const unreachable: never = reason;
      return unreachable;
    }
  }
}

function readContext(value: unknown): Record<string, unknown> | undefined | 'bad' {
  if (value == null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) return 'bad';
  let encoded: string;
  try {
    encoded = JSON.stringify(value);
  } catch {
    return 'bad';
  }
  if (encoded.length > MAX_CONTEXT) return 'bad';
  return JSON.parse(encoded) as Record<string, unknown>;
}

export const grokbotApi = new Hono();

const Body = z.object({
  request: z.string().min(1).max(MAX_REQUEST).optional(),
  thread_id: z.string().min(1).max(200).optional(),
  context: z.unknown().optional(),
});

// POST /api/grokbot. A thread_id sends that thread's text and adds its channel and thread ids to context.
grokbotApi.post('/', async (c) => {
  if (!/^application\/json\b/i.test(c.req.header('content-type') ?? '')) return c.json({ error: 'Send JSON.' }, 415);
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: 'Send JSON.' }, 400);
  }
  const body = Body.parse(raw);
  const given = body.request?.trim();
  const threadId = body.thread_id?.trim();
  if (!given && !threadId) return c.json({ error: 'Send a request or a thread_id.' }, 400);

  const context = readContext(body.context);
  if (context === 'bad') return c.json({ error: 'Context must be a JSON object.' }, 400);

  let request = given;
  let merged = context;
  if (threadId) {
    const thread = threads.get(threadId);
    if (!thread) return c.json({ error: 'Thread not found.' }, 404);
    merged = { ...(merged ?? {}), channel_id: thread.channel_id, thread_id: thread.id };
    if (!request) {
      const text = threadGrokText(thread, events.since(thread.id));
      if (!text) return c.json({ error: 'This thread has no text to send.' }, 400);
      request = text;
    }
  }
  if (!request) return c.json({ error: 'Send a request or a thread_id.' }, 400);

  const result = await sendToGrokBot({ request, ...(merged && Object.keys(merged).length ? { context: merged } : {}) });
  if (result.ok) return c.json({ ok: true });
  return c.json({ error: result.error }, statusFor(result.reason));
});
