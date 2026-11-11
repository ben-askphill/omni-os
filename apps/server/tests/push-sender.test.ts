import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { ApnsRequest, ApnsResponse, ApnsTransport } from '../push-apns.ts';
import { alertFor, createPushSender, loadPushConfig, noopPushSender, payloadFor, type PushEvent, type PushSenderDeps } from '../push-sender.ts';
import type { PushTarget } from '../push-preferences.ts';

const PEM = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const NOW = 1_700_000_000_000;
const EVENT: PushEvent = { kind: 'needsInput', threadId: 'thread-1', channelId: 'conductor', title: 'Plan Q4', text: 'Which goal first?' };
const target = (n: number, extra: Partial<PushTarget> = {}): PushTarget => ({
  sessionId: `s${n}`,
  token: `token${n}`,
  environment: 'production',
  bundleId: null,
  ...extra,
});

type Reply = (req: ApnsRequest, call: number) => ApnsResponse | Promise<ApnsResponse>;

/** A sender wired to a fake APNs. The clock is fixed and sleeps are recorded, not waited. */
function harness(opts: { targets?: PushTarget[]; reply?: Reply; live?: (id: string) => boolean } = {}) {
  const sent: ApnsRequest[] = [];
  const sleeps: number[] = [];
  const forgotten: string[] = [];
  const logged: string[] = [];
  const transport: ApnsTransport = {
    send: async (req) => {
      sent.push(req);
      return (opts.reply ?? (() => ({ status: 200, reason: null })))(req, sent.length);
    },
    close() {},
  };
  let clock = NOW;
  const deps: PushSenderDeps = {
    config: { key: { keyId: 'KEY1', teamId: 'TEAM1', pem: PEM }, bundleId: 'app.omni-os.ios' },
    transport,
    targets: () => opts.targets ?? [target(1)],
    live: opts.live ?? (() => true),
    forget: (token) => forgotten.push(token),
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    log: (line) => logged.push(line),
  };
  return {
    sender: createPushSender(deps),
    sent,
    sleeps,
    forgotten,
    logged,
    advance: (ms: number) => (clock += ms),
  };
}

describe('sending an alert', () => {
  it('sends one request per device, to its environment and topic', async () => {
    const h = harness({ targets: [target(1), target(2, { environment: 'sandbox', bundleId: 'app.omni-os.beta' })] });
    h.sender.send(EVENT);
    await vi.waitFor(() => expect(h.sent).toHaveLength(2));
    expect(h.sent.map((r) => [r.token, r.environment, r.topic])).toEqual([
      ['token1', 'production', 'app.omni-os.ios'],
      ['token2', 'sandbox', 'app.omni-os.beta'],
    ]);
  });

  it('titles the alert with the thread, says what happened, and previews the reply as plain text', () => {
    const payload = JSON.parse(
      payloadFor({ kind: 'finished', threadId: 'thread-9', channelId: 'omni-os', title: 'Fix iOS push previews', text: '## Done\n\nOpened **PR #612**.' }),
    );
    expect(Object.keys(payload).sort()).toEqual(['aps', 'omni']);
    expect(payload.aps.alert).toEqual({ title: 'Fix iOS push previews', subtitle: 'Finished', body: 'Done Opened PR #612.' });
    expect(payload.omni).toEqual({ kind: 'finished', threadId: 'thread-9', channelId: 'omni-os' });
  });

  it('names the reporting thread in a crew report', () => {
    expect(alertFor({ kind: 'crewReport', threadId: 't', channelId: 'conductor', title: 'Conductor', text: 'All green.', from: 'Run the suite' })).toEqual({
      title: 'Conductor',
      subtitle: 'Crew report: Run the suite',
      body: 'All green.',
    });
  });

  it('falls back to the generic line when the turn wrote no text', () => {
    expect(alertFor({ kind: 'finished', threadId: 't', channelId: null, title: 'Tidy', text: '' }).body).toBe('Open Omni to see the result.');
    expect(alertFor({ kind: 'failed', threadId: 't', channelId: null, title: 'Tidy', text: '```\nexit 1\n```' }).body).toBe(
      'Open Omni to see what happened.',
    );
  });

  it('keeps the generic title when the thread has none', () => {
    expect(alertFor({ kind: 'needsInput', threadId: 't', channelId: null, title: '  ', text: 'Ship it?' })).toEqual({
      title: 'Omni needs you',
      body: 'Ship it?',
    });
  });

  it('clips a long title and a long reply so the payload stays small', () => {
    const alert = alertFor({ kind: 'finished', threadId: 't', channelId: null, title: 'T'.repeat(300), text: 'word '.repeat(2000) });
    expect(Array.from(alert.title).length).toBeLessThanOrEqual(80);
    expect(Array.from(alert.body).length).toBeLessThanOrEqual(150);
    expect(Buffer.byteLength(payloadFor({ kind: 'finished', threadId: 't', channelId: null, title: '🎉'.repeat(300), text: '🎉'.repeat(3000) }))).toBeLessThan(4096);
  });

  it('asks Apple to stop trying after fifteen minutes', async () => {
    const h = harness();
    h.sender.send(EVENT);
    await vi.waitFor(() => expect(h.sent).toHaveLength(1));
    expect(h.sent[0].expiration).toBe(NOW / 1000 + 15 * 60);
  });

  it('sends nothing when no device wants this kind', () => {
    const h = harness({ targets: [] });
    h.sender.send(EVENT);
    expect(h.sent).toEqual([]);
  });

  it('keeps at most ten requests open at once, and still sends them all', async () => {
    let open = 0;
    let most = 0;
    const h = harness({
      targets: Array.from({ length: 250 }, (_, i) => target(i)),
      reply: async () => {
        open++;
        most = Math.max(most, open);
        await new Promise((done) => setImmediate(done));
        open--;
        return { status: 200, reason: null };
      },
    });
    h.sender.send(EVENT);
    await vi.waitFor(() => expect(h.sent).toHaveLength(250));
    expect(most).toBeGreaterThan(1);
    expect(most).toBeLessThanOrEqual(10);
  });
});

