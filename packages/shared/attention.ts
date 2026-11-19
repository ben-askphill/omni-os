// Which events become a notification, for the browser (apps/web/src/components/BrowserNotifier.tsx) and the desktop
// app (apps/desktop/src/notifications.ts) alike. Two sources:
// - Needs you (GET /api/needs-you): finished and failed results, and questions waiting for an answer. A result or a
//   question alerts when it first shows there, under its own key, so it alerts once however often the inbox loads,
//   and it is withdrawn when it leaves (read, answered, here or on the other Mac).
// - The feed's `alert` events (apps/server/push-sender.ts): crew reports landing in the Conductor and PRs that need
//   attention. They are not in Needs you, so they alert as they arrive and are never withdrawn.
// Pure: no DOM, no Electron. The shapes are the server's, narrowed to what is read here.

export type AlertKind = 'finished' | 'failed' | 'question' | 'crewReport' | 'prAttention';
export const ALERT_KINDS: readonly AlertKind[] = ['question', 'failed', 'finished', 'crewReport', 'prAttention'];

/** Which kinds alert. Each is on until it is turned off. */
export type AlertKinds = Record<AlertKind, boolean>;
export const DEFAULT_ALERT_KINDS: AlertKinds = { question: true, failed: true, finished: true, crewReport: true, prAttention: true };

/** The Settings switch for each kind. */
export const ALERT_KIND_LABEL: Record<AlertKind, { title: string; detail: string }> = {
  question: { title: 'Questions', detail: 'An agent asked you something and waits for the answer.' },
  failed: { title: 'Failed threads', detail: 'A turn failed, or a worktree could not be prepared.' },
  finished: { title: 'Finished threads', detail: 'A turn finished and its result waits in Needs you.' },
  crewReport: { title: 'Crew reports', detail: 'A delegated thread reported back to the Conductor.' },
  prAttention: { title: 'Pull requests', detail: 'A watched PR has failing checks or new review feedback.' },
};

/** Reads stored kinds key by key: a missing or broken one takes its default. */
export function parseAlertKinds(raw: unknown): AlertKinds {
  const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out = { ...DEFAULT_ALERT_KINDS };
  for (const k of ALERT_KINDS) if (typeof obj[k] === 'boolean') out[k] = obj[k] as boolean;
  return out;
}

export interface AttentionAlert {
  /** The result's uid, the question's key or the feed alert's id, so posting it twice replaces it. */
  id: string;
  kind: AlertKind;
  threadId: string;
  channelId: string;
  title: string;
  body: string;
}

/** A Needs you item, narrowed. */
export interface AttentionItem {
  /** `step`: the step a running thread is on (steps.ts `stepLine`), which the server adds while it runs. */
  thread: { id: string; channel_id: string; title: string | null; status?: string; last_text?: string | null; step?: string };
  result: { uid: string; status: string; at: string } | null;
  blockers: { kind: string; detail: string | null; count: number; at?: string | null; signin?: boolean }[];
  at?: string;
}

/** The feed's `alert` event: something worth a notification that Needs you does not list. */
export interface FeedAlert {
  id: string;
  kind: 'crewReport' | 'prAttention';
  thread_id: string;
  channel_id: string;
  /** The thread's title. */
  title: string | null;
  /** What happened, in one line: the report's first words, or what the PR needs. */
  body: string;
  at: string;
}

/** A result or question older than this when it first shows never alerts, so a sync that brings in a day of results does not flood. */
export const FRESHNESS_MS = 10 * 60 * 1000;

const BODY_MAX = 160;
const oneLine = (text: string | null | undefined) => text?.replace(/\s+/g, ' ').trim() || null;
const where = (channelId: string, channelName?: string) => (channelId === 'conductor' ? 'the Conductor' : `#${channelName ?? channelId}`);
const withDetail = (head: string, detail: string | null | undefined) => {
  const d = oneLine(detail);
  return d ? `${head}: ${d.slice(0, BODY_MAX)}` : head;
};
const titleOf = (title: string | null | undefined) => oneLine(title) ?? 'Untitled thread';

