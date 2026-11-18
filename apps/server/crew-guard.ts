// Which agent threads may change crew roles. A role is a prompt every later thread of it runs with, with full
// permissions, on every machine that syncs it (sync/handlers/crew-file.ts), so the rules are tighter than the
// automation guard's (automation-guard.ts), whose caller header and lineage they reuse:
// - Ben's own clients name no thread, and may do whatever the store allows (crew-store.ts).
// - An agent may only save or reset a role: the calls the Conductor's crew tools make (plan slice S7). Duplicate, delete,
//   hide and show stay Ben's, in Settings.
// - Only a thread running as the Conductor may: the reserved id, whose powers no save can change (crew-store.ts). Never
//   one an automation started, any thread below one, or a usage scan.
// - A save from an agent changes charters, descriptions, run defaults and default channels, never powers: no `mcp`,
//   `delegate_only` or `delegatable`, and no whole-file markdown, which could set them. So no save an agent makes can
//   hand another role the conductor tools, or route around this guard.
// - Only after Ben answered in that thread: a message of his after its first one, or an answer to a question it asked.
//   An agent's own call never counts as his: the message routes record it as the Conductor's, and the question routes
//   refuse its answer. The guard cannot read whether he agreed. It holds the rule that the Conductor proposes an edit
//   and waits for him (decision D10 in docs/plans/2026-11-18-user-defined-crew.md), so a brief, a web page or a crew
//   report alone never rewrites a role.
// Like the automation guard, it holds the path agents are told to use, not a determined one.
import { benAnswered, lineage } from './automation-guard.ts';
import type { CrewSave } from './crew-store.ts';
import { threads } from './db.ts';
import { userName } from './profile.ts';

export type CrewWrite = 'save' | 'reset' | 'duplicate' | 'delete' | 'hide';

/** The writes that stay Ben's: no tool an agent has makes them. A duplicate copies a role's powers with it. */
const BENS: Partial<Record<CrewWrite, string>> = { duplicate: 'duplicates', delete: 'deletes', hide: 'hides or shows' };

/** The crew role whose threads may change roles, once Ben agrees. */
const EDITOR_ROLE = 'conductor';

/** Frontmatter keys that give a role its powers. Only Ben sets them. */
const POWERS = ['mcp', 'delegate_only', 'delegatable', 'review'] as const;

/**
 * Why the thread `caller` may not make this change to a crew role, or null when it may. No caller is one of Ben's
 * clients. `save` is the body of a save, when there is one.
 */
export function crewRefusal(caller: string | null | undefined, write: CrewWrite, save?: CrewSave): string | null {
  if (!caller) return null;
  const who = userName();
  const bens = BENS[write];
  if (bens) return `Only ${who} ${bens} crew roles, in Settings.`;
  const thread = threads.get(caller);
  const settings = `Crew roles change from Settings, or from the Conductor once ${who} agrees in its thread.`;
  if (!thread) return settings;
  const l = lineage(caller);
  if (l.automation) return `This thread runs under the automation "${l.automation}", and threads an automation started cannot change crew roles. Ask ${who} to do it.`;
  if (l.scan) return 'A usage scan cannot change crew roles.';
  if (thread.role !== EDITOR_ROLE) return settings;
  if (save && 'markdown' in save) return `Send the fields and charter to change, not the whole file: a role's powers are ${who}'s to set, in Settings.`;
  const powers = POWERS.filter((k) => save && 'fields' in save && save.fields?.[k] !== undefined);
  if (powers.length) return `${powers.join(', ')} ${powers.length === 1 ? 'is' : 'are'} ${who}'s to set, in Settings. Leave ${powers.length === 1 ? 'it' : 'them'} out of the save.`;
  if (!benAnswered(caller)) return `Not yet: propose the change to ${who} in this thread, and save it once they agree.`;
  return null;
}
