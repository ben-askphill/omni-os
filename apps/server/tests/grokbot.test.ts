import { afterEach, describe, expect, it, vi } from 'vitest';

// grokbot.ts imports secrets.ts, which imports db.ts. These tests pass their own secret reader.
vi.mock('../db.ts', () => ({ db: { prepare: vi.fn() } }));

import { GROKBOT_WEBHOOK_AUTH, GROKBOT_WEBHOOK_URL } from '../harness/env-guard.ts';
import { secretReachesThread, SYNC_SECRETS } from '../secrets.ts';
import { sendToGrokBot, threadGrokText, type GrokBotDeps } from '../grokbot.ts';

const URL = 'https://example.test/hook';
const AUTH = 'super-secret-token-value';

const logs = ['log', 'info', 'warn', 'error', 'debug'] as const;
let spies: ReturnType<typeof vi.spyOn>[] = [];

afterEach(() => {
  for (const spy of spies) spy.mockRestore();
  spies = [];
});

function watchConsole() {
  spies = logs.map((method) => vi.spyOn(console, method).mockImplementation(() => {}));
}

function leaked(secret: string) {
  return spies.some((spy) => spy.mock.calls.some((args: unknown[]) => args.map((part) => String(part)).join(' ').includes(secret)));
}

async function headerFor(auth: string): Promise<string> {
  let header = '';
  await sendToGrokBot(
    { request: 'hello' },
    deps(
      {
        fetch: async (_url, init) => {
          header = new Headers(init?.headers).get('authorization') ?? '';
          return new Response('', { status: 200 });
        },
      },
      { [GROKBOT_WEBHOOK_URL]: URL, [GROKBOT_WEBHOOK_AUTH]: auth },
    ),
  );
  return header;
}

function deps(over: Partial<GrokBotDeps> = {}, secrets: Record<string, string | null> = { [GROKBOT_WEBHOOK_URL]: URL, [GROKBOT_WEBHOOK_AUTH]: AUTH }): GrokBotDeps {
  return {
    secret: async (name) => secrets[name] ?? null,
    env: {},
    fetch: async () => new Response('{"accepted":true}', { status: 200 }),
    ...over,
  };
}

