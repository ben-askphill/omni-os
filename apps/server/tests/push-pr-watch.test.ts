import { generateKeyPairSync } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { startRunner } from './runner-boot.ts';

// A watched PR that needs attention reaches the iPhone: the PR watch worker wakes the thread, and the paired phone gets
// exactly one APNs alert for it, aimed at that thread, collapsed per thread, and only while its Pull requests switch is
// on. Real pairing, push preferences and sender; only GitHub and APNs are fakes.

const H = await startRunner();
const { app } = await import('../app.ts');
const W = await import('../pr-watch/worker.ts');
const S = await import('../pr-watch/store.ts');
const { createPushSender, installPushSender, pushSenderId } = await import('../push-sender.ts');
const { pushTargets } = await import('../push-preferences.ts');
const { sessionIsLive } = await import('../google-auth.ts');
type ApnsRequest = import('../push-apns.ts').ApnsRequest;

const T = { timeout: 20_000 };
const REPO = 'acme/app';
const MIN = 60_000;
const PEM = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const PHONE_TOKEN = 'cd'.repeat(32);

const req = (method: string, path: string, body: unknown, token: string) =>
  app.request(`http://127.0.0.1:4747/api${path}`, {
    method,
    headers: { host: '127.0.0.1:4747', 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });

/** What reached the fake APNs. */
const apns: ApnsRequest[] = [];
const prAlerts = () => apns.filter((r) => JSON.parse(r.body).omni.kind === 'prAttention');
let phone: { token: string; sessionId: string };

/** A GitHub that answers from `prs`. */
function fakeGitHub() {
  const prs = new Map<number, { state: 'OPEN'; headSha: string; checks: { id: string; name: string; state: string; url: string | null }[] }>();
  const gh = {
    prs,
    now: Date.parse('2026-11-15T10:00:00Z'),
    deps: {
      observe: async (repo: string, number: number) => ({ repo, number, viewer: 'ben', feedback: [], ...structuredClone(prs.get(number)!) }),
      checkLog: async () => 'log',
      now: () => gh.now,
      wake: (r: any) => H.runner.wake(r),
    },
  };
  return gh;
}
const failing = (sha: string) => ({
  state: 'OPEN' as const,
  headSha: sha,
  checks: [{ id: 'CI / build', name: 'CI / build', state: 'FAILURE', url: null }],
});

beforeAll(async () => {
  H.db.channels.update('scratch', { github_repo: REPO });
  const { code } = (await (await req('POST', '/auth/app-pairings', {}, process.env.OMNI_TOKEN!)).json()) as { code: string };
  const redeemed = await app.request('http://127.0.0.1:4747/api/auth/app-pairings/redeem', {
    method: 'POST',
    headers: { host: '127.0.0.1:4747', 'content-type': 'application/json' },
    body: JSON.stringify({ code, name: 'Ben iPhone' }),
  });
  phone = (await redeemed.json()) as typeof phone;
  expect((await req('PUT', '/auth/push-token', { token: PHONE_TOKEN, platform: 'ios', environment: 'production', features: ['collapse', 'prAttention'] }, phone.token)).status).toBe(200);
  installPushSender(
    createPushSender({
      config: { key: { keyId: 'KEY1', teamId: 'TEAM1', pem: PEM }, bundleId: 'app.omni-os.ios' },
      transport: { send: async (r) => (apns.push(r), { status: 200, reason: null }), close() {} },
      targets: pushTargets,
      live: sessionIsLive,
      forget() {},
      now: Date.now,
      senderId: pushSenderId,
      sleep: async () => undefined,
      log() {},
    }),
  );
});

describe('a watched PR on the iPhone', () => {
  it('sends one alert per wake, to the phone, aimed at the thread, and none once its switch is off', T, async () => {
    const gh = fakeGitHub();
    const t = await H.start('build the feature');
    await H.untilResults(t.id, 1);
    gh.prs.set(7, failing('a'.repeat(40)));
    S.prWatches.start(t.id, REPO, 7, null, W.BASE_S, new Date(gh.now).toISOString());

    expect(await W.pollOnce(gh.deps)).toBe(1);
    await vi.waitFor(() => expect(prAlerts()).toHaveLength(1));
    const [sent] = prAlerts();
    expect(sent).toMatchObject({ token: PHONE_TOKEN, environment: 'production', topic: 'app.omni-os.ios', collapseId: t.id });
    const payload = JSON.parse(sent.body);
    expect(payload.omni).toEqual({ kind: 'prAttention', threadId: t.id, channelId: 'scratch', at: expect.any(String), sender: pushSenderId() });
    expect(Date.parse(payload.omni.at)).not.toBeNaN();
    expect(payload.aps.alert).toEqual({ title: H.db.threads.get(t.id)!.title, subtitle: 'Pull request', body: '#7 at aaaaaaa. CI failed: CI / build' });

    // Polled again with nothing new: no second alert.
    await H.untilResults(t.id, 2);
    gh.now += 2 * MIN;
    expect(await W.pollOnce(gh.deps)).toBe(0);
    expect(prAlerts()).toHaveLength(1);

    // Pull requests off on the phone: the next wake still happens, and the phone hears nothing of it.
    expect((await req('PUT', '/auth/push-preferences', { prAttention: false }, phone.token)).status).toBe(200);
    gh.prs.set(7, failing('b'.repeat(40)));
    gh.now += 10 * MIN;
    expect(await W.pollOnce(gh.deps)).toBe(1);
    await H.untilResults(t.id, 3);
    expect(S.prWatches.get(t.id)).toMatchObject({ wakes: 2 });
    expect(prAlerts()).toHaveLength(1);
  });
});
