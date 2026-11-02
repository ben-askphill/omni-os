// Push alerts to the native app. An alert only tells the phone to fetch: the title and a generic body, plus the thread or
// channel id for a deep link. Never the prompt, a question, a thread name or a code. Triggers in the runner call the
// notify functions at the bottom. With no APNs key configured every call is a no-op, and startPush says so once.
import { createPrivateKey } from 'node:crypto';
import { threads, type ThreadStatus } from './db.ts';
import { sessionIsLive } from './google-auth.ts';
import { classify, http2Transport, providerTokens, type ApnsKey, type ApnsResponse, type ApnsTransport } from './push-apns.ts';
import { pushTargets, type PushTarget } from './push-preferences.ts';
import { forgetPushToken } from './push-tokens.ts';
import { globalSecret } from './secrets.ts';
import type { AppPushKind } from '@omni/shared/app-pairing.ts';

export interface PushEvent {
  kind: AppPushKind;
  threadId: string;
  channelId: string | null;
}

/** Secret names (secret store first, then an environment variable of the same name). Values are never logged. */
export const PUSH_SECRETS = {
  keyId: 'APNS_KEY_ID',
  teamId: 'APNS_TEAM_ID',
  key: 'APNS_AUTH_KEY',
  bundleId: 'APNS_BUNDLE_ID',
} as const;
export const DEFAULT_BUNDLE_ID = 'app.omni-os.ios';

/** Apple stops trying an alert it has not delivered after this long, so a stale alert is never delivered late. */
const ALERT_TTL_S = 15 * 60;
/**
 * Requests in flight at once. APNs has no batch endpoint, so a fan-out to many devices is one request per device, with
 * at most this many open on the shared HTTP/2 session.
 */
const CONCURRENCY = 10;
const MAX_ATTEMPTS = 3;
const backoffMs = (attempt: number) => 500 * 2 ** (attempt - 1);

export interface PushConfig {
  key: ApnsKey;
  bundleId: string;
}

/** The config, or the reason there is none. The reason names secrets and never shows a value. */
export function loadPushConfig(read: (name: string) => string | null | undefined): { config: PushConfig } | { problem: string } {
  const keyId = read(PUSH_SECRETS.keyId)?.trim() ?? '';
  const teamId = read(PUSH_SECRETS.teamId)?.trim() ?? '';
  const pem = (read(PUSH_SECRETS.key) ?? '').replace(/\\n/g, '\n').trim();
  const missing = [
    !keyId && PUSH_SECRETS.keyId,
    !teamId && PUSH_SECRETS.teamId,
    !pem && PUSH_SECRETS.key,
  ].filter(Boolean) as string[];
  if (missing.length) return { problem: `missing ${missing.join(', ')}` };
  try {
    createPrivateKey(pem);
  } catch {
    return { problem: `${PUSH_SECRETS.key} is not a P-256 private key` };
  }
  return { config: { key: { keyId, teamId, pem }, bundleId: read(PUSH_SECRETS.bundleId)?.trim() || DEFAULT_BUNDLE_ID } };
}

export interface PushSenderDeps {
  config: PushConfig;
  transport: ApnsTransport;
  /** Devices that should hear about this kind now: live sessions with the preference on. Read at enqueue time. */
  targets(kind: AppPushKind): PushTarget[];
  /** Read again before each attempt, so a session revoked while queued gets nothing. */
  live(sessionId: string): boolean;
  /** Drop the registration for a token Apple says is dead. */
  forget(token: string): unknown;
  now(): number;
  sleep(ms: number): Promise<void>;
  log(line: string): void;
}

export interface PushSender {
  readonly configured: boolean;
  /** Fire and forget. Errors are logged, never thrown into the caller. */
  send(event: PushEvent): void;
}

const ALERTS: Record<AppPushKind, { title: string; body: string }> = {
  needsInput: { title: 'Omni needs you', body: 'A thread is waiting for your answer.' },
  finished: { title: 'Thread finished', body: 'Open Omni to see the result.' },
  failed: { title: 'Thread failed', body: 'Open Omni to see what happened.' },
  crewReport: { title: 'Crew report', body: 'A crew member reported back in Conductor.' },
};

export function payloadFor(event: PushEvent): string {
  return JSON.stringify({
    aps: { alert: ALERTS[event.kind], sound: 'default' },
    omni: { kind: event.kind, threadId: event.threadId, channelId: event.channelId },
  });
}

