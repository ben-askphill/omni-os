import type { ReactNode } from 'react';
import type { InsightsAutomations, InsightsChannel, InsightsPRs } from '@omni/shared/insights.ts';
import type { NeedsYouItem } from '../../api.ts';
import { clock, relTime } from '@omni/shared/format.ts';
import { useApp } from '../../store.tsx';
import { NeedsYouRow, EmptyNote } from '../NeedsYou.tsx';
import { HARNESS_ROWS, SLOT_ROWS, harnessLabel } from '../brand.tsx';
import { Avatar, Chip, Icon, Loader, StatusDot, type IconName } from '../ui.tsx';
import { grouped } from './numbers.ts';

export type ListKind = 'needs' | 'running' | 'unread' | 'done';

const BLOCKER_LABEL: Record<string, [string, string]> = {
  question: ['question set', 'question sets'],
  limited: ['usage limit', 'usage limits'],
  setup: ['setup failure', 'setup failures'],
  uncertain: ['unsent message', 'unsent messages'],
  recovered: ['held message', 'held messages'],
  failed: ['failed run', 'failed runs'],
};

/** "1 question set · 1 usage limit": each Needs you item by what holds it up. */
export function needsBreakdown(items: NeedsYouItem[]): string {
  const counts = new Map<string, number>();
  for (const i of items) {
    const k = i.blockers[0]?.kind ?? 'failed';
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts].map(([k, n]) => `${n} ${(BLOCKER_LABEL[k] ?? [k, k])[n === 1 ? 0 : 1]}`).join(' · ');
}

function Tile({ kind, label, value, sub, open, emphasis }: { kind: ListKind; label: string; value: number | null; sub?: ReactNode; open: boolean; emphasis?: boolean }) {
  const hot = emphasis && !!value;
  return (
    <a
      href={open ? '#/' : `#/?list=${kind}`}
      aria-current={open ? 'true' : undefined}
      className={`press group flex min-w-0 flex-col rounded-[20px] p-4 transition-shadow ${hot ? 'bg-needs text-on-needs' : 'card text-fg'} ${open ? 'shadow-[inset_0_0_0_1.5px_var(--fg)]' : 'hover:shadow-[var(--shadow-card)]'}`}
    >
      <span className={`flex items-center justify-between text-[12px] font-medium ${hot ? '' : 'text-fg-3'}`}>
        {label}
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={13} className="opacity-60 group-hover:opacity-100" />
      </span>
      <span className="mt-2 font-display text-[length:var(--fs-title)] leading-none tabular-nums">{value === null ? '–' : grouped(value)}</span>
      <span className={`mt-1.5 min-h-[16px] truncate text-[11.5px] ${hot ? '' : 'text-fg-3'}`}>{sub}</span>
    </a>
  );
}

export function KpiTiles({ needs, unread, done, open }: { needs: NeedsYouItem[] | null; unread: number | null; done: number | null; open: ListKind | null }) {
  const { status } = useApp();
  const slots = status?.slots ?? {};
  // The harness doing the most, else the default one, with how full its slots are.
  const busiest = SLOT_ROWS.filter((r) => slots[r.id]).sort((a, b) => slots[b.id]!.running - slots[a.id]!.running)[0] ?? HARNESS_ROWS[0];
  const slot = slots[busiest.id];
  return (
    <div className="grid grid-cols-2 gap-3 @3xl:grid-cols-4">
      <Tile kind="needs" label="Needs you" value={needs?.length ?? null} sub={needs?.length ? needsBreakdown(needs) : 'All clear'} open={open === 'needs'} emphasis />
      <Tile
        kind="running"
        label="Running"
        value={status?.running ?? null}
        sub={slot ? `${harnessLabel(busiest.id)} · ${slot.running} of ${slot.cap} slots` : status?.queued ? `${status.queued} queued` : undefined}
        open={open === 'running'}
      />
      <Tile kind="unread" label="Unread" value={unread} sub="Finished, not opened" open={open === 'unread'} />
      <Tile kind="done" label="Done" value={done} sub="Marked done in range" open={open === 'done'} />
    </div>
  );
}

