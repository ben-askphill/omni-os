// The live catalog: it probes the CLIs at server start and every 15 minutes, keeping the
// last good list when a refresh fails, so the picker never goes empty. The pure assembly
// lives in catalog.ts; this file does the I/O.
import { config } from '../config.ts';
import { CodexClient } from './codex/client.ts';
import { codexBin } from './codex/bin.ts';
import { harnessEnv } from './env-guard.ts';
import { HARNESS_META, CAPABILITIES, type HarnessId, type HarnessInfo } from './types.ts';
import { claudeHarness, codexHarness, type Catalog, type CodexProbe } from './catalog.ts';

let current: Catalog | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

const caps = (): Record<HarnessId, number> => ({
  'claude-code': config.maxConcurrent,
  codex: config.maxConcurrentCodex,
  cursor: config.maxConcurrentCursor,
});

/** Cursor is wired in its own slice (#14); until then it shows as unavailable. */
function cursorPlaceholder(cap: number): HarnessInfo {
  return {
    id: 'cursor',
    ...HARNESS_META.cursor,
    capabilities: CAPABILITIES.cursor,
    available: false,
    fix: 'cursor-agent login',
    models: [],
    cap,
  };
}

/** Probe `codex app-server` for account, config defaults and the model list. */
export async function probeCodex(bin = codexBin()): Promise<CodexProbe> {
  const unavailable: CodexProbe = { available: false, models: [] };
  if (!bin) return unavailable;
  return await new Promise<CodexProbe>((resolve) => {
    let settled = false;
    const client = new CodexClient({
      bin,
      env: harnessEnv('codex', {}),
      onExit: () => finish(unavailable),
    });
    const finish = (r: CodexProbe) => {
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
        const models = (list?.models ?? []).map((m) => ({
          id: m.id,
          label: m.displayName ?? m.id,
          efforts: m.supportedReasoningEfforts ?? [],
          defaultEffort: m.defaultReasoningEffort,
        }));
        finish({ available: true, planType: account?.planType, defaultModel: cfg?.model, defaultEffort: cfg?.effort, models });
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
    harnesses.push(codexHarness(await probeCodex(), c.codex));
  } catch {
    harnesses.push(codexHarness({ available: false, models: [] }, c.codex));
  }
  harnesses.push(cursorPlaceholder(c.cursor));
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
      cursorPlaceholder(c.cursor),
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