/** Completions and failures. A stop is Ben's own doing. */
export function resultAlert(item: AttentionItem, channelName?: string): AttentionAlert | null {
  const r = item.result;
  if (!r || (r.status !== 'done' && r.status !== 'failed')) return null;
  const failed = r.status === 'failed';
  return {
    id: r.uid,
    kind: failed ? 'failed' : 'finished',
    threadId: item.thread.id,
    channelId: item.thread.channel_id,
    title: titleOf(item.thread.title),
    body: withDetail(`${failed ? 'Failed' : 'Finished'} in ${where(item.thread.channel_id, channelName)}`, item.thread.last_text),
  };
}

/**
 * A worktree that could not be prepared: the thread failed before its first turn, so there is no result to alert. A
 * thread held for a sign-in alerts as a question, since it waits for Ben to sign in, though it reads as stopped.
 */
export function setupAlert(item: AttentionItem, channelName?: string): AttentionAlert | null {
  const b = item.blockers.find((x) => x.kind === 'setup');
  if (b?.signin)
    return {
      id: `signin:${item.thread.id}:${b.detail ?? ''}`,
      kind: 'question',
      threadId: item.thread.id,
      channelId: item.thread.channel_id,
      title: titleOf(item.thread.title),
      body: withDetail(`Sign in needed in ${where(item.thread.channel_id, channelName)}`, b.detail),
    };
  // Stopped while it was being prepared: Ben's own doing. A failed result says it already.
  if (!b || item.thread.status === 'stopped' || item.result?.status === 'failed') return null;
  return {
    id: `setup:${item.thread.id}:${b.detail ?? ''}`,
    kind: 'failed',
    threadId: item.thread.id,
    channelId: item.thread.channel_id,
    title: titleOf(item.thread.title),
    body: withDetail(`Worktree could not be prepared in ${where(item.thread.channel_id, channelName)}`, b.detail),
  };
}

/**
 * The question key: the newest question card's time, so a newer card alerts again and an answer withdraws it. The
 * tracker never alerts a key older than the newest it has seen for the thread: answering the newer of two cards
 * brings the older card's time back, and that card is not news.
 */
export const questionKey = (item: AttentionItem): string | null => {
  const q = item.blockers.find((b) => b.kind === 'question');
  return q ? `question:${item.thread.id}:${q.at ?? `${q.count}:${q.detail ?? ''}`}` : null;
};

export function questionAlert(item: AttentionItem, channelName?: string): AttentionAlert | null {
  const q = item.blockers.find((b) => b.kind === 'question');
  const id = questionKey(item);
  if (!q || !id) return null;
  const wait = q.count > 1 ? `${q.count} questions wait in ${where(item.thread.channel_id, channelName)}` : `Waiting on your answer in ${where(item.thread.channel_id, channelName)}`;
  // Where it stopped to ask: "Step 2 of 3 · Read the reviews · waiting on your answer in #volero".
  const head = item.thread.step ? `${item.thread.step} · ${wait[0].toLowerCase()}${wait.slice(1)}` : wait;
  return { id, kind: 'question', threadId: item.thread.id, channelId: item.thread.channel_id, title: titleOf(item.thread.title), body: withDetail(head, q.detail) };
}

export function feedAlertToAlert(a: FeedAlert, channelName?: string): AttentionAlert {
  const head = a.kind === 'crewReport' ? `Crew report in ${where(a.channel_id, channelName)}` : 'Pull request needs attention';
  return { id: a.id, kind: a.kind, threadId: a.thread_id, channelId: a.channel_id, title: titleOf(a.title), body: withDetail(head, a.body) };
}

export interface ObserveOptions {
  now: number;
  /** The thread on screen, if any. */
  viewing: string | null;
  /** The window or tab showing it is in front. A thread on screen in front is being watched: nothing alerts for it. */
  visible: boolean;
  /** Whether this kind alerts for this channel now: notifications on, the kind on, the channel not muted. */
  allows(kind: AlertKind, channelId: string): boolean;
  channelName?: (id: string) => string | undefined;
}

export interface Changes {
  post: AttentionAlert[];
  /** Alerts whose result or question left Needs you (read or answered, here or on the other Mac), by id. */
  withdraw: string[];
}

