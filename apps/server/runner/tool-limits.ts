// A local harness that cannot take tools away (`toolLimits` false) cannot run what needs them taken away: a
// delegate-only agent, an agent without file edits, or a read-only thread (a quick ask, a read workspace). Every local
// harness has toolLimits today (Antigravity too, #980: it runs there as far as agy asks), so this refuses nothing yet.
// One check for starting a thread, switching its run and spawning its process, so no path skips it.
import { readsOnly } from '@omni/shared/quick-ask.ts';
import { localDelegateOnlyRefusal, localToolsRefusal, type CrewRole } from '../crew.ts';
import { capabilitiesOf, harnessName } from '../harness/registry.ts';

export function toolLimitRefusal(harness: string, role: Pick<CrewRole, 'name' | 'delegateOnly' | 'tools'> | null | undefined, thread: { quick?: number | boolean | null; workspace?: string | null }): string | null {
  const caps = capabilitiesOf(harness);
  if (!caps || caps.toolLimits || caps.remote !== false) return null;
  if (role?.delegateOnly) return localDelegateOnlyRefusal(role.name, harnessName(harness));
  if (role?.tools === 'no-edits') return localToolsRefusal(`${role.name} runs without file edits, which`, harnessName(harness));
  if (readsOnly({ quick: thread.quick ? 1 : 0, workspace: thread.workspace })) return localToolsRefusal('A quick ask or read-only thread runs read only, which', harnessName(harness));
  return null;
}
