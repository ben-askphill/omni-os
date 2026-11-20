// The live catalog: it asks each harness for its models (Claude Code's `initialize` answer, Codex's model/list,
// `cursor-agent --list-models`, Cursor's /v1/models) at server start and every 15 minutes, the way T3 Code does, so a
// model that ships in a CLI release shows without an Omni release.
// - A harness that is down is probed again on demand (freshCatalog, at most every 10 seconds), so a `codex login` or
//   the Mac joining the tailnet shows in the picker without a restart.
// - A picker opening on a catalog older than ON_DEMAND_MS probes everything again in the background (refreshStale), as
//   T3 Code's picker asks for newly released models on every open. Settings > Models can ask at once.
// - What Claude Code last reported is kept on disk, so a restart starts from it, not from the bundled list alone.
// - Custom harnesses (custom.ts) are listed from their files on every read, so a new, changed or deleted file shows at
//   once. Only their probe answers are kept here, by URL and secret name, so a changed address is checked again.
// The pure assembly lives in catalog.ts; this file does the I/O.
import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config, paths } from '../config.ts';
import { claudeInitialize } from './claude/commands.ts';
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
import { probeRemote, probeRoute } from './remote.ts';
import { customHarnesses, type CustomHarness } from './custom.ts';
import { CursorCloudClient, CursorCloudError } from './cursor-cloud/client.ts';
import { harnessEnv } from './env-guard.ts';
import { globalSecret, hasSecret } from '../secrets.ts';
import { channels } from '../db.ts';
import { recordUsage } from '../usage.ts';
import { refreshCursorUsage } from '../cursor-usage.ts';
import { type HarnessId, type HarnessInfo } from './types.ts';
import {
  claudeHarness,
  claudeProbeOf,
  customHarnessInfo,
  UNCHECKED_FIX,
  codexHarness,
  cursorHarness,
  hermesHarness,
  cursorCloudHarness,
  catalogForChannel,
  getHarness,
  parseClaudeReported,
  CURSOR_CLOUD_REJECTED,
  CURSOR_CLOUD_UNREACHABLE,
  CODEX_API_KEY,
  CODEX_LOGIN,
  CODEX_NOT_FOUND,
  codexFix,
  type Catalog,
  type ClaudeProbe,
  type ClaudeReportedModel,
  type CodexProbe,
  type CursorProbe,
  type HermesProbe,
  type CursorCloudProbe,
  type CustomProbe,
} from './catalog.ts';

type Probe = CodexProbe & { rateLimits?: RateLimits };

/** How long a harness that is down stays down before a request probes it again. */
const RECHECK_MS = 10_000;
/** How old a catalog may be when a picker opens before every harness is asked again (T3 Code: 5 minutes). */
export const ON_DEMAND_MS = 5 * 60 * 1000;

let current: Catalog | null = null;
let loading: Promise<Catalog> | null = null;
let checkedAt = 0;
/** When every harness was last probed, for refreshStale. */
let fullAt = 0;
let timer: ReturnType<typeof setInterval> | null = null;

const caps = (): Record<HarnessId, number> => ({
  'claude-code': config.maxConcurrent,
  codex: config.maxConcurrentCodex,
  cursor: config.maxConcurrentCursor,
  hermes: config.maxConcurrentHermes,
  'cursor-cloud': config.maxConcurrentCursorCloud,
});

/** What Claude Code reported when Omni last asked, here or before a restart. Empty: the bundled list alone. */
let claudeReported: ClaudeReportedModel[] | null = null;
const claudeCache = () => join(paths.data, 'claude-models.json');

function lastClaudeModels(): ClaudeReportedModel[] {
  if (claudeReported) return claudeReported;
  try {
    claudeReported = parseClaudeReported((JSON.parse(readFileSync(claudeCache(), 'utf8')) as { models?: unknown }).models);
  } catch {
    claudeReported = [];
  }
  return claudeReported;
}

/**
 * Ask Claude Code which models it offers: the `models` of its `initialize` answer, which a new Claude Code release
 * extends. Nothing goes to the API. Null when it doesn't answer.
 */
export async function probeClaudeModels(): Promise<ClaudeReportedModel[] | null> {
  const init = await claudeInitialize(paths.data, 'omni-os-models');
  return init ? parseClaudeReported(init.models) : null;
}

