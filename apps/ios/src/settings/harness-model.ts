import type { HarnessInfo } from '@omni/client-core';
import { localHarnesses } from '@omni/shared/remote-agent.ts';

export interface HarnessRow {
  id: string;
  name: string;
  ready: boolean;
  /** "Max · 4 models · default Opus · 1 of 3 running". */
  detail: string;
  /** How to make one that is not ready run, as the server says it. */
  fix: string | null;
  /** Worth fixing while it runs (Antigravity not seeing ~/.agents/skills). */
  hint: string | null;
}

/**
 * Settings, Models: each local harness with whether it can run, its models and its cap, as the Web UI lists them. A
 * remote agent's server (Hermes, a connected one) belongs to its agent (ADR 0020).
 */
export function harnessRows(list: readonly HarnessInfo[]): HarnessRow[] {
  return localHarnesses(list).map((h) => {
    const def = h.models.find((m) => m.default) ?? h.models[0];
    const detail = [h.plan, `${h.models.length} ${h.models.length === 1 ? 'model' : 'models'}`, def && `default ${def.label}`, `${h.running} of ${h.cap} running`].filter(Boolean).join(' · ');
    return { id: h.id, name: h.name, ready: h.available, detail, fix: h.available ? null : (h.fix ?? h.install ?? null), hint: h.hint ?? null };
  });
}