/** Runs at most `limit` calls at once. A call past the limit waits its turn. */
function pool(limit: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  const release = () => {
    active--;
    waiting.shift()?.();
  };
  return <T>(fn: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const start = () => {
        active++;
        fn().then(resolve, reject).finally(release);
      };
      if (active < limit) start();
      else waiting.push(start);
    });
}

export function createPushSender(deps: PushSenderDeps): PushSender {
  const tokens = providerTokens(deps.config.key, deps.now);
  const run = pool(CONCURRENCY);

  async function deliver(t: PushTarget, body: string, attempt = 1): Promise<void> {
    if (!deps.live(t.sessionId)) return;
    const expiration = Math.floor(deps.now() / 1000) + ALERT_TTL_S;
    let res: ApnsResponse;
    try {
      res = await deps.transport.send({
        environment: t.environment,
        token: t.token,
        topic: t.bundleId ?? deps.config.bundleId,
        jwt: tokens.get(),
        body,
        expiration,
      });
    } catch {
      res = { status: 0, reason: 'network' };
    }
    const action = classify(res.status, res.reason);
    if (action === 'delivered') return;
    if (action === 'refresh' && attempt === 1) {
      tokens.refresh();
      return deliver(t, body, 2);
    }
    if (action === 'retry' && attempt < MAX_ATTEMPTS) {
      await deps.sleep(backoffMs(attempt));
      return deliver(t, body, attempt + 1);
    }
    if (action === 'forget') deps.forget(t.token);
    // The token itself stays out of the log: a status and a reason are enough to act on.
    deps.log(`[push] APNs ${res.status}${res.reason ? ` ${res.reason}` : ''} (${action}, ${t.environment})`);
  }

  return {
    configured: true,
    send(event) {
      const targets = deps.targets(event.kind);
      if (!targets.length) return;
      const body = payloadFor(event);
      for (const t of targets) run(() => deliver(t, body)).catch((err: Error) => deps.log(`[push] ${err.message}`));
    },
  };
}

export const noopPushSender: PushSender = { configured: false, send() {} };

let installed: PushSender = noopPushSender;

export function installPushSender(sender: PushSender) {
  installed = sender;
}

/** Whether alerts can go out. GET /api/capabilities reports it as push.delivery. */
export const pushDelivery = () => installed.configured;

/** Reads the config once, installs the sender, and logs why it did not when the config is missing. Restart to change it. */
export async function startPush(): Promise<void> {
  const values: Record<string, string | null> = {};
  for (const name of Object.values(PUSH_SECRETS)) {
    values[name] = (await globalSecret(name).catch(() => null)) ?? process.env[name] ?? null;
  }
  const loaded = loadPushConfig((name) => values[name]);
  if ('problem' in loaded) {
    console.log(`[push] not configured, no alerts will be sent: ${loaded.problem}`);
    return;
  }
  installPushSender(
    createPushSender({
      config: loaded.config,
      transport: http2Transport(),
      targets: pushTargets,
      live: sessionIsLive,
      forget: forgetPushToken,
      now: Date.now,
      sleep: (ms) =>
        new Promise((done) => {
          setTimeout(done, ms).unref();
        }),
      log: (line) => console.log(line),
    }),
  );
  console.log(`[push] APNs alerts on for bundle ${loaded.config.bundleId}`);
}

function emit(event: PushEvent) {
  try {
    installed.send(event);
  } catch (err) {
    console.error('[push] could not queue an alert:', (err as Error).message);
  }
}

/** The agent asked a question and waits for an answer. */
export function notifyNeedsInput(threadId: string) {
  emit({ kind: 'needsInput', threadId, channelId: threads.get(threadId)?.channel_id ?? null });
}

/**
 * A turn ended. Done or failed only; stopped and queued are silent. A finished child is already reported to its parent,
 * so only a failed child alerts.
 */
export function notifyEnded(threadId: string, status: ThreadStatus) {
  if (status !== 'done' && status !== 'failed') return;
  const t = threads.get(threadId);
  if (status === 'done' && t?.parent_id) return;
  emit({ kind: status === 'done' ? 'finished' : 'failed', threadId, channelId: t?.channel_id ?? null });
}

/** A crew report landed in a thread. Only the Conductor's reports alert: that is where Ben reads them. */
export function notifyCrewReport(parentId: string) {
  const t = threads.get(parentId);
  if (t?.channel_id !== 'conductor') return;
  emit({ kind: 'crewReport', threadId: parentId, channelId: t.channel_id });
}
