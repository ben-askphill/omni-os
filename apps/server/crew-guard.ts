// Which agent threads may change crew roles. A role is a prompt every later thread of it runs with, with full
// permissions, on every machine that syncs it (sync/handlers/crew-file.ts), so the rules are tighter than the
// automation guard's (automation-guard.ts), whose caller header and lineage they reuse:
// - Ben's own clients name no thread, and may do whatever the store allows (crew-store.ts).
// - An agent may only save or reset a role: the calls the Conductor's crew tools make (plan slice S7). Duplicate, delete,
//   hide and show stay Ben's, in Settings.
// - Only a thread running as the Conductor may: the reserved id, whose powers no save can change (crew-store.ts). Never
//   one an automation started, any thread below one, or a usage scan.
// - A save from an agent changes charters, descriptions, run defaults and default channels, never powers: no `mcp`,
//   `delegate_only`, `tools`, `delegatable`, `review`, `memory` or `memory_writes`, and no whole-file markdown, which
//   could set them. So no save an agent makes can hand another role the conductor tools, lift a reviewer's no-edits,
//   let a role keep its own lessons at once, or route around this guard. A reset that would change a role's powers
//   (Ben gave the built-in `delegate_only` in his overlay, say) is refused for the same reason.
// - Only after Ben answered in that thread: a message of his after its first one, or an answer to a question it asked.
//   An agent's own call never counts as his: the message routes record it as the Conductor's, and the question routes
//   refuse its answer. The guard cannot read whether he agreed. It holds the rule that the Conductor proposes an edit
//   and waits for him (decision D10 in docs/plans/2026-11-18-user-defined-crew.md), so a brief, a web page or a crew
//   report alone never rewrites a role.
// Like the automation guard, it holds every path Omni gives a thread (its own token), not one that reads the install
// token from disk, which only the OS sandbox closes.
import { benAnswered, lineage } from './automation-guard.ts';
import { crewTexts, getCrew, parseCrewFile, type CrewRole } from './crew.ts';
import type { CrewSave } from './crew-store.ts';
import { threads } from './db.ts';
import { userName } from './profile.ts';

export type CrewWrite = 'save' | 'reset' | 'duplicate' | 'delete' | 'hide' | 'avatar';

/** The writes that stay Ben's: no tool an agent has makes them. A duplicate copies a role's powers with it. */
const BENS: Partial<Record<CrewWrite, string>> = { duplicate: 'duplicates', delete: 'deletes', hide: 'hides or shows', avatar: 'sets the avatar of' };

/** The crew role whose threads may change roles, once Ben agrees. */
const EDITOR_ROLE = 'conductor';

/** Frontmatter keys that give a role its powers. Only Ben sets them. */
const POWERS = ['mcp', 'delegate_only', 'tools', 'delegatable', 'review', 'memory', 'memory_writes'] as const;

/** A role's powers as they compare: by frontmatter key. */
const powersOf = (r: CrewRole): Record<(typeof POWERS)[number], unknown> => ({
  mcp: [...r.mcp].sort(),
  delegate_only: r.delegateOnly,
  tools: r.tools,
  delegatable: r.delegatable,
  review: r.review,
  memory: r.memory,
  memory_writes: r.memoryWrites,
});

/** The powers resetting role `id` would change: the ones the user's overlay sets differently from the built-in. */
function resetPowers(id: string): string[] {
  const now = getCrew(id);
  const { shipped } = crewTexts(id);
  if (!now || shipped === null) return [];
  const before = powersOf(now);
  const after = powersOf(parseCrewFile(id, shipped));
  const differs = (k: (typeof POWERS)[number]) => JSON.stringify(before[k]) !== JSON.stringify(after[k]);
  // Delegate-only is both keys' doing: name it once.
  return POWERS.filter((k) => differs(k) && !(k === 'tools' && differs('delegate_only')));
}

const listed = (keys: string[]) => `${keys.join(', ')} ${keys.length === 1 ? 'is' : 'are'}`;

/**
 * Why the thread `caller` may not make this change to a crew role, or null when it may. No caller is one of Ben's
 * clients. `save` is the body of a save, when there is one; `id` the role a reset is for.
 */
export function crewRefusal(caller: string | null | undefined, write: CrewWrite, save?: CrewSave, id?: string): string | null {
  if (!caller) return null;
  const who = userName();
  const bens = BENS[write];
  if (bens) return `Only ${who} ${bens} agents, in Settings.`;
  const thread = threads.get(caller);
  const settings = `Agents change from Settings, or from the Conductor once ${who} agrees in its thread.`;
  if (!thread) return settings;
  const l = lineage(caller);
  if (l.automation) return `This thread runs under the automation "${l.automation}", and threads an automation started cannot change agents. Ask ${who} to do it.`;
  if (l.scan) return 'A usage scan cannot change agents.';
  if (thread.role !== EDITOR_ROLE) return settings;
  if (save && 'markdown' in save) return `Send the fields and charter to change, not the whole file: an agent's powers are ${who}'s to set, in Settings.`;
  const powers = POWERS.filter((k) => save && 'fields' in save && save.fields?.[k] !== undefined);
  if (powers.length) return `${listed(powers)} ${who}'s to set, in Settings. Leave ${powers.length === 1 ? 'it' : 'them'} out of the save.`;
  const reset = write === 'reset' && id ? resetPowers(id) : [];
  if (reset.length) return `Resetting ${getCrew(id)?.name ?? id} would change its ${reset.join(', ')}, which ${reset.length === 1 ? 'is' : 'are'} ${who}'s to set. Ask ${who} to reset it in Settings.`;
  if (!benAnswered(caller)) return `Not yet: propose the change to ${who} in this thread, and save it once they agree.`;
  return null;
}
