/* Omni OS Design System — component types (documentation, not type-checked). Collected from components/<group>/<Comp>.d.ts. */

// ---- components/brand/Loader.d.ts
/**
 * Loading indicator: a droplet circling the ring, merged into it as a travelling bulge.
 * Use instead of skeleton shimmer. Label in mono ("fetching 3 PRs").
 */
export interface LoaderProps {
  size?: number;
  label?: string;
  color?: string;
}
export function Loader(props: LoaderProps): JSX.Element;

// ---- components/brand/OmniLogo.d.ts
/**
 * Omni wordmark — always just "omni", no "OS". "omni" as one continuous 20u line leaning 10°; the o is the mark's ring.
 * variant: wordmark ("omni") · mark (fluid mark only).
 * `live` puts the fluid OmniMark beside the word (use on splash/about, not in chrome).
 */
export interface OmniLogoProps {
  variant?: 'wordmark' | 'mark';
  /** Rendered height in px (x-height box incl. stroke). */
  height?: number;
  live?: boolean;
  markState?: 'idle' | 'hover' | 'thinking' | 'delegating' | 'report' | 'attention';
  color?: string;
  title?: string;
}
export function OmniLogo(props: OmniLogoProps): JSX.Element;

// ---- components/brand/OmniMark.d.ts
/**
 * The fluid Omni mark. A ring with surface tension; every state means something.
 * idle = barely-breathing, satellite droplet bobs · hover = surface leans toward pointer
 * thinking = surface ripples · delegating = one droplet pinches off per crew thread spawned, then orbits
 * report = a droplet falls back in and merges · attention = held, tense, vermilion, until acknowledged.
 * Honors prefers-reduced-motion (renders StaticMark). Pass `time` to freeze a keyframe.
 * @startingPoint section="Brand" subtitle="Fluid logo mark with six motion states" viewport="700x260"
 */
export type MarkState = 'idle' | 'hover' | 'thinking' | 'delegating' | 'report' | 'attention';
export interface OmniMarkProps {
  state?: MarkState;
  /** Rendered px of the 128-unit box (ring ≈ 78% of it). */
  size?: number;
  /** Delegating: number of droplets (crew threads spawned). Default 3. */
  droplets?: number;
  /** Lean toward the pointer when it comes near. Default true. */
  interactive?: boolean;
  color?: string;
  title?: string;
  /** Freeze at t seconds (for keyframe strips). */
  time?: number;
  /** Frozen hover lean amount 0–1 and angle (rad). */
  lean?: number;
  leanAngle?: number;
  /** Attention state: click handler that acknowledges. */
  onAcknowledge?: () => void;
  className?: string;
  style?: React.CSSProperties;
}
export function OmniMark(props: OmniMarkProps): JSX.Element;

/** Clean static mark (no filter). `ring` drops the satellite droplet — use at ≤16px. */
export interface StaticMarkProps {
  size?: number;
  color?: string;
  title?: string;
  ring?: boolean;
  className?: string;
  style?: React.CSSProperties;
}
export function StaticMark(props: StaticMarkProps): JSX.Element;

// ---- components/core/Button.d.ts
import type { ReactNode, ButtonHTMLAttributes } from 'react';

/**
 * Pill button (web/src ui.tsx). primary = ink pill · secondary = surface-2 pill · ghost = Bencho hover wash that
 * springs in from the center · needs = vermilion, reserved for the action that resolves a waiting decision.
 * All variants press to scale(.96) with the settle spring. Heights 28 / 34 / 44.
 * @startingPoint section="Core" subtitle="Pill buttons: primary, secondary, ghost, needs" viewport="700x220"
 */
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'needs' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  /** Icon name or node */
  icon?: ReactNode | string;
  kbd?: string;
  busy?: boolean;
  children?: ReactNode;
}
export function Button(props: ButtonProps): JSX.Element;

// ---- components/core/IconButton.d.ts
import type { ReactNode, ButtonHTMLAttributes } from 'react';

/** 32px round icon button with the Bencho hover wash and press. `active`/`pressed` keeps the wash on. Always pass `label`. */
export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  icon?: string;
  iconSize?: number;
  size?: 'sm' | 'md';
  pressed?: boolean;
  active?: boolean;
  children?: ReactNode;
}
export function IconButton(props: IconButtonProps): JSX.Element;

// ---- components/core/Input.d.ts
import type { InputHTMLAttributes } from 'react';

/**
 * Field from web/src index.css `.field`: surface fill, 1px inset line, 14px radius, 40px tall; focus lifts to white
 * with a 4px wash ring. Errors get a vermilion edge + diamond; the message stays ink.
 */
export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
  mono?: boolean;
}
export function Input(props: InputProps): JSX.Element;

// ---- components/core/Kbd.d.ts
import type { ReactNode } from 'react';

/** Keycap (web/src Kbd): 18px, 6px radius, surface-2, SF Mono 10.5. */
export interface KbdProps {
  children: ReactNode;
  className?: string;
}
export function Kbd(props: KbdProps): JSX.Element;

// ---- components/core/Monogram.d.ts
import type { ReactNode } from 'react';

/**
 * Round letter avatar for channels and roles (web/src Avatar), SF Pro Rounded, neutral surface — no per-channel hue.
 * Pass `code` for two letters or `name` for the first letter; `icon` for Conductor (target) etc.
 */
export interface MonogramProps {
  code?: string;
  name?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl' | number;
  selected?: boolean;
  icon?: string;
  title?: string;
}
export function Monogram(props: MonogramProps): JSX.Element;

/** Task id in SF Mono, e.g. T-4F2A. */
export interface TaskIdProps {
  id: string;
  onClick?: () => void;
  href?: string;
}
export function TaskId(props: TaskIdProps): JSX.Element;

/** 20px pill chip (web/src Chip). tone: default · outline · ink · needs · done · live. */
export interface ChipProps {
  children: ReactNode;
  tone?: 'default' | 'outline' | 'ink' | 'needs' | 'done' | 'live';
  title?: string;
  className?: string;
}
export function Chip(props: ChipProps): JSX.Element;

// ---- components/core/Status.d.ts
/**
 * Status is the only place the three pops appear.
 * StatusGlyph: running = ultramarine dot with Bencho ping · needs = still vermilion diamond · done = volt disc (ink edge on white)
 * · settled = grey dot · idle/queued = hollow ring.
 * Status: the StatusPill from web/src (h24, rounded-full). Needs and done pills are filled with the pop + ink text;
 * others are surface-2 pills. No tinted washes.
 * @startingPoint section="Core" subtitle="Status dots and pills" viewport="700x180"
 */
