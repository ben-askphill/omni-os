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
