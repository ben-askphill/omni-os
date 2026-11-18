// A review on the other model family: the rule the Conductor's charter carried as prose, as code (plan section 5).
// A thread made as a review role with `review_of: <thread id>` runs on the family that thread did not run on: GPT on
// Codex for work Claude wrote, Claude Code's top model for work any other model wrote. A run on the same family, or a
// thread whose run does not say its family (Cursor's own `auto`), is refused, never guessed.

import type { Thread } from '../db.ts';
import { userName } from '../profile.ts';
import { GPT_REVIEW_EFFORT, nearestEffort, TIERS } from './auto.ts';
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
 * named, the other family's pick. Refused, with why, on the same family, on a run that does not say its family, and
 * when the other family's harness is not available here.
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
  return pick(wrote === 'claude' ? 'other' : 'claude', asked.effort, cat);
}

/** The other family's run: Codex's default model at the GPT review effort, or Claude Code's top tier. */
function pick(family: ModelFamily, effort: string | null | undefined, cat: Catalog): { run: RunAsked } | { refused: string } {
  const harness: HarnessId = family === 'other' ? 'codex' : 'claude-code';
  const want = effort || (family === 'other' ? GPT_REVIEW_EFFORT : TIERS.max.effort);
  const h = getHarness(cat, harness);
  if (!h?.available) {
    const where = family === 'other' ? 'GPT, on Codex' : 'Claude, on Claude Code';
    return { refused: `This review runs on ${where}, and ${unavailableError(HARNESS_META[harness].name, h?.fix)} Ask ${userName()} how to review it.` };
  }
  const m = family === 'other' ? (h.models.find((x) => x.default) ?? h.models[0]) : (h.models.find((x) => x.id === TIERS.max.claudeModel) ?? h.models.find((x) => x.default) ?? h.models[0]);
  // No model list for the harness yet: name the harness and let the resolver pass it through.
  if (!m) return { run: { harness, effort: want } };
  return { run: { harness, model: m.id, effort: nearestEffort(m, want) } };
}