function Card({ title, count, action, children, label }: { title: string; count?: ReactNode; action?: ReactNode; children: ReactNode; label?: string }) {
  return (
    <section aria-label={label ?? title} className="card flex min-w-0 flex-col p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="flex items-baseline gap-2 font-display text-[length:var(--fs-heading)]">
          {title}
          {count !== undefined && <span className="font-num text-[12px] text-fg-3 tabular-nums">{count}</span>}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function MiniStat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0 rounded-[14px] bg-bg/70 px-3 py-2">
      <div className="font-num text-[length:var(--fs-subhead)] font-medium tabular-nums">{value}</div>
      <div className="truncate text-[11px] text-fg-3">{label}</div>
    </div>
  );
}

function Pending({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 py-6 text-[12.5px] text-fg-3">
      <Loader /> {children}
    </div>
  );
}

export function NeedsYouCard({ needs }: { needs: NeedsYouItem[] | null }) {
  return (
    <Card title="Needs you" count={needs?.length || undefined} action={needs?.length ? <a href="#/?list=needs" className="text-[12px] text-fg-3 hover:text-fg">Open all</a> : undefined}>
      {!needs ? (
        <Pending>Loading</Pending>
      ) : needs.length ? (
        <div className="-mx-3 flex flex-col">
          {needs.slice(0, 4).map((i) => (
            <NeedsYouRow key={i.thread.id} item={i} showChannel />
          ))}
        </div>
      ) : (
        <EmptyNote icon="check">Nothing needs you. Questions, failures and usage limits show up here.</EmptyNote>
      )}
    </Card>
  );
}

export function ChannelAvatar({ id, name, icon, size = 18 }: { id: string; name: string; icon: string | null; size?: number }) {
  const { channels } = useApp();
  const c = channels.find((x) => x.id === id);
  return <Avatar name={name} channelIcon={c?.icon ?? icon} avatarBg={c?.avatar_bg} omni={id === 'conductor'} size={size} />;
}

