// The live catalog: it probes the CLIs (and the Hermes and Cursor Cloud APIs) at server start and every 15 minutes.
// A harness that is down is probed again on demand (freshCatalog, at most every 10 seconds), so a
// `codex login` or the Mac joining the tailnet shows in the picker without a restart.
// The pure assembly lives in catalog.ts; this file does the I/O.
import { execFile } from 'node:child_process';
import { config } from '../config.ts';
import { CodexClient } from './codex/client.ts';
import { codexBin } from './codex/bin.ts';
import { PLAN_LIMIT_ID, normalizeRateLimits } from './codex/normalize.ts';
import type {
  CodexModel,
  ConfigReadResponse,
  GetAccountRateLimitsResponse,
  GetAccountResponse,
  ModelListResponse,
  RateLimits,
} from './codex/protocol.ts';
import { cursorBin } from './cursor/bin.ts';
import { parseCursorModels, rememberCursorWindows } from './cursor/models.ts';
import { probeHermes } from './hermes/client.ts';
import { CursorCloudClient, CursorCloudError } from './cursor-cloud/client.ts';
import { harnessEnv } from './env-guard.ts';
import { globalSecret, hasSecret } from '../secrets.ts';
import { channels } from '../db.ts';
import { recordUsage } from '../usage.ts';
import { refreshCursorUsage } from '../cursor-usage.ts';
import { HARNESS_IDS, type HarnessId, type HarnessInfo } from './types.ts';
import {
  claudeHarness,
  codexHarness,
  cursorHarness,
  hermesHarness,
  cursorCloudHarness,
  catalogForChannel,
  getHarness,
  CURSOR_CLOUD_REJECTED,
  CURSOR_CLOUD_UNREACHABLE,
  CODEX_API_KEY,
  CODEX_LOGIN,
  CODEX_NOT_FOUND,
  codexFix,
  type Catalog,
  type CodexProbe,
  type CursorProbe,
  type HermesProbe,
  type CursorCloudProbe,
} from './catalog.ts';

type Probe = CodexProbe & { rateLimits?: RateLimits };

/** How long a harness that is down stays down before a request probes it again. */
const RECHECK_MS = 10_000;

let current: Catalog | null = null;
let loading: Promise<Catalog> | null = null;
let checkedAt = 0;
let timer: ReturnType<typeof setInterval> | null = null;

const caps = (): Record<HarnessId, number> => ({
  'claude-code': config.maxConcurrent,
  codex: config.maxConcurrentCodex,
  cursor: config.maxConcurrentCursor,
  hermes: config.maxConcurrentHermes,
  'cursor-cloud': config.maxConcurrentCursorCloud,
});

/** Probe `cursor-agent --list-models` for the model list. Success means installed and logged in. */
export async function probeCursor(bin = cursorBin()): Promise<CursorProbe> {
  const unavailable: CursorProbe = { available: false, models: [] };
  if (!bin) return unavailable;
  return await new Promise<CursorProbe>((resolve) => {
    execFile(bin, ['--list-models'], { env: harnessEnv('cursor', {}), timeout: 5000 }, (err, stdout) => {
      if (err || !stdout?.trim()) return resolve(unavailable);
      rememberCursorWindows(stdout);
      const models = parseCursorModels(stdout);
      resolve(models.length ? { available: true, models } : unavailable);
    });
  });
}

/** How long the probe waits for Codex to start and answer. The `codex` on PATH can be a wrapper that installs a release first. */
export const CODEX_START_MS = 15_000;
/** How long Codex may then leave a probe request unanswered. */
export const CODEX_SILENCE_MS = 5_000;
/** The most a probe waits in all, however long Codex keeps talking without answering. */
const CODEX_PROBE_CAP_MS = 60_000;

/**
 * Calls `onSilent` when `stream` sends nothing for `ms` after `expect`, counting only time the server could hear it.
 * On a busy machine synchronous disk writes hold the server's thread for seconds, and a timer that comes due meanwhile
 * runs before the poll reads what Codex sent. So the timer looks again after the next poll (setImmediate) and waits
 * another `ms` if anything came in.
 */
function silenceWatch(stream: NodeJS.ReadableStream, onSilent: (method: string, ms: number) => void) {
  const started = Date.now();
  let heard = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let next: ReturnType<typeof setImmediate> | undefined;
  const onData = () => void heard++;
  stream.on('data', onData);
  const clear = () => {
    clearTimeout(timer);
    clearImmediate(next);
  };
  const stop = () => {
    clear();
    stream.off('data', onData);
  };
  const expect = (method: string, ms: number) => {
    clear();
    const seen = heard;
    timer = setTimeout(() => {
      next = setImmediate(() => (heard === seen || Date.now() - started > CODEX_PROBE_CAP_MS ? onSilent(method, ms) : expect(method, ms)));
    }, ms);
  };
  return { expect, stop };
}

