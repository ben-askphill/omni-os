// Which agent threads may change crew roles. A role is a prompt every later thread of it runs with, with full
// permissions, on every machine that syncs it (sync/handlers/crew-file.ts), so the rules are tighter than the
// automation guard's (automation-guard.ts), whose caller header and lineage they reuse:
// - Ben's own clients name no thread, and may do whatever the store allows (crew-store.ts).
// - An agent may only save or reset a role: the calls the Conductor's crew tools make (plan slice S7). Delete, hide and
//   show stay Ben's, in Settings.
// - Only a thread whose role holds Omni's conductor tools (`mcp: [omni]`: the Conductor) may, and never one an
//   automation started, any thread below one, or a usage scan.
// - Only after Ben answered in that thread: a message of his after its first one, or an answer to a question it asked.
//   The guard cannot read whether he agreed. It holds the rule that the Conductor proposes an edit and waits for him
//   (decision D10 in docs/plans/2026-11-18-user-defined-crew.md), so a brief, a web page or a crew report alone never
//   rewrites a role.
// Like the automation guard, it holds the path agents are told to use, not a determined one.
import { benAnswered, lineage } from './automation-guard.ts';
import { getCrew } from './crew.ts';
import { threads } from './db.ts';
import { userName } from './profile.ts';

export type CrewWrite = 'save' | 'reset' | 'delete' | 'hide';

/** Why the thread `caller` may not make this change to a crew role, or null when it may. No caller is one of Ben's clients. */
export function crewRefusal(caller: string | null | undefined, write: CrewWrite): string | null {
  if (!caller) return null;
  const who = userName();
  if (write === 'delete' || write === 'hide') return `Only ${who} deletes, hides or shows crew roles, in Settings.`;
  const thread = threads.get(caller);
  if (!thread) return 'Crew roles change from Settings, or from the Conductor once the user agrees in its thread.';
  const l = lineage(caller);
  if (l.automation) return `This thread runs under the automation "${l.automation}", and threads an automation started cannot change crew roles. Ask ${who} to do it.`;
  if (l.scan) return 'A usage scan cannot change crew roles.';
  if (!getCrew(thread.role)?.mcp.includes('omni')) return `Crew roles change from Settings, or from the Conductor once ${who} agrees in its thread.`;
  if (!benAnswered(caller)) return `Not yet: propose the change to ${who} in this thread, and save it once they agree.`;
  return null;
}
