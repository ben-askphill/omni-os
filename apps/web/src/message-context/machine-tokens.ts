// A composer's text as the ui-sdk Token Input holds it (components/composer/MessageEditor.tsx): plain runs, and a
// token for each machine or agent Ben picked from the `@` menu. The composer itself keeps the text with `@<name>` in it
// and the draft keeps a machine_mention or agent_mention record per pick (packages/shared/message-context-machine.ts,
// message-context-agent.ts), so what a message carries is the same as before; only the box shows the mention as one chip.
import { toText, type Token, type TokenCodec, type TokenInputValue } from '@ui-sdk/react/token-input';
import { mentionPieces, type MachineIdentity, type MachineMention } from '@omni/shared/message-context-machine.ts';
import { agentMention, type AgentMention } from '@omni/shared/message-context-agent.ts';
import type { MentionAgent } from '@omni/shared/mention-menu.ts';
import type { Reachability } from '@omni/shared/handoff.ts';
import type { MessageContext } from '@omni/shared/message-context.ts';
import { machineMention } from '@omni/shared/message-context-machine.ts';

export const MACHINE_TOKEN = 'machine';
export const AGENT_TOKEN = 'agent';

// A token is written `@<name>`, as the text says it. Pasted text never turns into tokens: a chip only comes from a pick.
export const tokenCodec: TokenCodec = { format: (t) => `@${t.label}`, parse: (text) => [text] };

/** The token for a machine, with what the menu knew of it for the record a token brought back by Undo needs. */
export function machineToken(m: MachineIdentity): Token {
  return { type: MACHINE_TOKEN, value: m.id, label: m.name, data: { reachability: m.reachability, lastSeen: m.lastSeen } };
}

/** The token for an agent: its id, shown by its name. */
export const agentToken = (a: MentionAgent): Token => ({ type: AGENT_TOKEN, value: a.id, label: a.name });

/** The editor value for a composer's `text`: each `@<name>` one of `records` mentions becomes its machine's or agent's token. */
export function editorValue(text: string, records: unknown): TokenInputValue {
  return mentionPieces(text, records).map((p) => {
    if (!p.span) return p.text;
    if (p.span.kind === 'agent') return agentToken({ id: p.span.agent.agent, name: p.text.slice(1) });
    const m: MachineMention = p.span.mention;
    return machineToken({ id: m.machine, name: p.text.slice(1), reachability: m.reachability, lastSeen: m.last_seen });
  });
}

/** The composer's text for an editor value. */
export const editorText = (value: TokenInputValue) => toText(value, tokenCodec);

const REACH: readonly Reachability[] = ['online', 'offline', 'unknown'];

function identity(t: Token): MachineIdentity {
  const reach = t.data?.reachability;
  const seen = t.data?.lastSeen;
  return { id: t.value, name: t.label, reachability: REACH.includes(reach as Reachability) ? (reach as Reachability) : 'unknown', lastSeen: typeof seen === 'string' ? seen : null };
}

/** Each chip of one type in the box, once by its id, and each record of that kind: which records go and which chips need one. */
function reconcile<T>(value: TokenInputValue, records: readonly MessageContext[], type: string, kind: string, idOf: (body: unknown) => unknown, make: (t: Token) => T) {
  const chips = new Map<string, Token>();
  for (const p of value) if (typeof p !== 'string' && p.type === type && !chips.has(p.value)) chips.set(p.value, p);
  const held = new Set<string>();
  const remove: string[] = [];
  for (const r of records) {
    if (r.kind !== kind) continue;
    const id = idOf(r.body);
    if (typeof id === 'string' && chips.has(id) && !held.has(id)) held.add(id);
    else remove.push(r.id);
  }
  const add = [...chips.values()].filter((t) => !held.has(t.value)).map(make);
  return { add, remove };
}

/**
 * What the draft's mention records need after an edit, so they match the chips in the box: a machine or agent whose
 * last chip went loses its record, and a chip with no record (Undo brought it back, or it was pasted) gets one.
 */
export function reconcileMentions(value: TokenInputValue, records: readonly MessageContext[]): { add: MachineIdentity[]; addAgents: MentionAgent[]; remove: string[] } {
  const machines = reconcile(value, records, MACHINE_TOKEN, machineMention.kind, (b) => (b as Partial<MachineMention> | null)?.machine, identity);
  const agents = reconcile(value, records, AGENT_TOKEN, agentMention.kind, (b) => (b as Partial<AgentMention> | null)?.agent, (t) => ({ id: t.value, name: t.label }));
  return { add: machines.add, addAgents: agents.add, remove: [...machines.remove, ...agents.remove] };
}