export type StatusState = 'running' | 'needs' | 'done' | 'settled' | 'idle' | 'queued' | 'failed' | 'stopped';
export interface StatusProps {
  state?: StatusState;
  label?: string;
  showLabel?: boolean;
}
export function Status(props: StatusProps): JSX.Element;

export interface StatusGlyphProps {
  state?: StatusState;
  size?: number;
  className?: string;
}
export function StatusGlyph(props: StatusGlyphProps): JSX.Element;
export const STATUS_LABEL: Record<string, string>;

// ---- components/feedback/Toast.d.ts
import type { ReactNode } from 'react';

/**
 * Toast (Bencho "bell", web/src Toaster.tsx): 44px+, 22px radius, elev surface + menu shadow, springs in
 * (460ms spring). Used when a running thread finishes while you're elsewhere. Stack bottom-right, max 4.
 */
export interface ToastProps {
  title: ReactNode;
  body?: ReactNode;
  status?: 'running' | 'needs' | 'done' | 'settled' | 'failed';
  icon?: string;
  action?: string;
  onAction?: () => void;
  onDismiss?: () => void;
}
export function Toast(props: ToastProps): JSX.Element;

// ---- components/forms/CheckItem.d.ts
import type { ReactNode } from 'react';

/**
 * Animated to-do row (Bencho "chk", web/src ui.tsx). completed: box fills (spring), tick draws, label strikes through
 * left→right. in_progress: ink edge + a breathing ultramarine bead. Used for plans (TodoWrite) in threads.
 */
export interface CheckItemProps {
  state?: 'pending' | 'in_progress' | 'completed';
  children: ReactNode;
  onClick?: () => void;
}
export function CheckItem(props: CheckItemProps): JSX.Element;

/**
 * Progress/usage as ticks (Bencho "tick"). Off ticks sit at 55% height in a 14% ink tint; on ticks rise to full
 * height in ink (or vermilion via tone="needs" past a threshold).
 */
export interface TicksProps {
  value?: number;
  count?: number;
  height?: number;
  tone?: 'needs' | 'bad' | 'live';
  label?: string;
  className?: string;
  style?: React.CSSProperties;
}
export function Ticks(props: TicksProps): JSX.Element;

// ---- components/forms/InlineConfirm.d.ts
/**
 * Inline confirm (Bencho "say", web/src ui.tsx). A pill that asks in place: label → Cancel | Confirm → Done + Undo
 * with a burning fuse; `onConfirm` runs when the fuse is out. The shell springs between widths (340ms spring).
 * `needs` fills the confirm half in vermilion — use it when the action resolves a waiting decision.
 * @startingPoint section="Forms" subtitle="Ask-in-place confirm with undo fuse" viewport="700x160"
 */
export interface InlineConfirmProps {
  label: React.ReactNode;
  icon?: string;
  confirmLabel: string;
  cancelLabel?: string;
  doneLabel?: string;
  busyLabel?: string;
  /** Undo window in ms. Omit to confirm immediately. */
  undoMs?: number;
  needs?: boolean;
  disabled?: boolean;
  onConfirm: () => void | Promise<void>;
  className?: string;
  height?: number;
}
export function InlineConfirm(props: InlineConfirmProps): JSX.Element;

// ---- components/forms/ModelPicker.d.ts
/**
 * Model pill (web/src ModelPicker.tsx, Mac ModelPickerButton). The Picker's 32px pill with the harness logo in a 24px
 * disc and "· Harness" after the model; opens a 340px card with one search across harnesses, Auto first, then each
 * harness's models under a sticky header naming its plan ("Bills your Max plan"). The harness default reads
 * "(default)". A harness that is not installed or logged in shows "Not available. Run `cursor-agent login`."
 * In a thread's reply composer it leaves out Auto (`offerAuto={false}`) and opens upward. A pick there switches the
 * thread's run; during a turn the pick waits for the turn to end: both pills show it `queued` (ringed in live) after a
 * `NextTurnChip`, whose click keeps the current run.
 * On the phone the same choice lives in the composer's + sheet (Model and Effort rows), with a "Next turn" chip over
 * the composer while a switch waits.
 * @startingPoint section="Forms" subtitle="Model and effort pills with grouped harness list" viewport="760x560"
 */
export interface ModelChoice {
  /** 'auto' for Auto, else a harness id. */
  harness: string;
  /** '' for the harness default. */
  model: string;
}
export interface PickerModel {
  id: string;
  label: string;
  note?: string;
  default?: boolean;
  efforts?: string[];
  defaultEffort?: string;
}
export interface PickerHarness {
  id: 'claude-code' | 'codex' | 'cursor' | string;
  name: string;
  /** "Max plan" reads "Bills your Max plan"; anything else shows as given. */
  plan: string;
  available?: boolean;
  /** The command or sentence that makes it available. */
  fix?: string;
  models: PickerModel[];
}
export interface ModelPickerProps {
  harnesses: PickerHarness[];
  value: ModelChoice;
  onChange?: (v: ModelChoice) => void;
  /** Fires as the list opens, so the caller can refetch logins. */
  onOpen?: () => void;
  defaultOpen?: boolean;
  placeholder?: string;
  /** List Auto first. A thread's own pill leaves it out. */
  offerAuto?: boolean;
  /** Pill label in place of the model's name (a thread Auto started reads "Auto · Sonnet 5.5"). */
  label?: string;
  disabled?: boolean;
  /** Tooltip while disabled, e.g. "Switching". */
  disabledHelp?: string;
  /** The value is a switch queued for after this turn: ringed in live. */
  queued?: boolean;
  /** Force the card to open upward. */
  up?: boolean;
}
export function ModelPicker(props: ModelPickerProps): JSX.Element;

export interface EffortPickerProps {
  harnesses: PickerHarness[];
  choice: ModelChoice;
  /** '' for the model's default effort. */
  value: string;
  onChange?: (v: string) => void;
  disabled?: boolean;
  /** As on ModelPicker. */
  queued?: boolean;
  up?: boolean;
}
/** Effort pill: "Default (high)" plus the model's levels, or a disabled "Auto effort" when the model has none. */
export function EffortPicker(props: EffortPickerProps): JSX.Element;

