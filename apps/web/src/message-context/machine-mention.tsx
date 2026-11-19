// How the Web UI shows a machine_mention (packages/shared/message-context-machine.ts), and how a composer makes one:
// picking a machine in the `@` menu writes `@<name>` into the text and puts the machine on the message as a record,
// which the text shows as an inline pill (MentionField.tsx). Deleting the `@<name>` from the text drops the record, so
// the two never disagree.
import type { FileMention } from '@omni/shared/mention-menu.ts';
import { droppedMentions, machineMention, mentionBody, mentionsMachine, type MachineMention } from '@omni/shared/message-context-machine.ts';
import { newContext, type MessageContext } from '@omni/shared/message-context.ts';
import { relTime } from '@omni/shared/format.ts';
import { fullDate } from '../format.ts';
import { StatusDot } from '../components/ui.tsx';
import { addDraftContext, draftContext, removeDraftContext } from './draft.ts';
import type { ContextView } from './views.ts';

const DOT = { online: 'done', offline: 'settled', unknown: 'idle' } as const;

/** A machine's state as the menu and the chip say it. */
export function reachLine(reachability: MachineMention['reachability'], lastSeen: string | null, now = Date.now()): string {
  if (reachability === 'online') return 'Online';
  if (reachability === 'unknown') return "Can't check Tailscale";
  return lastSeen ? `Asleep or offline, last seen ${relTime(lastSeen, now)}` : 'Asleep or offline';
}

function MachineMentionDetail({ body: b }: { body: MachineMention }) {
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-2">
        <StatusDot status={DOT[b.reachability]} size={7} className="shrink-0" />
        <span className="truncate text-[13px] font-medium text-fg">{b.name}</span>
      </div>
      <div className="mt-0.5 text-[11.5px] text-fg-2">{reachLine(b.reachability, b.last_seen)} when sent</div>
      <div className="truncate font-mono text-[11px] text-fg-3">
        machine {b.machine.slice(0, 8)} · mentioned {fullDate(b.captured_at)}
      </div>
      <p className="mt-1.5 text-[11.5px] leading-snug text-fg-3">The agent runs the task written next to @{b.name} on this machine. If it cannot take it, the agent says so instead of running it elsewhere.</p>
    </div>
  );
}

export const machineMentionView: ContextView<MachineMention> = { icon: 'monitor', Detail: MachineMentionDetail };

// The mentions an edit took off each draft lately, so Undo puts the pill back with its text. In memory only.
const recentlyDropped = new Map<string, MessageContext[]>();
const RECENT_MAX = 8;

/**
 * A composer's machine mentions for `threadId`'s next message. `picked` puts the machine of a picked `@` menu row on
 * it (once per machine), or hands `onError` why it could not. `edited` takes the text after each edit Ben makes and
 * drops the mention of a machine whose `@<name>` left it, and brings one back when its `@<name>` returns (Undo). It
 * runs on edits, never on a render: a render can show the new pill with the text from before the pick, or another
 * composer's text.
 */
export function machineMentions(threadId: string, onError?: (why: string) => void) {
  return {
    picked: (row: FileMention) => {
      const m = row.machine;
      if (!m || mentionsMachine(draftContext(threadId), m.id)) return;
      const why = addDraftContext(threadId, newContext(machineMention, mentionBody({ id: m.id, name: row.name, reachability: m.reachability, lastSeen: m.lastSeen }, new Date()), ''));
      if (why) onError?.(why);
    },
    edited: (text: string) => {
      const draft = draftContext(threadId);
      const gone = droppedMentions(text, draft);
      const kept = recentlyDropped.get(threadId) ?? [];
      // Undo, or typing the same @<name> again, brings back the pill the edit took away.
      const back: MessageContext[] = [];
      for (const r of kept) {
        const machine = (r.body as MachineMention).machine;
        if (!gone.includes(r.id) && !mentionsMachine([...draft, ...back], machine) && droppedMentions(text, [r]).length === 0) back.push(r);
      }
      // A fresh id: the old one may have gone out with a message already.
      for (const r of back) addDraftContext(threadId, newContext(machineMention, r.body as MachineMention, ''));
      for (const id of gone) removeDraftContext(threadId, id);
      const left = [...kept.filter((r) => !back.includes(r)), ...draft.filter((r) => gone.includes(r.id))].slice(-RECENT_MAX);
      if (left.length) recentlyDropped.set(threadId, left);
      else recentlyDropped.delete(threadId);
    },
  };
}
