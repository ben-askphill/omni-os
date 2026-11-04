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