export interface NextTurnChipProps {
  /** The run the thread is on now, named: "Sonnet 5.5, high". */
  now: string;
  /** Drop the queued switch: the thread keeps its run. */
  onKeep?: () => void;
  disabled?: boolean;
}
/** "Next turn ×" in live text on a 32px surface-2 pill, ahead of queued model and effort pills. */
export function NextTurnChip(props: NextTurnChipProps): JSX.Element;

// ---- components/forms/Picker.d.ts
import type { ReactNode } from 'react';

/**
 * Dropdown picker (Bencho "pik", web/src ui.tsx). 32px surface-2 pill with a 24px avatar; opens a 22px-radius card
 * that pops with the settle spring, rows 40px with a checkbox mark. Searchable past 7 options. Keyboard ↑↓ ⏎ esc.
 * Used in the composer for target (crew role), channel, harness and model.
 * @startingPoint section="Forms" subtitle="Pill picker with popover card" viewport="700x380"
 */
export interface PickerOption {
  value: string;
  label: string;
  sub?: string;
  icon?: string;
  code?: string;
  /** Letter avatar seed; false hides the avatar */
  avatar?: string | false;
  /** Custom lead node (e.g. a CrewMark) */
  lead?: ReactNode;
}
export interface PickerProps {
  value: string;
  options?: PickerOption[];
  onChange?: (v: string) => void;
  label: string;
  prefix?: ReactNode;
  lead?: ReactNode;
  searchable?: boolean;
  disabled?: boolean;
  align?: 'left' | 'right';
  /** Force the card to open upwards */
  up?: boolean;
  className?: string;
}
export function Picker(props: PickerProps): JSX.Element;

// ---- components/forms/Segmented.d.ts
import type { ReactNode, RefObject } from 'react';

/**
 * Segmented pill with a sliding thumb (Bencho "pill", web/src ui.tsx). The thumb stretches to cover the old and new
 * item (190ms stretch ease) then settles with a spring (420ms). Used for tabs, filters, theme switch.
 * @startingPoint section="Forms" subtitle="Segmented pill with sliding thumb" viewport="700x160"
 */
export interface SegOption {
  id: string;
  label?: ReactNode;
  icon?: string;
  count?: number;
  title?: string;
}
export interface SegmentedProps {
  options?: SegOption[];
  value: string;
  onChange?: (id: string) => void;
  size?: 'sm' | 'md';
  label?: string;
  radio?: boolean;
  bare?: boolean;
  /** thumb tone: default white thumb · wash · soft */
  tone?: 'wash' | 'soft';
  vertical?: boolean;
  className?: string;
}
export function Segmented(props: SegmentedProps): JSX.Element;

export interface ThumbBox { x: number; y: number; w: number; h: number; phase: 'idle' | 'stretch' | 'settle' }
/** Track the [data-active="true"] child of `track` and return where the thumb should sit. */
export function useSlidingThumb(track: RefObject<HTMLElement | null>, activeKey: unknown, vertical?: boolean, selector?: string): ThumbBox | null;
export interface ThumbProps { box: ThumbBox | null; tone?: 'wash' | 'soft'; className?: string; style?: React.CSSProperties }
export function Thumb(props: ThumbProps): JSX.Element | null;

// ---- components/forms/SlideToConfirm.d.ts
/**
 * Slide to confirm (Bencho "sld", web/src ui.tsx). 56px pill track, 48px ink grip; drag past 90% to commit, release
 * early to spring back (500ms settle). Keyboard: Enter/Space commits, → steps a quarter, ←/Esc resets.
 * Use for irreversible, deliberate actions (merge to main, send to a client, run on production).
 */
export interface SlideToConfirmProps {
  label: string;
  doneLabel?: string;
  busyLabel?: string;
  disabled?: boolean;
  onConfirm: () => void | Promise<void>;
  className?: string;
}
export function SlideToConfirm(props: SlideToConfirmProps): JSX.Element;

// ---- components/forms/Toggle.d.ts
/** Liquid toggle (Bencho, web/src ui.tsx): 38×22 pill, knob widens on press and settles across with a spring. On = ink. */
export interface ToggleProps {
  checked: boolean;
  onChange?: (v: boolean) => void;
  disabled?: boolean;
  label?: string;
}
export function Toggle(props: ToggleProps): JSX.Element;

// ---- components/icons/CrewMark.d.ts
/**
 * Compact mark for a crew role, 12–16px. Conductor = the ring itself (thick);
 * researcher = aperture; builder = block; store-ops = tag; inbox = tray.
 */
export type CrewRole = 'conductor' | 'researcher' | 'builder' | 'store-ops' | 'inbox';
export interface CrewMarkProps {
  role?: CrewRole;
  size?: number;
  className?: string;
  title?: string;
}
export function CrewMark(props: CrewMarkProps): JSX.Element;
export const CREW_ROLES: CrewRole[];

// ---- components/icons/HarnessMark.d.ts
/**
 * Harness a thread runs on, shown with the vendor's own logo (Simple Icons, monochrome, currentColor):
 * Claude Code → Claude, Codex → OpenAI, Cursor → Cursor. Logos are copied verbatim — never redrawn or colored.
 */
export type Harness = 'claude-code' | 'codex' | 'cursor';
export interface HarnessMarkProps {
  harness?: Harness;
  /** md = 20px disc / 13px logo, lg = 26px disc / 16px logo */
  size?: 'md' | 'lg';
  withLabel?: boolean;
}
export function HarnessMark(props: HarnessMarkProps): JSX.Element;

/** Bare logo glyph, for inline use (menus, palette rows, composer chip). */
export interface HarnessLogoProps {
  harness?: Harness;
  size?: number;
  title?: string;
}
export function HarnessLogo(props: HarnessLogoProps): JSX.Element | null;

/** Map free text ("Claude", "Codex", "Cursor") to a harness id, or null. */
export function harnessFor(name: string): Harness | null;

// ---- components/icons/Icon.d.ts
/**
 * Omni icon. 24-unit grid, 1.75 stroke, round caps and joins, currentColor — the set from web/src/components/ui.tsx
 * plus a few Omni additions (delegate, switchboard, split, sidebar, browser, gauge, pause, diff, more).
 * v1 names (close, chevron-right, arrow-up, pull-request, attach, loop, settings…) still resolve via aliases.
 */
