// A composer's text as the ui-sdk Token Input holds it (components/composer/MessageEditor.tsx): plain runs, and a
// token for each machine Ben picked from the `@` menu. The composer itself keeps the text with `@<name>` in it and the
// draft keeps a machine_mention record per machine (packages/shared/message-context-machine.ts), so what a message
// carries is the same as before; only the box shows the mention as one chip.
import { toText, type Token, type TokenCodec, type TokenInputValue } from '@ui-sdk/react/token-input';
import { mentionPieces, type MachineIdentity, type MachineMention } from '@omni/shared/message-context-machine.ts';
import type { Reachability } from '@omni/shared/handoff.ts';
import type { MessageContext } from '@omni/shared/message-context.ts';
import { machineMention } from '@omni/shared/message-context-machine.ts';

export const MACHINE_TOKEN = 'machine';

// A token is written `@<name>`, as the text says it. Pasted text never turns into tokens: a chip only comes from a pick.
export const tokenCodec: TokenCodec = { format: (t) => `@${t.label}`, parse: (text) => [text] };

/** The token for a machine, with what the menu knew of it for the record a token brought back by Undo needs. */
export function machineToken(m: MachineIdentity): Token {
  return { type: MACHINE_TOKEN, value: m.id, label: m.name, data: { reachability: m.reachability, lastSeen: m.lastSeen } };
}

/** The editor value for a composer's `text`: each `@<name>` one of `records` mentions becomes its machine's token. */
export function editorValue(text: string, records: unknown): TokenInputValue {
  return mentionPieces(text, records).map((p) => {
    if (!p.span) return p.text;
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

/**
 * What the draft's machine records need after an edit, so they match the chips in the box: a machine whose last chip
 * went loses its record, and a chip with no record (Undo brought it back, or it was pasted) gets one.
 */
export function reconcileMachines(value: TokenInputValue, records: readonly MessageContext[]): { add: MachineIdentity[]; remove: string[] } {
  const chips = new Map<string, Token>();
  for (const p of value) if (typeof p !== 'string' && p.type === MACHINE_TOKEN && !chips.has(p.value)) chips.set(p.value, p);
  const held = new Set<string>();
  const remove: string[] = [];
  for (const r of records) {
    if (r.kind !== machineMention.kind) continue;
    const machine = (r.body as Partial<MachineMention> | null)?.machine;
    if (typeof machine === 'string' && chips.has(machine) && !held.has(machine)) held.add(machine);
    else remove.push(r.id);
  }
  const add = [...chips.values()].filter((t) => !held.has(t.value)).map(identity);
  return { add, remove };
}