/** The last line Codex wrote to stderr, short enough for a fix hint. */
const lastLine = (text: string) => (text.trim().split('\n').pop() ?? '').trim().slice(0, 200);

/**
 * Probe `codex app-server` for the account, config defaults, the model list and rate limits. When Codex can't be
 * used, `fix` says why: signed out, an API key login, no binary, a binary that won't run or exits, or no answer.
 */
export async function probeCodex(
  bin = codexBin(),
  { startMs = CODEX_START_MS, silenceMs = CODEX_SILENCE_MS }: { startMs?: number; silenceMs?: number } = {},
): Promise<Probe> {
  const down = (fix: string): Probe => ({ available: false, models: [], fix });
  if (!bin) return down(CODEX_NOT_FOUND);
  return await new Promise<Probe>((resolve) => {
    let settled = false;
    let stderr = '';
    const client = new CodexClient({
      bin,
      env: harnessEnv('codex', {}),
      onExit: (code, signal) => finish(down(codexFix.exited(code, signal, lastLine(stderr)))),
      onStderr: (chunk) => void (stderr = (stderr + chunk).slice(-2000)),
    });
    // A binary that can't be run (a stale OMNI_CODEX_BIN) is an error event, not an exit.
    client.child.on('error', (e: NodeJS.ErrnoException) => finish(down(codexFix.wontRun(bin, e.code ?? e.message))));
    const watch = silenceWatch(client.child.stdout!, (method, ms) => finish(down(codexFix.silent(method, ms))));
    const finish = (r: Probe) => {
      if (settled) return;
      settled = true;
      watch.stop();
      client.kill();
      resolve(r);
    };
    let method = 'initialize';
    const ask = <T>(m: string, params: unknown, ms = silenceMs) => {
      method = m;
      watch.expect(m, ms);
      return client.request<T>(m, params);
    };
    (async () => {
      try {
        await ask('initialize', { clientInfo: { name: 'omni-os', version: '0.1.0' } }, startMs);
        client.notify('initialized', {});
        // Omni runs Codex on the ChatGPT plan only, so an API key login counts as logged out.
        const { account } = await ask<GetAccountResponse>('account/read', {});
        if (!account) return finish(down(CODEX_LOGIN));
        if (account.type !== 'chatgpt') return finish(down(CODEX_API_KEY));
        const cfg = (await ask<ConfigReadResponse>('config/read', {}).catch(() => null))?.config;
        const listed: CodexModel[] = [];
        let cursor: string | null = null;
        do {
          const page: ModelListResponse = await ask<ModelListResponse>('model/list', { cursor, includeHidden: true });
          listed.push(...page.data);
          cursor = page.nextCursor;
        } while (cursor);
        const rl = await ask<GetAccountRateLimitsResponse>('account/rateLimits/read', {}).catch(() => null);
        // Codex's own picker hides some models; so does Omni's, unless config.toml picks one.
        const models = listed
          .filter((m) => !m.hidden || m.id === cfg?.model)
          .map((m) => ({
            id: m.id,
            label: m.displayName || m.id,
            efforts: m.supportedReasoningEfforts.map((e) => e.reasoningEffort),
            defaultEffort: m.defaultReasoningEffort,
            isDefault: m.isDefault,
          }));
        finish({
          available: true,
          planType: account.planType,
          defaultModel: cfg?.model ?? undefined,
          defaultEffort: cfg?.model_reasoning_effort ?? undefined,
          models,
          rateLimits: rl?.rateLimitsByLimitId?.[PLAN_LIMIT_ID] ?? rl?.rateLimits,
        });
      } catch (e) {
        finish(down(codexFix.failed(method, e instanceof Error ? e.message : String(e))));
      }
    })();
  });
}

async function probeCodexHarness(cap: number): Promise<HarnessInfo> {
  const probe = await probeCodex().catch((e): Probe => ({ available: false, models: [], fix: codexFix.failed('the probe', String(e)) }));
  // Read Codex plan usage at startup and on every refresh; live turns keep it current.
  if (probe.available && probe.rateLimits) recordUsage('codex', normalizeRateLimits(probe.rateLimits));
  return codexHarness(probe, cap);
}

async function probeCursorHarness(cap: number): Promise<HarnessInfo> {
  // Cursor's plan usage and thread costs come from its dashboard, read on the same 15-minute refresh as Codex's.
  // Not awaited: a slow dashboard never holds up the model picker.
  void refreshCursorUsage();
  return cursorHarness(await probeCursor().catch((): CursorProbe => ({ available: false, models: [] })), cap);
}

