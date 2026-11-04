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
