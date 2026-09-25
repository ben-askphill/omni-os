// The live catalog: it probes the CLIs at server start and every 15 minutes, keeping the
// last good list when a refresh fails, so the picker never goes empty. The pure assembly
// lives in catalog.ts; this file does the I/O.
import { execFile } from 'node:child_process';
import { config } from '../config.ts';
import { CodexClient } from './codex/client.ts';
import { codexBin } from './codex/bin.ts';
import { normalizeRateLimits } from './codex/normalize.ts';
import type { RateLimits } from './codex/protocol.ts';
import { cursorBin } from './cursor/bin.ts';
import { parseCursorModels } from './cursor/models.ts';
import { harnessEnv } from './env-guard.ts';
import { recordUsage } from '../usage.ts';
import { type HarnessId, type HarnessInfo } from './types.ts';
import { claudeHarness, codexHarness, cursorHarness, type Catalog, type CodexProbe, type CursorProbe } from './catalog.ts';

type Probe = CodexProbe & { rateLimits?: RateLimits };

let current: Catalog | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

const caps = (): Record<HarnessId, number> => ({
  'claude-code': config.maxConcurrent,
  codex: config.maxConcurrentCodex,
  cursor: config.maxConcurrentCursor,
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

/** Probe `codex app-server` for account, config defaults, the model list and rate limits. */
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
        const account = await client.request<{ type?: string; planType?: string }>('account/read').catch(() => null);
        if (!account || (account.type && account.type !== 'chatgpt')) return finish(unavailable);
        const cfg = await client.request<{ model?: string; effort?: string }>('config/read').catch(() => ({} as { model?: string; effort?: string }));
        const list = await client.request<{ models?: any[] }>('model/list');
        const rateLimits = await client.request<RateLimits>('account/rateLimits/read').catch(() => undefined);
        const models = (list?.models ?? []).map((m) => ({
          id: m.id,
          label: m.displayName ?? m.id,
          efforts: m.supportedReasoningEfforts ?? [],
          defaultEffort: m.defaultReasoningEffort,
        }));
        finish({ available: true, planType: account?.planType, defaultModel: cfg?.model, defaultEffort: cfg?.effort, models, rateLimits });
      } catch {
        finish(unavailable);
      }
    })();
  });
}

export async function loadCatalog(): Promise<Catalog> {
  const c = caps();
  const harnesses: HarnessInfo[] = [claudeHarness(c['claude-code'], config.defaultModel)];
  try {
    const probe = await probeCodex();
    harnesses.push(codexHarness(probe, c.codex));
    // Read Codex plan usage at startup and on every refresh; live turns keep it current.
    if (probe.available && probe.rateLimits) recordUsage('codex', normalizeRateLimits(probe.rateLimits));
  } catch {
    harnesses.push(codexHarness({ available: false, models: [] }, c.codex));
  }
  try {
    harnesses.push(cursorHarness(await probeCursor(), c.cursor));
  } catch {
    harnesses.push(cursorHarness({ available: false, models: [] }, c.cursor));
  }
  current = { harnesses };
  return current;
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
    ],
  };
}

export function startCatalogRefresh() {
  void loadCatalog().catch(() => {});
  if (!timer) {
    timer = setInterval(() => void loadCatalog().catch(() => {}), 15 * 60 * 1000);
    timer.unref?.();
  }
}