describe('sendToGrokBot', () => {
  it('posts the request with a bare key sent as Bearer', async () => {
    watchConsole();
    const seen: { url: string; init: RequestInit }[] = [];
    const result = await sendToGrokBot(
      { request: '  Look at the cart  ', context: { channel_id: 'acme', thread_id: 't1' } },
      deps({
        fetch: async (url, init) => {
          seen.push({ url: String(url), init: init ?? {} });
          return new Response('', { status: 202 });
        },
      }),
    );
    expect(result).toEqual({ ok: true, status: 202 });
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe(URL);
    expect(seen[0].init.method).toBe('POST');
    expect(seen[0].init.redirect).toBe('manual');
    const headers = new Headers(seen[0].init.headers);
    expect(headers.get('authorization')).toBe(`Bearer ${AUTH}`);
    expect(headers.get('content-type')).toBe('application/json');
    expect(JSON.parse(String(seen[0].init.body))).toEqual({
      request: 'Look at the cart',
      source: 'omni-os',
      context: { channel_id: 'acme', thread_id: 't1' },
    });
    expect(leaked(AUTH)).toBe(false);
  });

  it('omits context when none was given', async () => {
    let body = '';
    await sendToGrokBot(
      { request: 'hello' },
      deps({
        fetch: async (_url, init) => {
          body = String(init?.body);
          return new Response('', { status: 200 });
        },
      }),
    );
    expect(JSON.parse(body)).toEqual({ request: 'hello', source: 'omni-os' });
  });

  it('reads the Keychain before the environment', async () => {
    let auth = '';
    let url = '';
    await sendToGrokBot(
      { request: 'hello' },
      deps(
        {
          env: { [GROKBOT_WEBHOOK_URL]: 'https://env.example/hook', [GROKBOT_WEBHOOK_AUTH]: 'from-env-token' },
          fetch: async (input, init) => {
            url = String(input);
            auth = new Headers(init?.headers).get('authorization') ?? '';
            return new Response('', { status: 200 });
          },
        },
        { [GROKBOT_WEBHOOK_URL]: URL, [GROKBOT_WEBHOOK_AUTH]: AUTH },
      ),
    );
    expect(url).toBe(URL);
    expect(auth).toBe(`Bearer ${AUTH}`);
  });

  it('uses the environment when the Keychain has nothing', async () => {
    let auth = '';
    await sendToGrokBot(
      { request: 'hello' },
      deps(
        {
          env: { [GROKBOT_WEBHOOK_URL]: URL, [GROKBOT_WEBHOOK_AUTH]: 'from-env-token' },
          fetch: async (_url, init) => {
            auth = new Headers(init?.headers).get('authorization') ?? '';
            return new Response('', { status: 200 });
          },
        },
        { [GROKBOT_WEBHOOK_URL]: '   ', [GROKBOT_WEBHOOK_AUTH]: null },
      ),
    );
    expect(auth).toBe('Bearer from-env-token');
  });

  it('keeps a value that already starts with Bearer, in any case', async () => {
    expect(await headerFor(`Bearer ${AUTH}`)).toBe(`Bearer ${AUTH}`);
    expect(await headerFor(`bEaReR ${AUTH}`)).toBe(`bEaReR ${AUTH}`);
  });

  it('trims spaces, newlines and surrounding quotes before sending', async () => {
    expect(await headerFor(` \n"${AUTH}"\r\n `)).toBe(`Bearer ${AUTH}`);
    expect(await headerFor(`'${AUTH}'`)).toBe(`Bearer ${AUTH}`);
    expect(await headerFor(`  "Bearer ${AUTH}"  `)).toBe(`Bearer ${AUTH}`);
    expect(await headerFor(`'\nbEaReR ${AUTH}\n'`)).toBe(`bEaReR ${AUTH}`);
  });

  it('uses the environment when the Keychain value is only quotes and whitespace', async () => {
    let auth = '';
    await sendToGrokBot(
      { request: 'hello' },
      deps(
        {
          env: { [GROKBOT_WEBHOOK_URL]: URL, [GROKBOT_WEBHOOK_AUTH]: 'from-env-token' },
          fetch: async (_url, init) => {
            auth = new Headers(init?.headers).get('authorization') ?? '';
            return new Response('', { status: 200 });
          },
        },
        { [GROKBOT_WEBHOOK_URL]: URL, [GROKBOT_WEBHOOK_AUTH]: '"\n"' },
      ),
    );
    expect(auth).toBe('Bearer from-env-token');
  });

  it('returns a clear error when the webhook is not configured, and does not call fetch', async () => {
    let called = false;
    const result = await sendToGrokBot(
      { request: 'hello' },
      deps(
        {
          fetch: async () => {
            called = true;
            return new Response('');
          },
        },
        {},
      ),
    );
    expect(called).toBe(false);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('unconfigured');
      expect(result.error).toContain(GROKBOT_WEBHOOK_URL);
      expect(result.error).toContain(GROKBOT_WEBHOOK_AUTH);
      expect(result.error).toContain('Omni OS requests');
    }
  });

  it('names only the missing setting', async () => {
    const result = await sendToGrokBot({ request: 'hello' }, deps({}, { [GROKBOT_WEBHOOK_URL]: URL }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('unconfigured');
      expect(result.error).toContain(GROKBOT_WEBHOOK_AUTH);
      expect(result.error).not.toContain(GROKBOT_WEBHOOK_URL);
    }
  });

  it('refuses a URL that is not http or https', async () => {
    let called = false;
    const result = await sendToGrokBot(
      { request: 'hello' },
      deps(
        {
          fetch: async () => {
            called = true;
            return new Response('');
          },
        },
        { [GROKBOT_WEBHOOK_URL]: 'ftp://files.example/hook', [GROKBOT_WEBHOOK_AUTH]: AUTH },
      ),
    );
    expect(called).toBe(false);
    expect(result).toMatchObject({ ok: false, reason: 'invalid' });
  });

  it('tells a 401 to check the Authorization value and leaves the key out of the error and the log', async () => {
    watchConsole();
    let sent = '';
    const result = await sendToGrokBot(
      { request: 'hello' },
      deps({
        fetch: async (_url, init) => {
          sent = new Headers(init?.headers).get('authorization') ?? '';
          return new Response(JSON.stringify({ code: 'error', message: `Malformed Authorization header. Use Authorization: Bearer ${AUTH}.` }), {
            status: 401,
          });
        },
      }),
    );
    expect(sent).toBe(`Bearer ${AUTH}`);
    expect(result).toEqual({
      ok: false,
      reason: 'rejected',
      error: 'Grok Bot returned HTTP 401. Check that the Authorization value is the key from the Omni OS requests routine.',
    });
    expect(JSON.stringify(result)).not.toContain(AUTH);
    expect(JSON.stringify(result)).not.toContain('Malformed');
    expect(leaked(AUTH)).toBe(false);
    expect(leaked(`Bearer ${AUTH}`)).toBe(false);
  });

  it('redacts the key when another status echoes it', async () => {
    watchConsole();
    const result = await sendToGrokBot(
      { request: 'hello' },
      deps({
        fetch: async () => new Response(`denied ${AUTH} Bearer ${AUTH}`, { status: 500 }),
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('rejected');
      expect(result.error).toContain('HTTP 500');
      expect(result.error).toContain('[redacted]');
      expect(result.error).not.toContain(AUTH);
    }
    expect(leaked(AUTH)).toBe(false);
    expect(leaked(`Bearer ${AUTH}`)).toBe(false);
  });

  it('treats a redirect as a failure and does not follow it', async () => {
    const result = await sendToGrokBot(
      { request: 'hello' },
      deps({ fetch: async () => new Response(null, { status: 302, headers: { location: 'https://elsewhere.example/steal' } }) }),
    );
    expect(result).toMatchObject({ ok: false, reason: 'rejected' });
    if (!result.ok) expect(result.error).not.toContain('elsewhere.example');
  });

  it('reports a network failure without throwing or repeating the auth value', async () => {
    watchConsole();
    const result = await sendToGrokBot(
      { request: 'hello' },
      deps({
        fetch: async () => {
          throw new Error(`connect ${AUTH} ${URL}`);
        },
      }),
    );
    expect(result).toEqual({ ok: false, error: 'Could not reach Grok Bot.', reason: 'network' });
    expect(leaked(AUTH)).toBe(false);
    expect(leaked(URL)).toBe(false);
  });

  it('reports a timeout', async () => {
    const result = await sendToGrokBot(
      { request: 'hello' },
      deps({
        timeoutMs: 20,
        fetch: (_url, init) =>
          new Promise((_resolve, reject) => {
            const signal = init?.signal;
            if (!signal) return reject(new Error('no signal'));
            if (signal.aborted) return reject(signal.reason);
            signal.addEventListener('abort', () => reject(signal.reason));
          }),
      }),
    );
    expect(result).toEqual({ ok: false, error: 'Grok Bot did not answer in time.', reason: 'network' });
  });

  it('rejects empty text', async () => {
    const result = await sendToGrokBot({ request: '   ' }, deps());
    expect(result).toMatchObject({ ok: false, reason: 'invalid' });
  });
});

describe('threadGrokText', () => {
  it('keeps the title and the messages, and skips tool calls and dropped messages', () => {
    const text = threadGrokText({ title: 'Cart drawer' }, [
      { kind: 'user', payload: JSON.stringify({ text: 'Look at the cart' }) },
      { kind: 'tool_use', payload: JSON.stringify({ name: 'Read', input: {} }) },
      { kind: 'assistant_text', payload: JSON.stringify({ text: 'The drawer sticks.' }) },
      { kind: 'user', payload: JSON.stringify({ text: 'ignore me', dropped: 1 }) },
      { kind: 'crew_report', payload: JSON.stringify({ text: 'Done looking.' }) },
      { kind: 'error', payload: JSON.stringify({ text: 'the tool failed' }) },
      { kind: 'user', payload: '{not json' },
    ]);
    expect(text).toBe(
      ['Cart drawer', 'User: Look at the cart', 'Assistant: The drawer sticks.', 'Crew report: Done looking.', 'Error: the tool failed'].join('\n\n'),
    );
  });

  it('returns null when the thread has no text', () => {
    expect(threadGrokText({ title: '   ' }, [])).toBeNull();
  });

  it('keeps the end of a long thread', () => {
    const text = threadGrokText({ title: 'Long' }, [{ kind: 'assistant_text', payload: JSON.stringify({ text: 'z'.repeat(60_000) }) }]);
    expect(text?.startsWith('[Earlier text omitted]')).toBe(true);
    expect(text?.endsWith('z')).toBe(true);
    expect(text!.length).toBeLessThan(60_000);
  });
});

describe('secretReachesThread', () => {
  it('keeps sync credentials and the Grok Bot webhook out of a thread', () => {
    for (const name of Object.values(SYNC_SECRETS)) expect(secretReachesThread('global', name)).toBe(false);
    expect(secretReachesThread('global', GROKBOT_WEBHOOK_URL)).toBe(false);
    expect(secretReachesThread('global', GROKBOT_WEBHOOK_AUTH)).toBe(false);
    expect(secretReachesThread('channel:acme', GROKBOT_WEBHOOK_AUTH)).toBe(false);
    expect(secretReachesThread('channel:acme', 'SUPABASE_URL')).toBe(true);
    expect(secretReachesThread('global', 'SHOPIFY_TOKEN')).toBe(true);
    expect(secretReachesThread('channel:acme', 'SHOPIFY_TOKEN')).toBe(true);
  });
});
