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
