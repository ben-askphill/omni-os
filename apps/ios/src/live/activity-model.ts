// The Activity tab, mirrored from phone web: apps/web/src/mobile/activity.ts (sections), apps/web/src/needs-you.ts
// (reasonOf), apps/web/src/sidebar-lists.ts (handoff nesting) and the usage meters in mobile/ActivityScreen.tsx.
import type {
  ChannelWithRunning,
  HarnessId,
  HarnessUsage,
  NeedsYou,
  NeedsYouBlocker,
  NeedsYouItem,
  PinnedThread,
  Thread,
  ThreadStub,
  UsageWindow,
} from '@omni/client-core';

import { type NeedsAction } from '../needs/actions';
import { harnessLabel, LIMIT_LABEL, limitView } from '../needs/limit';
import { canMarkDone } from '../thread/target';
import { shortAgo, threadRow, type ThreadRow } from './channel-model';

/** `needs` waits on Ben, `done` is a finished result to read, `settled` a stopped one. */
export type NeedsGlyph = 'needs' | 'done' | 'settled';
export type NeedsKind = NeedsYouBlocker['kind'] | 'result';

/** What a Needs you button does. `open` goes to the thread, the rest answer on the spot. */
export type NeedsButtonRun = { kind: 'open' } | { kind: 'recover'; action: NeedsAction } | { kind: 'read'; uid: string } | { kind: 'done' };

export interface NeedsButton {
  key: string;
  label: string;
  run: NeedsButtonRun;
}

export interface NeedsRow {
  id: string;
  thread: Thread;
  kind: NeedsKind;
  glyph: NeedsGlyph;
  /** Why it is here: "Usage limit reached", "Failed", "Finished". */
  label: string;
  /** Why Setup failed, when the limit resets, or the result's last words. */
  detail: string | null;
  /** "#Volero · builder · via Conductor". */
  meta: string;
  ago: string;
  /** The first is the main one. At most two, as on phone web. */
  buttons: NeedsButton[];
}

/** A thread row that also names its channel, as Activity lists threads from every channel. */
export type ActivityRow = ThreadRow & { channel: string };

/** A row and the Conductor's delegated threads nested under it. Most rows have none. */
export interface ThreadGroup {
  row: ActivityRow;
  children: ActivityRow[];
}

export type UsageUnit = '5h' | 'mo';

export interface UsageMeter {
  id: HarnessId;
  name: string;
  /** 0 to 1. */
  fraction: number;
  unit: UsageUnit;
}

export interface ActivitySections {
  /** "Monday 2 November · 1 running · 2 need you". */
  headline: string;
  needs: NeedsRow[];
  /** Under Needs you when it is empty: "Nothing waits on you. 3 threads are running." */
  nothingNeeded: string;
  running: ThreadGroup[];
  /** Every row Running shows, nested ones included. */
  runningCount: number;
  pinned: ActivityRow[];
  /** Recent threads: the latest by activity across channels. */
  latest: ThreadGroup[];
  latestCount: number;
  doneToday: ActivityRow[];
  /** Each harness's fullest window. Empty when none reports one. */
  usage: UsageMeter[];
}

export interface ActivityInput {
  recent: readonly Thread[] | null;
  needsYou: NeedsYou | null;
  pinned: readonly PinnedThread[];
  channels: readonly ChannelWithRunning[] | null;
  usage: HarnessUsage;
  now: number;
}

/** How many threads Recent threads lists. The server sends each channel's 5 latest, so the 5 latest overall are among them. */
export const RECENT_THREADS = 5;

const HARNESS_ROWS: readonly { id: HarnessId; name: string }[] = [
  { id: 'claude-code', name: 'Claude' },
  { id: 'codex', name: 'Codex' },
  { id: 'cursor', name: 'Cursor' },
  { id: 'hermes', name: 'Hermes' },
];

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAY = 86_400_000;