export type IconName =
  | 'menu' | 'x' | 'search' | 'plus' | 'chevronRight' | 'chevronDown' | 'chevronLeft' | 'stop' | 'send' | 'arrowRight'
  | 'external' | 'download' | 'copy' | 'check' | 'undo' | 'panel' | 'branch' | 'pr' | 'sliders' | 'file' | 'image'
  | 'paperclip' | 'globe' | 'terminal' | 'clock' | 'play' | 'archive' | 'key' | 'zap' | 'layers' | 'hash' | 'target'
  | 'maximize' | 'refresh' | 'trash' | 'alert' | 'tool' | 'inbox' | 'info' | 'lock' | 'home' | 'message' | 'sun'
  | 'moon' | 'monitor' | 'bell' | 'grid' | 'delegate' | 'switchboard' | 'split' | 'sidebar' | 'browser' | 'gauge'
  | 'pause' | 'diff' | 'more' | string;
export interface IconProps {
  name: IconName;
  /** px, default 16. UI uses 12–19. */
  size?: number;
  strokeWidth?: number;
  className?: string;
  title?: string;
  style?: React.CSSProperties;
}
export function Icon(props: IconProps): JSX.Element | null;
export const ICON_PATHS: Record<string, string>;

// ---- components/navigation/CommandPalette.d.ts
/**
 * ⌘K palette (web/src CommandPalette.tsx). 620px card, 28px radius, pop-in settle spring; 64px input in SF Pro 16;
 * caption group labels; 48px rows with 28px round leads on a sliding wash thumb; "Search threads for …" row when
 * typing. Matches every word across label, sub and T-id. Ink scrim (no blur).
 * @startingPoint section="Navigation" subtitle="⌘K across channels, threads, T-ids, actions" viewport="700x560"
 */
export interface PaletteItem {
  id: string;
  group: string;
  kind: 'channel' | 'thread' | 'task' | 'command';
  label: string;
  sub?: string;
  taskId?: string;
  meta?: string;
  metaLive?: boolean;
  state?: 'idle' | 'settled' | 'running' | 'needs' | 'done';
  harness?: 'claude-code' | 'codex' | 'cursor';
  icon?: string;
  shortcut?: string;
  [k: string]: unknown;
}
export interface CommandPaletteProps {
  items?: PaletteItem[];
  onSelect?: (item: PaletteItem) => void;
  onClose?: () => void;
  initialQuery?: string;
  modal?: boolean;
  placeholder?: string;
}
export function CommandPalette(props: CommandPaletteProps): JSX.Element;

// ---- components/navigation/Rail.d.ts
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

// ---- components/navigation/TabStack.d.ts
import type { ReactNode } from 'react';

/**
 * Open threads / artifacts along the top of the main pane. The latest `visible` render as pill tabs on a sliding
 * soft thumb; older ones collapse into a surface-2 pill of 3px leaves (colored only by status) that grow on hover
 * and fan into a popover card list.
 * @startingPoint section="Navigation" subtitle="Pill tabs that stack overflow into leaves" viewport="900x300"
 */
export interface StackTab {
  id: string;
  title: string;
  kind?: 'thread' | 'artifact' | 'panel';
  taskId?: string;
  state?: 'idle' | 'settled' | 'running' | 'needs' | 'done';
}
export interface TabStackProps {
  tabs?: StackTab[];
  activeId?: string;
  visible?: number;
  onSelect?: (id: string) => void;
  onClose?: (id: string) => void;
  children?: ReactNode;
}
export function TabStack(props: TabStackProps): JSX.Element;

// ---- components/panels/GitHubPanel.d.ts
/**
 * PR panel for a crew thread's pull request: state chip, display-face title, branch → base pills, checks tray, a
 * colour-free diff tick bar (ink = additions, outlined = deletions), files, and Bencho slide-to-merge (locked until
 * checks pass). Merged = volt chip.
 * @startingPoint section="Panels" subtitle="PR panel with slide-to-merge" viewport="380x680"
 */
export interface GitHubPanelProps {
  pr: {
    number: number;
    title: string;
    repo?: string;
    state?: 'open' | 'draft' | 'merged' | 'blocked';
    branch: string;
    base?: string;
    taskId?: string;
    checks?: { name: string; state: 'running' | 'done' | 'settled' | 'needs' | 'queued'; duration?: string }[];
    additions: number;
    deletions: number;
    files?: { path: string; add: number; del: number }[];
  };
  onClose?: () => void;
  onMerge?: () => void | Promise<void>;
  /** Forwarded to Panel: controlled width, or omit to let the user drag. */
  width?: number;
  resizable?: boolean;
  onResize?: (width: number) => void;
}
export function GitHubPanel(props: GitHubPanelProps): JSX.Element;

// ---- components/panels/Panel.d.ts
import type { ReactNode } from 'react';

/**
 * Side panel beside a thread (the Thread page's `.panel-in` column): white, 1px left line, 52px header in the display
 * face, body of PanelSections — each a 20px-radius surface tray with a caption label. Slides in 18px and settles (500ms).
 * Resizable: drag the left edge (a 2px line appears on hover), double-click to reset, ←/→ nudge 16px (⇧ 48px) when focused.
 * Width persists to localStorage under `storageKey`.
 */
export interface PanelProps {
  title: string;
  meta?: string;
  icon?: string;
  onClose?: () => void;
  actions?: ReactNode;
  /** Controlled width in px. Omit to let the user drag (uncontrolled, persisted). */
  width?: number;
  /** Default true. */
  resizable?: boolean;
  /** Default 280. */
  minWidth?: number;
  /** Default 720. Also clamped so the sibling column keeps ≥ 420px; re-clamped on window resize. */
  maxWidth?: number;
  /** Width on first open and on double-click reset. Default 360. */
  defaultWidth?: number;
  /** localStorage key; pass '' to not persist. Default 'omni.panel.width' (shared by all panels). */
  storageKey?: string;
  onResize?: (width: number) => void;
  children?: ReactNode;
}
export function Panel(props: PanelProps): JSX.Element;

export interface PanelSectionProps {
  label?: string;
  meta?: string;
  children?: ReactNode;
}
export function PanelSection(props: PanelSectionProps): JSX.Element;

// ---- components/panels/UsageMeter.d.ts
/**
 * Usage meter on Bencho ticks (web/src Ticks): off ticks at 55% height in a light ink tint, used ticks rise to full
 * height in ink; past `warnAt` they turn vermilion. The sidebar uses the compact 5h / week card form.
 * @startingPoint section="Panels" subtitle="Tick usage meters" viewport="380x220"
 */
