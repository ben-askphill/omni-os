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