describe('retries', () => {
  it('retries a server error with backoff, then gives up after three attempts', async () => {
    const h = harness({ reply: () => ({ status: 503, reason: 'ServiceUnavailable' }) });
    h.sender.send(EVENT);
    await vi.waitFor(() => expect(h.logged).toHaveLength(1));
    expect(h.sent).toHaveLength(3);
    expect(h.sleeps).toEqual([500, 1000]);
    expect(h.forgotten).toEqual([]);
    expect(h.logged[0]).toContain('503 ServiceUnavailable');
  });

  it('retries a request that never got an answer', async () => {
    const h = harness({
      reply: (_req, call) => {
        if (call === 1) throw new Error('socket hang up');
        return { status: 200, reason: null };
      },
    });
    h.sender.send(EVENT);
    await vi.waitFor(() => expect(h.sent).toHaveLength(2));
    expect(h.sleeps).toEqual([500]);
    expect(h.logged).toEqual([]);
  });

  it('signs a new provider token and retries at once when APNs says the old one expired', async () => {
    const h = harness({
      reply: (_req, call) => (call === 1 ? { status: 403, reason: 'ExpiredProviderToken' } : { status: 200, reason: null }),
    });
    h.sender.send(EVENT);
    await vi.waitFor(() => expect(h.sent).toHaveLength(2));
    expect(h.sleeps).toEqual([]);
    expect(h.sent[1].jwt).not.toBe(h.sent[0].jwt);
  });

  it('does not retry a rejected alert', async () => {
    const h = harness({ reply: () => ({ status: 413, reason: 'PayloadTooLarge' }) });
    h.sender.send(EVENT);
    await vi.waitFor(() => expect(h.logged).toHaveLength(1));
    expect(h.sent).toHaveLength(1);
    expect(h.forgotten).toEqual([]);
  });
});