export interface UsageMeterProps {
  label: string;
  /** Harness logo before the label. Inferred from the label (Claude / Codex / Cursor) when omitted; pass null to hide. */
  harness?: 'claude-code' | 'codex' | 'cursor' | null;
  used: number;
  limit: number;
  unit?: string;
  sub?: string;
  ticks?: number;
  warnAt?: number;
  compact?: boolean;
}
export function UsageMeter(props: UsageMeterProps): JSX.Element;

// ---- components/thread/ArtifactEmbed.d.ts
import type { ReactNode } from 'react';

/**
 * Inline artifact (HTML report, CSV, file). Hairline frame, 32px mono bar (name · kind · size · split · external),
 * body is an iframe (srcDoc/src) or children, optional mono caption.
 */
export interface ArtifactEmbedProps {
  name: string;
  kind?: string;
  size?: string;
  taskId?: string;
  height?: number;
  srcDoc?: string;
  src?: string;
  caption?: string;
  onOpen?: () => void;
  children?: ReactNode;
}
export function ArtifactEmbed(props: ArtifactEmbedProps): JSX.Element;

// ---- components/thread/CloudAgent.d.ts
/**
 * One Cursor cloud agent run, in the transcript of a thread on the cursor-cloud harness. The server stores a
 * `cloud_agent` row each time the run's status, branch or PR moves; the clients fold them into one card per run, at
 * the run's first row, showing the newest state.
 * - status: CREATING "Starting" (queued glyph), RUNNING "Working" (running ping), FINISHED "Finished" (volt),
 *   ERROR "Error" and EXPIRED "Expired" (needs diamond), CANCELLED "Stopped" (settled).
 * - meta line: "Cursor cloud agent · acme/widgets from main" (the starting ref only when Cursor reported one).
 * - git line, once the agent pushed: the branch in mono, then "PR #42" linking the pull request.
 * - "Open in Cursor" always links the agent on cursor.com.
 * Colour stays on the status pill only. On the phone the card fills the turn's width.
 * @startingPoint section="Thread" subtitle="Cursor cloud agent run: starting, working, finished with a PR, stopped, error; phone" viewport="760x640"
 */
export function CloudAgentCard(props: {
  /** The agent's name, from the thread title. */
  name?: string;
  status?: 'CREATING' | 'RUNNING' | 'FINISHED' | 'ERROR' | 'CANCELLED' | 'EXPIRED';
  /** owner/name of the channel's GitHub repo. */
  repo?: string;
  /** The branch it started from, when Cursor reported it. Not `ref`: React reserves that prop. */
  startingRef?: string;
  /** The branch it pushed. */
  branch?: string;
  prUrl?: string;
  /** The agent on cursor.com. */
  url?: string;
  /** Phone layout: 20px radius, a little tighter. */
  mobile?: boolean;
}): JSX.Element;

// ---- components/thread/Composer.d.ts
/**
 * Composer (web/src Composer.tsx): 26px-radius surface shell (30px + 16px text when `big`), focus lifts to white
 * with a 4px wash ring. 60px textarea at 14.5. Bottom bar: Bencho pickers for crew role, channel and harness,
 * an attach icon button, and a round ink send button.
 * @startingPoint section="Thread" subtitle="Composer with role / channel / harness pickers" viewport="760x220"
 */
export interface ComposerProps {
  placeholder?: string;
  role?: 'conductor' | 'researcher' | 'builder' | 'store-ops' | 'inbox';
  channel?: { code?: string; name: string };
  channels?: { code?: string; name: string }[];
  harness?: 'claude-code' | 'codex' | 'cursor';
  model?: string;
  onSend?: (text: string) => void;
  hints?: boolean;
  big?: boolean;
  value?: string;
  onChange?: (v: string) => void;
  /** Open picker cards upwards (default true, composer sits at the bottom) */
  up?: boolean;
}
export function Composer(props: ComposerProps): JSX.Element;

// ---- components/thread/CrewReport.d.ts
import type { ReactNode } from 'react';

/**
 * Crew report delivered back into the Conductor thread (web/src ReportCard): 22px-radius surface card; header with a
 * 28px round crew mark, "Report from {role}", T-id, #channel, a volt "New" chip while unread, time and an
 * "Open thread" white pill; display-face title; markdown body; optional actions; mono fact line.
 * @startingPoint section="Thread" subtitle="Crew report card" viewport="760x320"
 */
export interface CrewReportProps {
  role?: 'researcher' | 'builder' | 'store-ops' | 'inbox' | 'conductor';
  taskId?: string;
  channel?: { code?: string; name: string };
  time?: string;
  title?: string;
  fresh?: boolean;
  status?: 'running' | 'needs' | 'done' | 'settled' | 'failed';
  facts?: string[];
  actions?: ReactNode;
  onOpen?: () => void;
  children?: ReactNode;
}
export function CrewReport(props: CrewReportProps): JSX.Element;

// ---- components/thread/Delegation.d.ts
import type { ReactNode } from 'react';

/**
 * Delegation tree inside a Conductor turn. 22px-radius surface card; each crew thread is an 18px-radius white branch
 * card hung off a rounded elbow. Elbow color = state (ultramarine running · vermilion needs · ink done · grey idle).
 * Put an InlineConfirm in `actions` for the decision a needs-you branch is waiting on.
 * @startingPoint section="Thread" subtitle="Conductor fan-out to crew threads" viewport="760x360"
 */
export interface DelegationBranch {
  taskId: string;
  role: 'researcher' | 'builder' | 'store-ops' | 'inbox' | 'conductor';
  title: string;
  channel?: { code?: string; name: string };
  harness?: 'claude-code' | 'codex' | 'cursor';
  state?: 'idle' | 'queued' | 'running' | 'needs' | 'done' | 'settled';
  statusLabel?: string;
  progress?: string;
  note?: ReactNode;
  actions?: ReactNode;
}
export interface DelegationProps {
  title?: string;
  branches?: DelegationBranch[];
  onOpen?: (branch: DelegationBranch) => void;
}
export function Delegation(props: DelegationProps): JSX.Element;

// ---- components/thread/Handoff.d.ts
import type { ReactNode } from 'react';