export interface Tracker {
  /** Each Needs you list in turn. */
  observe(list: { items: readonly AttentionItem[] }, o: ObserveOptions): Changes;
  /** A feed alert, as it arrives. Null when it should not alert. */
  feed(alert: FeedAlert, o: ObserveOptions): AttentionAlert | null;
}

/**
 * Which results and questions alert, from each Needs you list in turn:
 * - the first list only records what is there: what was waiting before the app or page started is history, not news;
 * - each alerts once, the first time a list has it;
 * - one older than FRESHNESS_MS when it first shows never alerts;
 * - the thread on screen in a window in front is being watched: its result or question is recorded, not alerted;
 * - a kind or channel turned off records it too, so turning it on later does not alert old ones;
 * - a question older than the newest one already seen in its thread never alerts;
 * - one thread alerts once per list, with what matters most (a question, then a failure, then a finish).
 * Feed alerts skip only the watched thread and what is turned off, and alert once per id.
 */
export function createTracker(): Tracker {
  const seen = new Set<string>();
  const posted = new Set<string>();
  /** The newest question card time seen per thread. */
  const newestQuestion = new Map<string, string>();
  let started = false;
  const watched = (threadId: string, o: ObserveOptions) => o.visible && o.viewing === threadId;
  return {
    observe(list, o) {
      const candidates: { key: string; at: string | null | undefined; make: () => AttentionAlert | null; item: AttentionItem; question?: boolean }[] = [];
      // Oldest first, so alerts stack in the order things happened.
      for (const item of list.items.toReversed()) {
        const name = o.channelName?.(item.thread.channel_id);
        if (item.result) candidates.push({ key: item.result.uid, at: item.result.at, make: () => resultAlert(item, name), item });
        const setup = setupAlert(item, name);
        if (setup) candidates.push({ key: setup.id, at: item.at, make: () => setup, item });
        const q = questionKey(item);
        if (q) candidates.push({ key: q, at: item.blockers.find((b) => b.kind === 'question')?.at, make: () => questionAlert(item, name), item, question: true });
      }
      const present = new Set(candidates.map((c) => c.key));
      const withdraw = [...posted].filter((id) => !present.has(id)).sort();
      withdraw.forEach((id) => posted.delete(id));
      const post: AttentionAlert[] = [];
      for (const c of candidates) {
        if (seen.has(c.key)) continue;
        seen.add(c.key);
        if (c.question && c.at) {
          const newest = newestQuestion.get(c.item.thread.id);
          if (newest && c.at <= newest) continue;
          newestQuestion.set(c.item.thread.id, c.at);
        }
        if (!started) continue;
        if (c.at && o.now - Date.parse(c.at) > FRESHNESS_MS) continue;
        if (watched(c.item.thread.id, o)) continue;
        const alert = c.make();
        if (!alert || !o.allows(alert.kind, alert.channelId)) continue;
        post.push(alert);
      }
      started = true;
      const best = new Map<string, AttentionAlert>();
      for (const a of post) {
        const had = best.get(a.threadId);
        if (!had || RANK[a.kind] < RANK[had.kind]) best.set(a.threadId, a);
      }
      const kept = post.filter((a) => best.get(a.threadId) === a);
      kept.forEach((a) => posted.add(a.id));
      return { post: kept, withdraw };
    },
    feed(a, o) {
      if (seen.has(a.id)) return null;
      seen.add(a.id);
      if (watched(a.thread_id, o) || !o.allows(a.kind, a.channel_id)) return null;
      return feedAlertToAlert(a, o.channelName?.(a.channel_id));
    },
  };
}

/** What matters most when one thread has several things in one list: lower first. */
const RANK: Record<AlertKind, number> = { question: 0, failed: 1, finished: 2, crewReport: 3, prAttention: 3 };

/** One device's choices: the master switch, each kind, and channels that never alert (a new channel alerts until turned off). */
export interface AlertPrefs {
  enabled: boolean;
  kinds: AlertKinds;
  muted: string[];
}

export const allows = (p: AlertPrefs) => (kind: AlertKind, channelId: string) => p.enabled && p.kinds[kind] && !p.muted.includes(channelId);