export function activitySections({ recent, needsYou, pinned, channels, usage, now }: ActivityInput): ActivitySections {
  const names = new Map((channels ?? []).map((c) => [c.id, c.name]));
  const row = (t: ThreadStub): ActivityRow => ({ ...threadRow(t, now), channel: names.get(t.channel_id) ?? t.channel_id });

  // What waits on a decision comes before results to read; each keeps the inbox's order.
  const needs = (needsYou?.items ?? [])
    .map((item) => needsRow(item, names.get(item.thread.channel_id), now))
    .sort((a, b) => Number(b.glyph === 'needs') - Number(a.glyph === 'needs'));
  const inNeeds = new Set(needs.map((n) => n.id));
  const listed = (recent ?? []).filter((t) => !inNeeds.has(t.id) && t.source !== 'team' && !t.archived);
  const today = startOfDay(now);
  const runningThreads = listed.filter((t) => t.status === 'running' || t.status === 'queued');

  const list = channels ?? [];
  const running = grouped(runningThreads, runningGroups(list), false, row);
  const latest = grouped(recentThreads(list, RECENT_THREADS), recentGroups(list), true, row);

  return {
    headline: `${dayLabel(now)} · ${runningThreads.length} running · ${needs.length} ${needs.length === 1 ? 'needs' : 'need'} you`,
    needs,
    nothingNeeded: `Nothing waits on you. ${runningThreads.length} ${runningThreads.length === 1 ? 'thread is' : 'threads are'} running.`,
    running,
    runningCount: countRows(running),
    pinned: pinned.map(row),
    latest,
    latestCount: countRows(latest),
    doneToday: listed
      .filter((t) => (t.status === 'done' || t.status === 'failed' || t.status === 'stopped') && Date.parse(t.updated_at) >= today)
      .map(row),
    usage: usageMeters(usage),
  };
}

function needsRow(item: NeedsYouItem, channelName: string | undefined, now: number): NeedsRow {
  const t = item.thread;
  const reason = reasonOf(item, now);
  const via = t.source === 'conductor' || t.parent_id ? 'via Conductor' : null;
  return {
    id: t.id,
    thread: t,
    kind: item.blockers[0]?.kind ?? 'result',
    ...reason,
    meta: [`#${channelName ?? t.channel_id}`, t.role, via].filter(Boolean).join(' · '),
    ago: shortAgo(item.at, now),
    buttons: needsButtons(item, now),
  };
}

const count = (n: number, one: string, many: string) => (n === 1 ? one : many.replace('#', String(n)));

/** A blocker comes first: it waits on Ben whether he read the result or not. */
function reasonOf(item: NeedsYouItem, now: number): Pick<NeedsRow, 'glyph' | 'label' | 'detail'> {
  const preview = item.thread.last_text ? item.thread.last_text.replace(/\s+/g, ' ').trim().slice(0, 240) : null;
  const b = item.blockers[0];
  switch (b?.kind) {
    case 'question':
      return { glyph: 'needs', label: count(b.count, 'Waiting on your answer', '# questions wait on your answer'), detail: b.detail };
    case 'setup':
      return { glyph: 'needs', label: 'Worktree could not be prepared', detail: b.detail };
    case 'limited': {
      const at = b.resets_at ? resetLabel(b.resets_at, now) : null;
      const where = b.elsewhere ? ' on your other machine' : '';
      return { glyph: 'needs', label: `Usage limit reached${where}`, detail: at ? `${b.scheduled ? 'Resumes' : 'Resets'} at ${at}` : 'No reset time given' };
    }
    case 'uncertain':
      return { glyph: 'needs', label: count(b.count, 'A message may not have been sent', '# messages may not have been sent'), detail: preview };
    case 'recovered':
      return { glyph: 'needs', label: count(b.count, 'A message waits for Resume', '# messages wait for Resume'), detail: preview };
  }
  switch (item.result?.status) {
    case 'failed':
      return { glyph: 'needs', label: 'Failed', detail: preview };
    case 'stopped':
      return { glyph: 'settled', label: 'Stopped', detail: preview };
    default:
      return { glyph: 'done', label: 'Finished', detail: preview };
  }
}