/**
 * A running thread on its way to another synced Mac, in the transcript column. Copy from packages/shared/handoff.ts
 * handoffText:
 * - giving Mac, preparing (tone working, Cancel): "Handing off to Ben's MacBook Pro: uploading the session."
 * - giving Mac, offered (tone waiting, Cancel): "Waiting for Ben's MacBook Pro to pick it up."
 * - giving Mac, offered past 90s (tone alert, Cancel): "Ben's MacBook Pro has not picked this thread up yet. It may be
 *   asleep or not running Omni."
 * - taking Mac (tone working, no button): "Ben's MacBook Air is handing this thread to this Mac."
 * - failed (tone alert, no button): "The handoff to Ben's MacBook Pro failed: <why>. The thread is stopped here; reply
 *   to continue it."
 * `note` carries what stays behind, e.g. "~/work/shop has uncommitted changes on Ben's MacBook Air; they stay there."
 * Vermilion only for alert: a handoff in progress is not something that needs you.
 * @startingPoint section="Thread" subtitle="Handoff card, line and device picker" viewport="760x620"
 */
export function HandoffCard(props: {
  tone?: 'working' | 'waiting' | 'alert';
  children?: ReactNode;
  note?: ReactNode;
  /** Cancel handoff, on the giving Mac until the other one takes it. */
  cancel?: boolean;
  /** Phone layout: no border, 20px radius. */
  mobile?: boolean;
}): JSX.Element;

/** A settled handoff, one quiet line: "Running on Ben's MacBook Pro. Handed off from this Mac." or a cancel. */
export function HandoffLine(props: { tone?: 'done' | 'cancelled'; children?: ReactNode }): JSX.Element;

/**
 * The other synced Macs a running thread can go to (GET /api/devices), from the header's share button, the thread's
 * right-click menu, the phone's thread sheet and the Mac app's Hand Off menu. Labels: "Online on Tailscale",
 * "Can't check Tailscale", "Asleep or offline, last seen 3h ago". Offline rows are disabled.
 */
export function DevicePicker(props: {
  devices?: { name: string; reachability: 'online' | 'unknown' | 'offline'; label: string }[];
  error?: ReactNode;
  title?: string;
}): JSX.Element;

// ---- components/thread/Message.d.ts
import type { ReactNode } from 'react';

/**
 * A transcript turn (web/src Transcript.tsx). role="user": right-aligned 22px bubble (top-right corner 8px) on
 * surface-2, meta line above (source · time). role="agent": markdown (.om-md, 14.5/1.62) with no bubble; an optional
 * caption meta line (crew mark · author · model · time). Agent output is a document, never a bubble.
 * @startingPoint section="Thread" subtitle="User bubble + agent markdown" viewport="760x260"
 */
export interface MessageProps {
  role?: 'user' | 'agent';
  author?: string;
  crew?: 'conductor' | 'researcher' | 'builder' | 'store-ops' | 'inbox';
  model?: string;
  time?: string;
  /** e.g. "from Conductor" on a crew thread's first message */
  source?: string;
  children?: ReactNode;
}
export function Message(props: MessageProps): JSX.Element;

/** End-of-turn rule: "DONE IN 3M 41S · 12 TURNS" between hairlines. */
export function ResultLine(props: { children?: ReactNode; ok?: boolean }): JSX.Element;

/**
 * A run switch between turns, in the result line's quiet rule: the refresh icon and the switch, with the handover's
 * progress under it. Copy comes from packages/shared/run-switch.ts (switchText, handoverNote):
 * - same harness: "Switched to effort high", "Switched to Sonnet 5.5, default effort" (no note)
 * - another harness: "Handing over from Claude Code (Opus 5.5) to Codex (GPT-6-Luna)", note "Codex reads the thread so
 *   far with your next message." until it runs, then "Handover complete. Codex read 11 entries into a new session."
 * - replaced before it ran: note "Replaced by a later switch."; back before anything ran: "Switched back to ..., which
 *   continues its own session"
 * Never a status pop: a switch is Ben's choice, not an agent's state.
 */
export function SwitchLine(props: {
  children?: ReactNode;
  /** The quiet line under it. */
  note?: ReactNode;
  /** A handover the running turn has not picked up yet: shows the loader. */
  pending?: boolean;
}): JSX.Element;

// ---- components/thread/QuestionCard.d.ts
/**
 * Question card: what an agent asked with Omni's ask_user_question tool, in the thread where it asked. 1 to 4
 * questions, each 2 to 4 options plus a free-text Other the card always adds. Pending: a 22px surface card with a
 * surface-2 header (header tag, question, pager "1 of 4"), radio rows (checkbox rows when multiSelect), bold label
 * plus a one-line description, Other with a field, and Skip plus an ink Next (Send on the last page) with a ⌘↵ hint.
 * A vermilion "Needs your input" pill sits under it. Once Ben acts it collapses to a read-only summary.
 * Keyboard in the apps: ↑/↓ rows, Space toggles, ←/→ pages, ⌘↵ Next or Send.
 * @startingPoint section="Thread" subtitle="Agent asks you, pending and answered" viewport="760x560"
 */
export interface QuestionOption {
  label: string;
  description: string;
}
export interface Question {
  question: string;
  /** At most 12 characters. */
  header?: string;
  options: QuestionOption[];
  multiSelect: boolean;
}
/** One per question. Null: Ben skipped that one. */
export type Answer = { selected: string[]; other: string | null } | null;
export interface QuestionCardProps {
  questions: Question[];
  answers?: Answer[] | null;
  state?: 'pending' | 'answered' | 'skipped' | 'dismissed';
  /** Phone layout: 44px rows and buttons, no ⌘↵ hint. */
  touch?: boolean;
  onSend?: (answers: Answer[]) => void;
}
export function QuestionCard(props: QuestionCardProps): JSX.Element;

// ---- components/thread/ThreadRow.d.ts
import type { ReactNode } from 'react';

/**
 * Thread row (web/src ThreadList.tsx). 18px-radius row with a Bencho hover wash; 32px round lead holding the status
 * dot (or channel avatar + dot badge when `channel` is set); line 1: 14px title, flags/chips, mono time; line 2:
 * harness, branch pill, preview, T-id. Idle rows drop to regular weight in fg-2. Compact density hides line 2.
 * @startingPoint section="Thread" subtitle="Thread list row + day group" viewport="760x320"
 */
export interface ThreadRowProps {
  title: string;
  taskId?: string;
  state?: 'idle' | 'settled' | 'queued' | 'running' | 'needs' | 'done' | 'failed';
  harness?: 'claude-code' | 'codex' | 'cursor';
  /** Crew role shown as a chip */
  role?: string;
  crew?: string;
  source?: string;
  time?: string;
  branch?: string;
  meta?: string;
  preview?: string;
  /** Show the channel avatar + #name (cross-channel lists) */
  channel?: string;
  /**
   * Ben marked it done: out of Needs you, still listed in its channel. A grey check replaces the status dot, the
   * title goes fg-4 and an outline Done chip shows, whatever `state` is.
   */
  markedDone?: boolean;
  selected?: boolean;
  onClick?: () => void;
}
export function ThreadRow(props: ThreadRowProps): JSX.Element;

