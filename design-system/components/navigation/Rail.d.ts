/**
 * The sidebar (web/src Sidebar.tsx): wordmark, pill "Search or jump to ⌘K", ink "New thread", Home, the Conductor (its
 * mark is alive), pinned views, then the thread sections (Running, Pinned, Recent threads), then channels grouped
 * Clients / Internal / Personal with "#" leads, running threads nested under each channel (max 5, then "N more").
 * A white thumb slides to the active row (Bencho stretch + settle).
 * Channels carry a running count (ultramarine ping) and a needs count (vermilion diamond) — no per-channel color.
 * Footer: usage card (5h / week ticks per harness) and the theme segmented switch.
 * @startingPoint section="Navigation" subtitle="Sidebar with sliding thumb, thread sections, nested threads, usage" viewport="260x760"
 */
export interface RailThread { id: string; title: string; state?: 'running' | 'needs' | 'done' | 'settled' | 'queued' }
export interface RailChannel {
  id: string;
  name: string;
  kind?: 'client' | 'internal' | 'personal';
  running?: number;
  needs?: number;
  threads?: RailThread[];
}
/**
 * A thread section above the channels, in this order: Running (every thread at work in any channel, hidden when none),
 * Pinned (pinned threads, latest pin first), Recent threads (the 5 with the latest activity in any channel, whatever
 * their status). Each folds under its caption, showing its count while folded. A thread also stays under its channel,
 * where the thumb stays; the section copy reads medium when open. A section with no threads is left out.
 */
export interface RailSection {
  id?: string;
  label: 'Running' | 'Pinned' | 'Recent threads' | string;
  collapsed?: boolean;
  threads?: (RailThread & { channel?: string })[];
}
export interface RailProps {
  channels?: RailChannel[];
  activeId?: string;
  onSelect?: (id: string) => void;
  conductor?: { state?: 'idle' | 'thinking' | 'delegating' | 'report' | 'attention'; needs?: number; running?: number; droplets?: number };
  onJump?: () => void;
  onNew?: () => void;
  extra?: { id: string; name: string; icon: string; meta?: string }[];
  /** Running, Pinned and Recent threads, between the Conductor and the channels. */
  sections?: RailSection[];
  /** 0–1 per window; null = no data */
  usage?: { name: string; five?: number | null; week?: number | null }[];
  usageFooter?: string;
  theme?: 'light' | 'system' | 'dark';
  onTheme?: (t: 'light' | 'system' | 'dark') => void;
  maxThreads?: number;
}
export function Rail(props: RailProps): JSX.Element;