/** How long `claude auth status` may take. It reads local credentials and makes no model call. */
const CLAUDE_AUTH_MS = 8_000;

/**
 * `claude auth status --json`, run with the environment a thread's Claude Code gets: its stdout (null when it did not
 * answer), or `missing` when there is no claude to run. It exits non-zero when signed out, and its stdout still
 * answers. The catalog probe and the first run's Claude Code step (claude-setup.ts) both read it.
 */
export function claudeAuthStatus(bin = config.claudeBin): Promise<{ stdout: string | null; missing: boolean }> {
  return new Promise((resolve) => {
    execFile(bin, ['auth', 'status', '--json'], { env: harnessEnv('claude-code', {}), timeout: CLAUDE_AUTH_MS, maxBuffer: 256 * 1024, killSignal: 'SIGKILL' }, (err, stdout) => {
      const code = (err as NodeJS.ErrnoException | null)?.code;
      resolve({ stdout: stdout?.trim() ? stdout : null, missing: code === 'ENOENT' || code === 'EACCES' });
    });
  });
}

/** Whether Claude Code is installed and signed in, the way Codex and Cursor are probed. */
export const probeClaudeAuth = async (bin = config.claudeBin): Promise<ClaudeProbe> => claudeProbeOf(await claudeAuthStatus(bin));

/** The last probe, so a catalog rebuilt without probing keeps it. Available until the first answer. */
let claudeAuth: ClaudeProbe = { available: true };

/** Claude Code with what it reports now, or with what it reported last when it does not answer. */
async function probeClaudeHarness(cap: number): Promise<HarnessInfo> {
  claudeAuth = await probeClaudeAuth().catch((): ClaudeProbe => ({ available: true }));
  if (!claudeAuth.available) return claudeHarness(cap, config.defaultModel, lastClaudeModels(), claudeAuth);
  const reported = await probeClaudeModels().catch(() => null);
  if (reported) {
    claudeReported = reported;
    try {
      writeFileSync(claudeCache(), JSON.stringify({ checkedAt: new Date().toISOString(), models: reported }, null, 2));
    } catch {
      // A read-only data dir only costs the head start after a restart.
    }
  }
  return claudeHarness(cap, config.defaultModel, lastClaudeModels(), claudeAuth);
}

/**
 * Probe `cursor-agent --list-models` for the model list. Success means installed and logged in. No binary on PATH, or
 * an OMNI_CURSOR_BIN that is not there, is `missing`; any other failure reads as signed out.
 */