/** A day group: sticky caption label + count, rows rise in with a 28ms stagger. */
export interface ThreadGroupProps { label: string; count?: number; children?: ReactNode }
export function ThreadGroup(props: ThreadGroupProps): JSX.Element;

// ---- components/thread/ToolCall.d.ts
import type { ReactNode } from 'react';

/**
 * Tool calls (web/src Transcript.tsx). ToolCall: 32px pill row (caret · icon · name · mono args · duration/loader/error)
 * with a hover wash; opens to a 12px-radius mono pre. ToolCalls: groups 2+ calls in a 20px-radius surface card with a
 * 40px "N tool calls · names" header that expands. The caret rotates with the settle spring.
 */
export interface ToolCallProps {
  name: string;
  args?: string;
  status?: 'running' | 'done' | 'failed';
  duration?: string;
  output?: string;
  defaultOpen?: boolean;
}
export function ToolCall(props: ToolCallProps): JSX.Element;
export function ToolCalls(props: { children?: ReactNode; defaultOpen?: boolean; live?: boolean }): JSX.Element;

// ---- components/mobile/MoButtons.d.ts
/**
 * Phone buttons. Same props on web (MoButtons.jsx) and Expo (native/MoButtons.tsx).
 * MoRoundButton: 40pt round; default surface-2, ink = the one primary action (send, stop), quiet = no fill on a surface.
 * MoActionChip: 36pt pill for this thread's next step; needs = an answer to a question.
 * @startingPoint section="Phone" subtitle="Round buttons and action chips" viewport="860x180"
 */
export interface MoRoundButtonProps {
  icon: string;
  /** Accessible label; also the tooltip on web. */
  label: string;
  onPress?: () => void;
  tone?: 'default' | 'ink' | 'quiet';
  /** 40 by default; 32 inside sheets. Hit area stays 44pt on Expo. */
  size?: number;
  disabled?: boolean;
}
export function MoRoundButton(props: MoRoundButtonProps): JSX.Element;

export interface MoActionChipProps {
  label: string;
  icon?: string;
  tone?: 'default' | 'ink' | 'needs';
  /** Lines added and removed, shown after the label: [214, 38]. */
  diff?: [number, number];
  onPress?: () => void;
}
export function MoActionChip(props: MoActionChipProps): JSX.Element;

// ---- components/mobile/MoHeader.d.ts
/**
 * MoHeader: pushed-screen header, 52pt under the status bar: back, title + subtitle, up to two trailing actions.
 * MoLargeTitle: 30/1.1 title on tab roots only; the subtitle counts running (live text) and needs you (ink, medium).
 * @startingPoint section="Phone" subtitle="Headers and large titles" viewport="860x300"
 */
export interface MoHeaderProps {
  title?: React.ReactNode;
  sub?: React.ReactNode;
  /** Shows the back button. */
  onBack?: () => void;
  /** Leading content when there is no back button (the Conductor mark on Activity). */
  left?: React.ReactNode;
  right?: React.ReactNode;
  /** Skip the status-bar inset (inside a sheet or a preview). */
  flush?: boolean;
}
export function MoHeader(props: MoHeaderProps): JSX.Element;

export interface MoLargeTitleProps {
  title: string;
  /** Leading context: "Friday 23 October". */
  sub?: string;
  needs?: number;
  running?: number;
}
export function MoLargeTitle(props: MoLargeTitleProps): JSX.Element;

// ---- components/mobile/MoSection.d.ts
/**
 * List section: 12pt medium caption in fg-3, a quiet count, an optional trailing action. Pads 16pt unless flush.
 * @startingPoint section="Phone" subtitle="List section heading" viewport="860x200"
 */
export interface MoSectionProps {
  title: string;
  count?: number;
  right?: React.ReactNode;
  flush?: boolean;
  children?: React.ReactNode;
}
export function MoSection(props: MoSectionProps): JSX.Element;

// ---- components/mobile/MoThreadRow.d.ts
/**
 * MoThreadRow: one row wherever a thread is listed on the phone. 36pt crew avatar with the status glyph, 15pt title,
 * time, then channel and meta; running progress in live text; diff or artifact count on the right.
 * MoAvatar: crew mark in a surface-2 disc with the status glyph on its corner. MoDiff: +add −del, tabular.
 * @startingPoint section="Phone" subtitle="Thread rows: needs, running, done" viewport="860x320"
 */
export type MoState = 'running' | 'needs' | 'done' | 'settled' | 'idle' | 'queued' | 'failed' | 'stopped';
export type MoRole = 'conductor' | 'researcher' | 'builder' | 'store-ops' | 'inbox';

export interface MoThreadRowProps {
  title: string;
  state?: MoState;
  role?: MoRole;
  /** Without the #. */
  channel?: string;
  /** Running only, in live text: "step 5/9", "140 of 212". */
  progress?: string;
  meta?: string;
  time?: string;
  diff?: [number, number];
  artifacts?: number;
  /** Drops the hairline under the last row of a list. */
  last?: boolean;
  onPress?: () => void;
  /** Expo only: open the thread menu. */
  onLongPress?: () => void;
}
export function MoThreadRow(props: MoThreadRowProps): JSX.Element;

export interface MoAvatarProps {
  role?: MoRole;
  state?: MoState;
  size?: number;
}
export function MoAvatar(props: MoAvatarProps): JSX.Element;
export function MoDiff(props: { add: number; del: number }): JSX.Element;

// ---- components/mobile/MoList.d.ts
/**
 * MoGroup: inset group on surface, radius 20. MoListRow: 52pt row inside it: icon, label and sub, value or control,
 * chevron when it pushes; the hairline starts after the icon. MoRadio: 20pt radio, ink when on.
 * @startingPoint section="Phone" subtitle="Grouped lists" viewport="860x300"
 */
export interface MoGroupProps {
  children: React.ReactNode;
}
export function MoGroup(props: MoGroupProps): JSX.Element;