/** GET /v1/capabilities with the stored bearer token. Missing key or any failure is unavailable. */
export async function probeHermesHarness(cap: number): Promise<HarnessInfo> {
  const unavailable: HermesProbe = { available: false };
  try {
    const key = await globalSecret('HERMES_API_KEY');
    if (!key || !config.hermesUrl) return hermesHarness(unavailable, cap);
    const ok = await probeHermes(config.hermesUrl, key);
    return hermesHarness({ available: ok }, cap);
  } catch {
    return hermesHarness(unavailable, cap);
  }
}

/**
 * GET /v1/models with the global CURSOR_API_KEY: a 200 means the key works, and lists the models to pick from. No key
 * is unavailable with CURSOR_CLOUD_FIX, which a channel's own key can still lift (catalogForChannel).
 */
export async function probeCursorCloud(key: string | null, baseUrl = config.cursorApiUrl): Promise<CursorCloudProbe> {
  if (!key) return { available: false };
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 8000);
  try {
    const { items } = await new CursorCloudClient(key, baseUrl).listModels(ac.signal);
    return { available: true, models: (items ?? []).map((m) => ({ id: m.id, label: m.displayName || m.id })) };
  } catch (e) {
    return { available: false, fix: e instanceof CursorCloudError && e.status === 401 ? CURSOR_CLOUD_REJECTED : CURSOR_CLOUD_UNREACHABLE };
  } finally {
    clearTimeout(t);
  }
}

async function probeCursorCloudHarness(cap: number): Promise<HarnessInfo> {
  const key = await globalSecret('CURSOR_API_KEY').catch(() => null);
  return cursorCloudHarness(await probeCursorCloud(key), cap);
}

/** The catalog as a channel sees it: Cursor Cloud needs its GitHub repo, and can use its own key. Unknown channel: the global one. */
export function channelCatalog(cat: Catalog, channelId: string | null | undefined): Catalog {
  const ch = channelId ? channels.get(channelId) : undefined;
  if (!ch) return cat;
  return catalogForChannel(cat, ch, hasSecret(`channel:${ch.id}`, 'CURSOR_API_KEY'));
}

/**
 * Probe the harnesses in `only` (all by default) and keep the others as they are. A call while
 * a load is running joins that load.
 */
export function loadCatalog(only: HarnessId[] = HARNESS_IDS): Promise<Catalog> {
  loading ??= (async () => {
    const c = caps();
    const keep = (id: HarnessId) => getHarness(getCatalog(), id)!;
    const [codex, cursor, hermes, cursorCloud] = await Promise.all([
      only.includes('codex') ? probeCodexHarness(c.codex) : keep('codex'),
      only.includes('cursor') ? probeCursorHarness(c.cursor) : keep('cursor'),
      only.includes('hermes') ? probeHermesHarness(c.hermes) : keep('hermes'),
      only.includes('cursor-cloud') ? probeCursorCloudHarness(c['cursor-cloud']) : keep('cursor-cloud'),
    ]);
    current = { harnesses: [claudeHarness(c['claude-code'], config.defaultModel), codex, cursor, hermes, cursorCloud] };
    checkedAt = Date.now();
    return current;
  })().finally(() => {
    loading = null;
  });
  return loading;
}

/** The current catalog, or a best-effort default (Claude only) before the first load. */
export function getCatalog(): Catalog {
  if (current) return current;
  const c = caps();
  return {
    harnesses: [
      claudeHarness(c['claude-code'], config.defaultModel),
      codexHarness({ available: false, models: [] }, c.codex),
      cursorHarness({ available: false, models: [] }, c.cursor),
      hermesHarness({ available: false }, c.hermes),
      cursorCloudHarness({ available: false }, c['cursor-cloud']),
    ],
  };
}

/**
 * The catalog after probing again any harness that is down, if it was last probed over
 * RECHECK_MS ago. Waits for a load that is already running. For the picker and thread start.
 */
export async function freshCatalog(): Promise<Catalog> {
  if (loading) return loading;
  const down = getCatalog().harnesses.filter((h) => !h.available).map((h) => h.id);
  if (!down.length || Date.now() - checkedAt < RECHECK_MS) return getCatalog();
  return loadCatalog(down);
}

export function startCatalogRefresh() {
  void loadCatalog().catch(() => {});
  if (!timer) {
    timer = setInterval(() => void loadCatalog().catch(() => {}), 15 * 60 * 1000);
    timer.unref?.();
  }
}
