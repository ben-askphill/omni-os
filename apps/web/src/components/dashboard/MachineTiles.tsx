import { useState } from 'react';
import { machineStats, machineTile, type MachineLoad, type MachineStats, type MachinesView } from '@omni/shared/machines.ts';
import { useFeed, useNow } from '../../store.tsx';
import { Chip, Icon, StatusDot, Ticks } from '../ui.tsx';

// The Inbox dashboard's machine tiles: one per machine under this account, what runs on it now and its CPU and memory
// (@omni/shared/machines.ts). The KPI tiles' shape and type; a tile opens that machine's Running list.

/**
 * The machine's newest sample: the feed's machine_stats events while the tiles are watched, else what /api/machines
 * last returned. Only the tile re-renders for a sample, not the page around it.
 */
function useLiveStats(machine: MachineLoad): MachineStats | null {
  const [pushed, setPushed] = useState<MachineStats | null>(null);
  useFeed((e) => {
    if (e.type === 'machine_stats' && e.id === machine.id) setPushed(e.stats);
  });
  const polled = machine.stats;
  if (!pushed || !polled) return pushed ?? polled;
  return pushed.sampledAt >= polled.sampledAt ? pushed : polled;
}

/** CPU and RAM as tick meters with their numbers. Grey, with the sample's age, when not live; a dash, never a zero, when not known. */
function StatRows({ machine, view, now }: { machine: MachineLoad; view: MachinesView; now: number }) {
  const stats = useLiveStats(machine);
  const s = machineStats({ ...machine, stats }, view, now);
  if (!s.rows.length) return s.note ? <span className="mt-3 min-h-[16px] truncate text-[11.5px] text-fg-3">{s.note}</span> : null;
  return (
    <span className="mt-3 flex flex-col gap-1.5">
      {s.rows.map((r) => (
        <span key={r.key} className="flex items-center gap-2" title={r.title}>
          <span className="w-[26px] shrink-0 font-num text-[10px] text-fg-3">{r.label}</span>
          <span aria-hidden="true" className="flex min-w-0 flex-1">
            <Ticks responsive value={r.value ?? 0} count={32} height={10} tone={s.stale || r.value === null ? 'muted' : r.value >= 0.9 ? 'needs' : undefined} className="min-w-0 flex-1" />
          </span>
          <span className={`w-[76px] shrink-0 text-right font-num text-[10.5px] tabular-nums ${s.stale ? 'text-fg-3' : 'text-fg-2'}`}>{r.text}</span>
        </span>
      ))}
      {s.note && <span className="truncate text-[11.5px] text-fg-3">{s.note}</span>}
    </span>
  );
}

/** `#/?list=running&machine=<id>`: the Running list with only that machine's threads. */
export const machineHref = (id: string) => `#/?list=running&machine=${encodeURIComponent(id)}`;

export function MachineTile({ machine, view, open, href }: { machine: MachineLoad; view: MachinesView; open?: boolean; href?: string }) {
  // Often enough to grey a sample that stopped coming within seconds of the 60 second mark.
  const now = useNow(10_000);
  const t = machineTile(machine, view, now);
  const body = (
    <>
      <span className="flex h-5 items-center justify-between gap-2 text-[12px] font-medium text-fg-3">
        <span className="flex min-w-0 items-center gap-1.5" title={t.state}>
          <StatusDot status={t.dot} size={7} />
          <span className="sr-only">{t.state}:</span>
          <span className="truncate">{machine.name}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          {machine.here && <Chip tone="outline">This machine</Chip>}
          {href && <Icon name={open ? 'chevronDown' : 'chevronRight'} size={13} className="opacity-60 group-hover:opacity-100" />}
        </span>
      </span>
      <span className={`mt-2 font-display text-[length:var(--fs-title)] leading-none tabular-nums ${t.stale ? 'text-fg-3' : ''}`}>{t.value === null ? '–' : t.value}</span>
      <span className="mt-1.5 min-h-[16px] truncate text-[11.5px] text-fg-3">{t.detail}</span>
      <span className="min-h-[16px] truncate text-[11.5px] text-fg-3" title={t.foot}>
        {t.foot}
      </span>
      <StatRows machine={machine} view={view} now={now} />
    </>
  );
  const cls = `group flex min-w-0 flex-col rounded-[20px] p-4 card text-fg transition-shadow`;
  if (!href) return <div className={cls}>{body}</div>;
  return (
    <a
      href={open ? '#/' : href}
      aria-current={open ? 'true' : undefined}
      className={`press ${cls} ${open ? 'shadow-[inset_0_0_0_1.5px_var(--fg)]' : 'hover:shadow-[var(--shadow-card)]'}`}
    >
      {body}
    </a>
  );
}

/** One tile per machine, wrapping to more rows past three. Shown once there is a machine besides this one. */
export function MachineTiles({ view, open }: { view: MachinesView | undefined; open: string | null }) {
  if (!view || view.machines.length < 2) return null;
  return (
    <section aria-labelledby="machines-heading" className="mt-6">
      <h2 id="machines-heading" className="caption mb-2.5 px-1">
        Machines
      </h2>
      <div className="grid grid-cols-1 gap-3 @lg:grid-cols-2 @3xl:grid-cols-3">
        {view.machines.map((m) => (
          <MachineTile key={m.id ?? 'here'} machine={m} view={view} href={m.id ? machineHref(m.id) : undefined} open={!!m.id && open === m.id} />
        ))}
      </div>
    </section>
  );
}
