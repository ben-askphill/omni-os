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