describe('invalid tokens', () => {
  it('forgets a token APNs reports as unregistered, and does not retry it', async () => {
    const h = harness({ targets: [target(1)], reply: () => ({ status: 410, reason: 'Unregistered' }) });
    h.sender.send(EVENT);
    await vi.waitFor(() => expect(h.forgotten).toEqual(['token1']));
    expect(h.sent).toHaveLength(1);
  });

  it('forgets a token APNs calls a bad device token, and keeps the others', async () => {
    const h = harness({
      targets: [target(1), target(2)],
      reply: (req) => (req.token === 'token1' ? { status: 400, reason: 'BadDeviceToken' } : { status: 200, reason: null }),
    });
    h.sender.send(EVENT);
    await vi.waitFor(() => expect(h.sent).toHaveLength(2));
    expect(h.forgotten).toEqual(['token1']);
  });

  it('keeps every token when Apple rejects the topic or the provider key, since the fault is ours', async () => {
    const h = harness({ targets: [target(1)], reply: () => ({ status: 400, reason: 'DeviceTokenNotForTopic' }) });
    h.sender.send(EVENT);
    await vi.waitFor(() => expect(h.logged).toHaveLength(1));
    expect(h.forgotten).toEqual([]);
  });
});

describe('revocation', () => {
  it('sends nothing to a session that is not live', async () => {
    const h = harness({ targets: [target(1), target(2)], live: (id) => id !== 's1' });
    h.sender.send(EVENT);
    await vi.waitFor(() => expect(h.sent).toHaveLength(1));
    expect(h.sent.map((r) => r.token)).toEqual(['token2']);
  });

  it('checks liveness again before each retry, so a session revoked mid-retry gets no further attempts', async () => {
    let alive = true;
    const h = harness({
      live: () => alive,
      reply: () => {
        alive = false;
        return { status: 503, reason: 'ServiceUnavailable' };
      },
    });
    h.sender.send(EVENT);
    await vi.waitFor(() => expect(h.sent).toHaveLength(1));
    await new Promise((done) => setTimeout(done, 0));
    expect(h.sent).toHaveLength(1);
  });
});

describe('when APNs is not configured', () => {
  it('the no-op sender reports itself unconfigured and never calls out', () => {
    expect(noopPushSender.configured).toBe(false);
    expect(() => noopPushSender.send(EVENT)).not.toThrow();
  });

  it('names the missing secrets, and never prints a value', () => {
    const loaded = loadPushConfig((name) => (name === 'APNS_KEY_ID' ? 'KEY1' : undefined));
    expect(loaded).toEqual({ problem: 'missing APNS_TEAM_ID, APNS_AUTH_KEY' });
  });

  it('refuses a key that is not a P-256 private key, without echoing it', () => {
    const values: Record<string, string> = { APNS_KEY_ID: 'K', APNS_TEAM_ID: 'T', APNS_AUTH_KEY: 'not-a-key-secret' };
    const loaded = loadPushConfig((name) => values[name]);
    expect(loaded).toEqual({ problem: 'APNS_AUTH_KEY is not a P-256 private key' });
    expect(JSON.stringify(loaded)).not.toContain('not-a-key-secret');
  });

  it('reads a key whose newlines were written as \\n, and defaults the bundle id', () => {
    const values: Record<string, string> = { APNS_KEY_ID: ' KEY1 ', APNS_TEAM_ID: 'TEAM1', APNS_AUTH_KEY: PEM.replace(/\n/g, '\\n') };
    const loaded = loadPushConfig((name) => values[name]);
    expect(loaded).toEqual({ config: { key: { keyId: 'KEY1', teamId: 'TEAM1', pem: PEM.trim() }, bundleId: 'app.omni-os.ios' } });
  });

  it('reads a key pasted into a one-line field, with its line breaks dropped or turned into spaces', () => {
    const body = PEM.split('\n').filter((l) => l && !l.startsWith('-----')).join('');
    for (const pasted of [PEM.replace(/\n/g, ''), PEM.trim().replace(/\n/g, ' '), body]) {
      const values: Record<string, string> = { APNS_KEY_ID: 'K', APNS_TEAM_ID: 'T', APNS_AUTH_KEY: pasted };
      expect(loadPushConfig((name) => values[name])).toMatchObject({ config: { key: { pem: PEM.trim() } } });
    }
  });

  it('uses the bundle id it is given', () => {
    const values: Record<string, string> = { APNS_KEY_ID: 'K', APNS_TEAM_ID: 'T', APNS_AUTH_KEY: PEM, APNS_BUNDLE_ID: 'app.omni-os.beta' };
    expect(loadPushConfig((name) => values[name])).toMatchObject({ config: { bundleId: 'app.omni-os.beta' } });
  });
});