export interface MoListRowProps {
  /** An icon name, or a node (a StatusGlyph, a Toggle on web, a Switch on Expo). */
  icon?: string | React.ReactNode;
  label: string;
  sub?: string;
  /** Right-aligned value in fg-3, tabular: "3", "Claude Code". */
  value?: string;
  /** A control on the right. */
  right?: React.ReactNode;
  onPress?: () => void;
  /** Defaults to true when onPress is set. */
  chevron?: boolean;
  last?: boolean;
}
export function MoListRow(props: MoListRowProps): JSX.Element;
export function MoRadio(props: { on: boolean }): JSX.Element;

// ---- components/mobile/MoDecisionCard.d.ts
/**
 * MoDecisionCard: the agent's question with the buttons that answer it, the same card in Activity and in the thread.
 * kind confirm = body text · draft = the draft on a white sheet · choice = radio options, one recommended.
 * The answer is a 48pt vermilion pill, the only filled vermilion on the screen.
 * MoResolvedStrip: what replaces the card once answered, with Undo.
 * @startingPoint section="Phone" subtitle="Needs-you decision cards" viewport="860x900"
 */
export interface MoDecisionOption {
  label: string;
  sub?: string;
  recommended?: boolean;
}
export interface MoDecisionCardProps {
  kind?: 'confirm' | 'draft' | 'choice';
  title: string;
  channel?: string;
  role?: 'conductor' | 'researcher' | 'builder' | 'store-ops' | 'inbox';
  /** Delegated by the Conductor. */
  via?: boolean;
  time?: string;
  body?: string;
  draftTo?: string;
  draft?: string;
  options?: MoDecisionOption[];
  confirmLabel?: string;
  denyLabel?: string;
  /** For choice, the picked option's index. */
  onConfirm?: (pick?: number) => void;
  onDeny?: () => void;
  /** Tapping the head opens the thread (Activity only). */
  onOpen?: () => void;
  /** In the thread: no avatar or meta, title only. */
  inThread?: boolean;
}
export function MoDecisionCard(props: MoDecisionCardProps): JSX.Element;
export function MoResolvedStrip(props: { text: string; onUndo?: () => void }): JSX.Element;

// ---- components/mobile/MoTabBar.d.ts
/**
 * Floating 60pt tab pill on elev with the menu shadow, the ink new-delegation disc beside it. The thumb springs
 * between tabs; a vermilion diamond rides Activity while anything needs you. Hidden on pushed screens.
 * @startingPoint section="Phone" subtitle="Tab bar with the new-delegation disc" viewport="860x200"
 */
export interface MoTab {
  id: string;
  icon: string;
  label: string;
}
export const MO_TABS: MoTab[];
export interface MoTabBarProps {
  /** Activity, Channels, Library, PRs by default. */
  tabs?: MoTab[];
  value: string;
  onChange: (id: string) => void;
  /** Count of threads waiting on you; any above zero shows the diamond. */
  needs?: number;
  /** Shows the new-delegation disc. */
  onNew?: () => void;
  /** Web only: static lays it out in flow (previews); float pins it 28pt above the bottom. */
  placement?: 'float' | 'static';
}
export function MoTabBar(props: MoTabBarProps): JSX.Element;

// ---- components/mobile/MoSheet.d.ts
/**
 * Bottom sheet: 28pt top corners, 36 × 5 grabber, optional title row with a close button, scrim tap closes.
 * Thread menu, attach + model + effort, search, new delegation. On Expo it renders in a Modal; pass visible.
 * @startingPoint section="Phone" subtitle="Bottom sheet" viewport="860x560"
 */
export interface MoSheetProps {
  /** Expo only. On web, mount it to show it. */
  visible?: boolean;
  title?: string;
  onClose: () => void;
  /** Stops just below the top instead of hugging its content. */
  full?: boolean;
  right?: React.ReactNode;
  children: React.ReactNode;
}
export function MoSheet(props: MoSheetProps): JSX.Element;

// ---- components/mobile/MoComposer.d.ts
/**
 * Composer pinned above the keyboard: action chips, then + (attach, model, effort), the field, and mic until there is
 * text, then send. Stop replaces mic while a turn runs and the box is empty. Placeholder names who you talk to.
 * @startingPoint section="Phone" subtitle="Composer: done, running, typing" viewport="860x380"
 */
export interface MoComposerProps {
  placeholder?: string;
  /** Controlled text; omit to let the composer hold it. */
  value?: string;
  onChangeText?: (v: string) => void;
  actions?: MoActionChipProps[];
  onSend?: (text: string) => void;
  onPlus?: () => void;
  /** Set while a turn runs: shows Stop when the box is empty. */
  onStop?: () => void;
  onDictate?: () => void;
  /** Attachment or context chips between the action chips and the box. */
  children?: React.ReactNode;
  /** Expo only: "Steer" or "Queue" when the message will not start a turn. */
  sendLabel?: string;
}
export function MoComposer(props: MoComposerProps): JSX.Element;

// ---- components/mobile/MoBubble.d.ts
/**
 * Your message: right-aligned surface-2 bubble, 15/1.45, max 86% wide, a caption above (who sent it, or why it failed).
 * @startingPoint section="Phone" subtitle="User bubble: sent, sending, failed" viewport="860x320"
 */
export interface MoBubbleProps {
  caption?: string;
  state?: 'sent' | 'sending' | 'failed';
  children: React.ReactNode;
}
export function MoBubble(props: MoBubbleProps): JSX.Element;

// ---- components/mobile/MoArtifactCard.d.ts
/**
 * An artifact in the thread: a white 150pt peek of the page on a surface card, the name in mono, maximize to open.
 * live adds the running glyph while the agent is still writing it.
 * @startingPoint section="Phone" subtitle="Artifact card" viewport="860x300"
 */
export interface MoArtifactCardProps {
  name: string;
  sub?: string;
  /** Web: an image URL. Expo: an ImageSourcePropType. A snapshot of the page. */
  image?: unknown;
  live?: boolean;
  onPress?: () => void;
}
export function MoArtifactCard(props: MoArtifactCardProps): JSX.Element;

// ---- components/mobile/MoToast.d.ts
/**
 * Ink pill that springs up 112pt above the bottom: what just happened, in a few words, with an optional status glyph.
 * @startingPoint section="Phone" subtitle="Toast" viewport="860x140"
 */
export interface MoToastProps {
  status?: 'running' | 'needs' | 'done' | 'settled' | 'failed';
  /** Web only: static lays it out in flow (previews). */
  placement?: 'float' | 'static';
  children: React.ReactNode;
}
export function MoToast(props: MoToastProps): JSX.Element;
