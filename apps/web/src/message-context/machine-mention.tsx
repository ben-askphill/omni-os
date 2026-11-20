// How the Web UI shows a machine_mention (packages/shared/message-context-machine.ts). A composer makes one when a
// machine is picked from the `@` menu: the box shows it as a chip (components/composer/MessageEditor.tsx), the text
// keeps `@<name>`, and the draft keeps the record while the chip is there.
import type { MachineMention } from '@omni/shared/message-context-machine.ts';
import { relTime } from '@omni/shared/format.ts';
import { fullDate } from '../format.ts';
import { StatusDot } from '../components/ui.tsx';
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
