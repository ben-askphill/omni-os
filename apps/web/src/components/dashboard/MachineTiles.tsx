import { machineTile, type MachineLoad, type MachinesView } from '@omni/shared/machines.ts';
import { useNow } from '../../store.tsx';
import { Chip, Icon, StatusDot } from '../ui.tsx';

// The Inbox dashboard's machine tiles: one per machine under this account, what runs on it now
// (@omni/shared/machines.ts). The KPI tiles' shape and type; a tile opens that machine's Running list.

/** `#/?list=running&machine=<id>`: the Running list with only that machine's threads. */
export const machineHref = (id: string) => `#/?list=running&machine=${encodeURIComponent(id)}`;

export function MachineTile({ machine, view, open, href }: { machine: MachineLoad; view: MachinesView; open?: boolean; href?: string }) {
  const now = useNow(30_000);
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
