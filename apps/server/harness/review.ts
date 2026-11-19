// A review on the other model family: the rule the Conductor's charter carried as prose, as code (plan section 5).
// A thread made as a review role with `review_of: <thread id>` runs on the family that thread did not run on: GPT on
// Codex for work Claude wrote, Claude Code's top model for work any other model wrote. A run on the same family, or a
// thread whose run does not say its family (Cursor's own `auto`), is refused, never guessed. So is a review whose
// pinned model this machine's catalog does not have: Omni never reviews on another model in its place.

import type { Thread } from '../db.ts';
import { userName } from '../profile.ts';
import { GPT_REVIEW_EFFORT, TIERS } from './auto.ts';
import { getHarness, unavailableError, type Catalog } from './catalog.ts';
import { HARNESS_META, isHarnessId, type HarnessId } from './types.ts';

export type ModelFamily = 'claude' | 'other';

interface RunAsked {
  harness?: string | null;
  model?: string | null;
  effort?: string | null;
}

const CLAUDE_MODEL = /^(claude-|opus|sonnet|haiku|fable)/i;
const OTHER_MODEL = /^(gpt-|o\d|composer|grok|gemini)/i;

/**
 * The family a run's model belongs to: Claude, or another (GPT, Composer, Grok, Gemini). Null when the run does not say,
 * as with Cursor's own `auto` or a runtime this build does not know.
 */
export function modelFamily(run: RunAsked): ModelFamily | null {
  const model = run.model?.trim() ?? '';
  if (CLAUDE_MODEL.test(model)) return 'claude';
  if (OTHER_MODEL.test(model)) return 'other';
  if (run.harness === 'claude-code' || run.harness === 'hermes') return 'claude';
  if (run.harness === 'codex') return 'other';
  if ((run.harness === 'cursor' || run.harness === 'cursor-cloud') && model && model !== 'auto') return 'other';
  return null;
}

const FAMILY: Record<ModelFamily, string> = { claude: 'Claude', other: 'a model other than Claude' };

const runName = (r: RunAsked) => [r.harness && isHarnessId(r.harness) ? HARNESS_META[r.harness].name : r.harness, r.model].filter(Boolean).join(' ');

/**
 * The run a review of `reviewed` takes. A run the delegation names is kept when it is on the other family; with none
 * named, the other family's pinned run (REVIEW_RUNS). Refused, with why, on the same family, on a run that does not say
 * its family, and when the pinned run is not available here.
 */
export function reviewRun(asked: RunAsked, reviewed: Pick<Thread, 'id' | 'harness' | 'model'>, cat: Catalog): { run: RunAsked } | { refused: string } {
  const wrote = modelFamily(reviewed);
  if (!wrote) {
    return { refused: `Thread ${reviewed.id} ran on ${runName(reviewed) || 'a run'}, which does not say its model family, so Omni cannot pick the other one. Ask ${userName()} which model reviews it.` };
  }
  if (asked.harness || asked.model) {
    const family = asked.model === 'auto' ? null : modelFamily(asked);
    if (family === wrote) return { refused: `${FAMILY[wrote]} wrote thread ${reviewed.id} (${runName(reviewed)}), so its review runs on the other family. Leave harness, model and effort off and Omni picks it.` };
    if (!family) return { refused: `${runName(asked) || 'Auto'} does not say its model family. Name a model of the other family, or leave the run off and Omni picks it.` };
    return { run: asked };
  }
  return pick(wrote === 'claude' ? 'other' : 'claude', cat);
}

/**
 * The run each family's review takes, pinned: GPT-6.1 Sol at high on Codex for work Claude wrote, Claude Code's top
 * model at its top effort for the rest. Never the harness's configured default or the nearest model or effort: a
 * review on a run other than this one is refused, so the Conductor asks.
 */
export const REVIEW_RUNS: Record<ModelFamily, { harness: HarnessId; model: string; effort: string }> = {
  other: { harness: 'codex', model: 'gpt-6.1-sol', effort: GPT_REVIEW_EFFORT },
  claude: { harness: 'claude-code', model: TIERS.max.claudeModel, effort: TIERS.max.effort },
};

function pick(family: ModelFamily, cat: Catalog): { run: RunAsked } | { refused: string } {
  const want = REVIEW_RUNS[family];
  const h = getHarness(cat, want.harness);
  const name = HARNESS_META[want.harness].name;
  const ask = `Ask ${userName()} how to review it.`;
  if (!h?.available) return { refused: `This review runs on ${family === 'other' ? 'GPT, on Codex' : 'Claude, on Claude Code'}, and ${unavailableError(name, h?.fix)} ${ask}` };
  // No model list for the harness yet: the pinned run goes as it is, and the harness says if it lacks the model.
  if (!h.models.length) return { run: { ...want } };
  const m = h.models.find((x) => x.id === want.model);
  if (!m) return { refused: `This review runs on ${want.model} at ${want.effort}, and ${name} here does not offer ${want.model}. Omni does not review on another model in its place. ${ask}` };
  if (m.efforts.length && !m.efforts.includes(want.effort)) return { refused: `This review runs on ${want.model} at ${want.effort}, and ${name} here does not offer ${want.effort} for it. ${ask}` };
  return { run: { harness: want.harness, model: m.id, effort: m.efforts.length ? want.effort : '' } };
}