const pad = (n: number) => String(n).padStart(2, '0');
const clock = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** When a limit resets: the time today or tomorrow, else the weekday and time. */
export function resetLabel(iso: string, now: number): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  const day = Math.floor((t - startOfDay(now)) / DAY);
  if (day === 0) return clock(d);
  if (day === 1) return `tomorrow ${clock(d)}`;
  return `${WEEKDAYS[d.getDay()]!.slice(0, 3)} ${clock(d)}`;
}

function startOfDay(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** "Monday 2 November", spelled out so it reads the same whatever the engine's Intl data. */
function dayLabel(now: number): string {
  const d = new Date(now);
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** A window's use as 0 to 1. Some harnesses send a percent, others a fraction. */
function windowFraction(w: UsageWindow | undefined): number | null {
  if (!w) return null;
  const raw = w.utilization > 1.5 ? w.utilization / 100 : w.utilization;
  return Math.max(0, Math.min(1, raw));
}

function usageMeters(usage: HarnessUsage): UsageMeter[] {
  return HARNESS_ROWS.flatMap(({ id, name }) => {
    const u = usage[id];
    const five = windowFraction(u?.five_hour);
    const fraction = five ?? windowFraction(u?.monthly);
    return fraction === null ? [] : [{ id, name, fraction, unit: five === null ? 'mo' : '5h' } satisfies UsageMeter];
  });
}

interface StubGroup {
  thread: ThreadStub;
  children: ThreadStub[];
}

type Handoff = NonNullable<ChannelWithRunning['handoffs']>[number];

const isBusy = (t: ThreadStub) => t.status === 'running' || t.status === 'queued';
const allHandoffs = (channels: readonly ChannelWithRunning[]): Handoff[] => channels.find((c) => c.id === 'conductor')?.handoffs ?? [];

/** Every list once, keeping a thread's first copy. */
function unique(lists: ThreadStub[][]): ThreadStub[] {
  const seen = new Set<string>();
  return lists.flat().filter((t) => !seen.has(t.id) && !!seen.add(t.id));
}

/** Newest first; a tie goes to the lower id, so the order never flickers between reloads. */
const byCreated = (a: ThreadStub, b: ThreadStub) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id);
const activityOf = (t: ThreadStub) => t.updated_at ?? t.created_at;
const byActivity = (a: ThreadStub, b: ThreadStub) => activityOf(b).localeCompare(activityOf(a)) || byCreated(a, b);

function recentThreads(channels: readonly ChannelWithRunning[], limit: number): ThreadStub[] {
  return unique(channels.map((c) => c.recent ?? [])).sort(byActivity).slice(0, limit);
}

function runningGroups(channels: readonly ChannelWithRunning[]): StubGroup[] {
  const busy = unique(channels.map((c) => c.active ?? [])).sort(byCreated);
  return nestedRows(busy, allHandoffs(channels), 'running', Number.MAX_SAFE_INTEGER);
}

function recentGroups(channels: readonly ChannelWithRunning[]): StubGroup[] {
  return nestedRows(recentThreads(channels, Number.MAX_SAFE_INTEGER), allHandoffs(channels), 'recent', RECENT_THREADS);
}

/**
 * Nests the Conductor's delegated threads under their job. Running keeps only busy children, and a busy child keeps a
 * stopped parent visible. Recent keeps every child, and a child's activity brings its parent in.
 */
function nestedRows(candidates: ThreadStub[], handoffs: Handoff[], mode: 'running' | 'recent', limit: number): StubGroup[] {
  const byId = new Map(candidates.map((t) => [t.id, t]));
  const childIds = new Set(handoffs.flatMap((g) => g.children.map((t) => t.id)));
  const groups = new Map<string, StubGroup>();
  const score = new Map<string, string>();

  for (const t of candidates) {
    if (!childIds.has(t.id)) groups.set(t.id, { thread: t, children: [] });
  }

  for (const handoff of handoffs) {
    const present = handoff.children.filter((child) => byId.has(child.id));
    const children = mode === 'running' ? present.filter(isBusy) : handoff.children;
    const relevant = mode === 'running' ? children.length > 0 : byId.has(handoff.parent.id) || present.length > 0;
    if (!relevant) continue;
    const parent = byId.get(handoff.parent.id) ?? handoff.parent;
    groups.set(handoff.parent.id, { thread: parent, children });
    score.set(
      handoff.parent.id,
      present.reduce((latest, t) => (activityOf(t) > latest ? activityOf(t) : latest), activityOf(parent)),
    );
  }

  const rows = [...groups.values()];
  rows.sort((a, b) => {
    if (mode === 'running') return byCreated(a.thread, b.thread);
    const ax = score.get(a.thread.id) ?? activityOf(a.thread);
    const bx = score.get(b.thread.id) ?? activityOf(b.thread);
    return bx.localeCompare(ax) || byCreated(a.thread, b.thread);
  });
  return rows.slice(0, limit);
}

/**
 * The section's rows: each group that holds one of `items`, then the items no group holds. A group shows its children
 * that are among `items`, or all of them with `allChildren`.
 */
function grouped(items: readonly ThreadStub[], groups: StubGroup[], allChildren: boolean, row: (t: ThreadStub) => ActivityRow): ThreadGroup[] {
  const byId = new Map(items.map((t) => [t.id, t]));
  const visible = groups.filter((g) => byId.has(g.thread.id) || g.children.some((c) => byId.has(c.id)));
  const held = new Set(visible.flatMap((g) => [g.thread.id, ...g.children.map((c) => c.id)]));
  return [
    ...visible.map((g) => ({
      row: row(byId.get(g.thread.id) ?? g.thread),
      children: (allChildren ? g.children : g.children.filter((c) => byId.has(c.id))).map(row),
    })),
    ...items.filter((t) => !held.has(t.id)).map((t) => ({ row: row(t), children: [] })),
  ];
}

const countRows = (groups: ThreadGroup[]) => groups.reduce((n, g) => n + 1 + g.children.length, 0);

const OPEN: NeedsButton = { key: 'open', label: 'Open', run: { kind: 'open' } };

/**
 * The buttons on a Needs you row, as phone web's actionsOf gives them (apps/web/src/mobile/activity.ts). A blocker's
 * second button dismisses it, since the row itself already opens the thread.
 */
function needsButtons(item: NeedsYouItem, now: number): NeedsButton[] {
  const b = item.blockers[0];
  const t = item.thread;
  let out: NeedsButton[];
  switch (b?.kind) {
    case 'question':
      out = [{ key: 'answer', label: 'Answer', run: { kind: 'open' } }];
      break;
    case 'setup':
      out = [{ key: 'retry', label: 'Retry', run: { kind: 'recover', action: { kind: 'retry-setup' } } }];
      break;
    case 'limited':
      out = (limitView(t, harnessLabel(t.harness), now)?.actions ?? []).map((a) => ({
        key: `limit-${a}`,
        label: LIMIT_LABEL[a],
        run: { kind: 'recover', action: { kind: 'limit', action: a } },
      }));
      break;
    case 'recovered':
      out = [{ key: 'resume', label: b.count > 1 ? `Resume ${b.count}` : 'Resume', run: { kind: 'recover', action: { kind: 'resume' } } }];
      break;
    case 'uncertain':
      // Sending again names each message, and only the thread lists them.
      out = [{ key: 'review', label: 'Review', run: { kind: 'open' } }];
      break;
    default:
      out = item.result ? [OPEN, { key: 'read', label: 'Mark read', run: { kind: 'read', uid: item.result.uid } }] : [OPEN];
  }
  if (out.length < 2 && b && canMarkDone(t.status)) out.push({ key: 'done', label: 'Mark done', run: { kind: 'done' } });
  if (out.length < 2 && !out.some((a) => a.run.kind === 'open')) out.push(OPEN);
  return out.slice(0, 2);
}
