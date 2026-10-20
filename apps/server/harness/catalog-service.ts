// The live catalog: it probes the CLIs (and the Hermes API) at server start and every 15 minutes.
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
import { parseCursorModels } from './cursor/models.ts';
import { probeHermes } from './hermes/client.ts';
import { harnessEnv } from './env-guard.ts';
import { globalSecret } from '../secrets.ts';
import { recordUsage } from '../usage.ts';
import { HARNESS_IDS, type HarnessId, type HarnessInfo } from './types.ts';
import {
  claudeHarness,
  codexHarness,
  cursorHarness,
  hermesHarness,
  getHarness,
  type Catalog,
  type CodexProbe,
  type CursorProbe,
  type HermesProbe,
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
});

/** Probe `cursor-agent --list-models` for the model list. Success means installed and logged in. */
export async function probeCursor(bin = cursorBin()): Promise<CursorProbe> {
  const unavailable: CursorProbe = { available: false, models: [] };
  if (!bin) return unavailable;
  return await new Promise<CursorProbe>((resolve) => {
    execFile(bin, ['--list-models'], { env: harnessEnv('cursor', {}), timeout: 5000 }, (err, stdout) => {
      if (err || !stdout?.trim()) return resolve(unavailable);
      const models = parseCursorModels(stdout);
      resolve(models.length ? { available: true, models } : unavailable);
    });
  });
}

/** Probe `codex app-server` for the account, config defaults, the model list and rate limits. */
export async function probeCodex(bin = codexBin()): Promise<Probe> {
  const unavailable: Probe = { available: false, models: [] };
  if (!bin) return unavailable;
  return await new Promise<Probe>((resolve) => {
    let settled = false;
    const client = new CodexClient({
      bin,
      env: harnessEnv('codex', {}),
      onExit: () => finish(unavailable),
    });
    // A binary that can't be run (a stale OMNI_CODEX_BIN) is an error event, not an exit.
    client.child.on('error', () => finish(unavailable));
    const finish = (r: Probe) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      client.kill();
      resolve(r);
    };
    const timeout = setTimeout(() => finish(unavailable), 5000);
    (async () => {
      try {
        await client.request('initialize', { clientInfo: { name: 'omni-os', version: '0.1.0' } });
        client.notify('initialized', {});
        // Omni runs Codex on the ChatGPT plan only, so an API key login counts as logged out.
        const { account } = await client.request<GetAccountResponse>('account/read', {});
        if (account?.type !== 'chatgpt') return finish(unavailable);
        const cfg = (await client.request<ConfigReadResponse>('config/read', {}).catch(() => null))?.config;
        const listed: CodexModel[] = [];
        let cursor: string | null = null;
        do {
          const page: ModelListResponse = await client.request<ModelListResponse>('model/list', { cursor, includeHidden: true });
          listed.push(...page.data);
          cursor = page.nextCursor;
        } while (cursor);
        const rl = await client.request<GetAccountRateLimitsResponse>('account/rateLimits/read', {}).catch(() => null);
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
      } catch {
        finish(unavailable);
      }
    })();
  });
}

async function probeCodexHarness(cap: number): Promise<HarnessInfo> {
  const probe = await probeCodex().catch((): Probe => ({ available: false, models: [] }));
  // Read Codex plan usage at startup and on every refresh; live turns keep it current.
  if (probe.available && probe.rateLimits) recordUsage('codex', normalizeRateLimits(probe.rateLimits));
  return codexHarness(probe, cap);
}

async function probeCursorHarness(cap: number): Promise<HarnessInfo> {
  return cursorHarness(await probeCursor().catch((): CursorProbe => ({ available: false, models: [] })), cap);
}

/** GET /v1/capabilities with the Keychain bearer token. Missing key or any failure is unavailable. */
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
 * Probe the harnesses in `only` (all by default) and keep the others as they are. A call while
 * a load is running joins that load.
 */
export function loadCatalog(only: HarnessId[] = HARNESS_IDS): Promise<Catalog> {
  loading ??= (async () => {
    const c = caps();
    const keep = (id: HarnessId) => getHarness(getCatalog(), id)!;
    const [codex, cursor, hermes] = await Promise.all([
      only.includes('codex') ? probeCodexHarness(c.codex) : keep('codex'),
      only.includes('cursor') ? probeCursorHarness(c.cursor) : keep('cursor'),
      only.includes('hermes') ? probeHermesHarness(c.hermes) : keep('hermes'),
    ]);
    current = { harnesses: [claudeHarness(c['claude-code'], config.defaultModel), codex, cursor, hermes] };
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