export function BusiestCard({ list }: { list: InsightsChannel[] | undefined }) {
  const top = list?.slice(0, 6) ?? [];
  const max = Math.max(1, ...top.map((c) => c.threads));
  return (
    <Card title="Busiest channels" count={list?.length ? grouped(list.reduce((s, c) => s + c.threads, 0)) : undefined} label="Busiest channels">
      {!list ? (
        <Pending>Loading</Pending>
      ) : top.length ? (
        <ul className="flex flex-col gap-2.5">
          {top.map((c) => (
            <li key={c.id}>
              <a href={`#/c/${encodeURIComponent(c.id)}`} className="group flex items-center gap-2.5">
                <ChannelAvatar id={c.id} name={c.name} icon={c.icon} />
                <span className="w-[96px] shrink-0 truncate text-[12.5px] sm:w-[120px] text-fg-2 group-hover:text-fg">#{c.name}</span>
                <span className="h-2 min-w-0 flex-1">
                  <span className="block h-full min-w-[2px] rounded-full bg-fg-3 group-hover:bg-fg" style={{ width: `${(c.threads / max) * 100}%` }} />
                </span>
                <span className="w-7 text-right font-num text-[12px] text-fg-3 tabular-nums">{c.threads}</span>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyNote icon="message">No threads started in this range.</EmptyNote>
      )}
    </Card>
  );
}

function checksTone(c: { passed: number; failed: number; pending: number }): { status: 'failed' | 'running' | 'done' | 'idle'; label: string } {
  if (c.failed) return { status: 'failed', label: `${c.failed} failing` };
  if (c.pending) return { status: 'running', label: `${c.pending} pending` };
  if (c.passed) return { status: 'done', label: 'Checks pass' };
  return { status: 'idle', label: 'No checks' };
}

export function PRsCard({ prs, loading }: { prs: InsightsPRs | null | undefined; loading: boolean }) {
  return (
    <Card title="Pull requests" count={prs ? `${prs.open} open` : undefined} action={<a href="#/prs" className="text-[12px] text-fg-3 hover:text-fg">All PRs</a>}>
      {!prs ? (
        loading || prs === null ? <Pending>Asking GitHub</Pending> : <EmptyNote icon="pr">Pull requests could not be read.</EmptyNote>
      ) : (
        <>
          <div className="mb-3 grid grid-cols-3 gap-2">
            <MiniStat label="Yours open" value={prs.mine === null ? '–' : prs.mine} />
            <MiniStat label="With checks" value={prs.withChecks} />
            <MiniStat label="Merged from threads" value={prs.mergedFromThreads} />
          </div>
          {prs.top.length ? (
            <ul className="-mx-2 flex flex-col">
              {prs.top.map((p) => {
                const tone = checksTone(p.checks);
                return (
                  <li key={p.url}>
                    <a href={p.channel_id ? `#/c/${encodeURIComponent(p.channel_id)}/prs/${p.number}` : p.url} className="item flex items-center gap-2.5 rounded-[12px] px-2 py-2">
                      <StatusDot status={tone.status} size={7} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] text-fg">{p.title}</span>
                        <span className="block truncate text-[11px] text-fg-3">
                          {p.repo.split('/')[1]} #{p.number} · {tone.label} · {relTime(p.updatedAt)}
                          {p.author ? ` · ${p.author}` : ''}
                        </span>
                      </span>
                      {p.isDraft && <Chip tone="outline">Draft</Chip>}
                    </a>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyNote icon="pr">No open pull requests{prs.failed.length ? `. GitHub refused ${prs.failed.join(', ')}.` : '.'}</EmptyNote>
          )}
        </>
      )}
    </Card>
  );
}

export function AutomationsCard({ automations }: { automations: InsightsAutomations | undefined }) {
  const { channels } = useApp();
  const name = (id: string) => channels.find((c) => c.id === id)?.name ?? id;
  return (
    <Card title="Automations" count={automations?.total} action={<a href="#/automations" className="text-[12px] text-fg-3 hover:text-fg">Manage</a>}>
      {!automations ? (
        <Pending>Loading</Pending>
      ) : (
        <>
          <div className="mb-3 grid grid-cols-3 gap-2">
            <MiniStat label="Scheduled" value={automations.scheduled} />
            <MiniStat label="On an event" value={automations.onEvent} />
            <MiniStat label="Paused" value={automations.paused} />
          </div>
          <h3 className="caption mb-1.5">Next today</h3>
          {automations.today.length ? (
            <ul className="flex flex-col">
              {automations.today.slice(0, 4).map((r) => (
                <li key={`${r.id}:${r.at}`} className="flex items-center gap-3 border-t border-line py-2 first:border-t-0">
                  <span className="w-11 shrink-0 font-num text-[12.5px] text-fg tabular-nums">{clock(new Date(r.at))}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-fg">{r.name}</span>
                    <span className="block truncate text-[11px] text-fg-3">
                      #{name(r.channel)}
                      {r.role ? ` · ${r.role}` : ''}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-2 text-[12.5px] text-fg-3">No scheduled runs left today.</p>
          )}
        </>
      )}
    </Card>
  );
}

export const LIST_TITLE: Record<ListKind, { title: string; icon: IconName; empty: string }> = {
  needs: { title: 'Needs you', icon: 'check', empty: 'Nothing needs you. Questions, failures and usage limits show up here.' },
  running: { title: 'Running', icon: 'clock', empty: 'Nothing running. Threads that are running or queued show up here.' },
  unread: { title: 'Unread', icon: 'message', empty: 'Nothing unread. Finished threads you have not opened show up here.' },
  done: { title: 'Done', icon: 'check', empty: 'Nothing marked done in this range.' },
};