export async function probeCursor(bin = cursorBin()): Promise<CursorProbe> {
  const unavailable: CursorProbe = { available: false, models: [] };
  if (!bin) return { ...unavailable, missing: true };
  return await new Promise<CursorProbe>((resolve) => {
    execFile(bin, ['--list-models'], { env: harnessEnv('cursor', {}), timeout: 5000 }, (err, stdout) => {
      if ((err as NodeJS.ErrnoException | null)?.code === 'ENOENT') return resolve({ ...unavailable, missing: true });
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
  if (!bin) return { ...down(CODEX_NOT_FOUND), missing: true };
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
  const url = config.hermesUrl;
  try {
    const key = await globalSecret('HERMES_API_KEY');
    if (!key || !url) return hermesHarness(unavailable, cap, url);
    const ok = await probeHermes(url, key);
    return hermesHarness({ available: ok }, cap, url);
  } catch {
    return hermesHarness(unavailable, cap, url);
  }
}

/** The probe answers for custom harnesses, by id, URL and secret name: a changed file is checked again. */
const customProbes = new Map<string, CustomProbe>();
const probeKey = (h: CustomHarness) => `${h.id}\n${h.url}\n${h.secret}`;

/**
 * The signed-in probe (GET /v1/capabilities, or an eve agent's GET /eve/v1/info) on a custom harness's server with the key from this machine's secret store. The key is the
 * global secret the file names: a harness is not per channel. Each failure says what to fix.
 */
export async function probeCustomHarness(h: CustomHarness): Promise<CustomProbe> {
  if (h.error) return { available: false, fix: h.error };
  const key = await globalSecret(h.secret).catch(() => null);
  if (!key) return { available: false, fix: `Key not on this machine: set ${h.secret} in Secrets to the server's key` };
  const probe = await probeRemote(h.kind, h.url, key);
  if (probe.state === 'ok') return { available: true };
  if (probe.state === 'rejected') return { available: false, fix: `${h.host} refused the key in ${h.secret}. Replace it in Secrets` };
  if (probe.state === 'status') return { available: false, fix: `${h.host} answered HTTP ${probe.status} to ${probeRoute(h.kind)}. Check the URL points at ${h.kind === 'eve' ? 'the eve agent' : 'a Runs API server'}` };
  return { available: false, fix: `Could not reach ${h.host}. Check the URL, and that this machine can reach it (on the tailnet, or over HTTPS)` };
}

/** Probe one custom harness now, outside any running load: a save checks the harness it wrote. Null when it has no file. */
export async function checkCustomHarness(id: string): Promise<HarnessInfo | null> {
  const h = customHarnesses().find((x) => x.id === id);
  if (!h) return null;
  const probe = await probeCustomHarness(h);
  customProbes.set(probeKey(h), probe);
  return customHarnessInfo(h, probe);
}

/** Every custom harness on this machine, with its last probe answer. */
const customEntries = (): HarnessInfo[] => customHarnesses().map((h) => customHarnessInfo(h, customProbes.get(probeKey(h)) ?? { available: false, fix: UNCHECKED_FIX }));

/** Probe the custom harnesses `only` names (all by default), and forget answers for files that are gone or changed. */
async function probeCustoms(only?: readonly string[]) {
  const files = customHarnesses();
  const live = new Set(files.map(probeKey));
  for (const k of customProbes.keys()) if (!live.has(k)) customProbes.delete(k);
  await Promise.all(files.filter((h) => !only || only.includes(h.id)).map(async (h) => customProbes.set(probeKey(h), await probeCustomHarness(h))));
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
 * Probe the harnesses in `only` (all by default, custom ones included) and keep the others as they are. A call while
 * a load is running joins that load, so a probe it did not ask for may not run: call again after it settles.
 */
export function loadCatalog(only?: readonly string[]): Promise<Catalog> {
  loading ??= (async () => {
    const c = caps();
    const asks = (id: HarnessId) => !only || only.includes(id);
    const keep = (id: HarnessId) => getHarness(getCatalog(), id)!;
    const [claude, codex, cursor, hermes, cursorCloud] = await Promise.all([
      asks('claude-code') ? probeClaudeHarness(c['claude-code']) : keep('claude-code'),
      asks('codex') ? probeCodexHarness(c.codex) : keep('codex'),
      asks('cursor') ? probeCursorHarness(c.cursor) : keep('cursor'),
      asks('hermes') ? probeHermesHarness(c.hermes) : keep('hermes'),
      asks('cursor-cloud') ? probeCursorCloudHarness(c['cursor-cloud']) : keep('cursor-cloud'),
      probeCustoms(only),
    ]);
    current = { harnesses: [claude, codex, cursor, hermes, cursorCloud] };
    checkedAt = Date.now();
    if (!only) fullAt = checkedAt;
    return getCatalog();
  })().finally(() => {
    loading = null;
  });
  return loading;
}

/** The current catalog, or a best-effort default (Claude only) before the first load. Custom harnesses come last. */
export function getCatalog(): Catalog {
  const c = caps();
  const builtIns = current?.harnesses ?? [
    claudeHarness(c['claude-code'], config.defaultModel, lastClaudeModels(), claudeAuth),
    codexHarness({ available: false, models: [] }, c.codex),
    cursorHarness({ available: false, models: [] }, c.cursor),
    hermesHarness({ available: false }, c.hermes, config.hermesUrl),
    cursorCloudHarness({ available: false }, c['cursor-cloud']),
  ];
  return { harnesses: [...builtIns, ...customEntries()] };
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

/**
 * For a picker opening: when every harness was last asked over ON_DEMAND_MS ago, ask them all again in the background.
 * The open picker shows the catalog as it is; the next one shows what the probes found.
 */
export function refreshStale(now = Date.now()) {
  if (loading || now - fullAt < ON_DEMAND_MS) return;
  void loadCatalog().catch(() => {});
}

export function startCatalogRefresh() {
  void loadCatalog().catch(() => {});
  if (!timer) {
    timer = setInterval(() => void loadCatalog().catch(() => {}), 15 * 60 * 1000);
    timer.unref?.();
  }
}
