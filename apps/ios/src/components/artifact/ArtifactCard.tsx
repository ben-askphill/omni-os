import type { Artifact } from '@omni/client-core';
import { Image, Pressable, StyleSheet, View } from 'react-native';

import { useArtifactFile } from '../../artifacts/use-artifact-file';
import { extensionOf, hasThumbnail } from '../../artifacts/viewer-kind';
import { fontSize, radius, space, useOmniTheme } from '../../theme';
import { Icon } from '../../ui/Icon';
import { Text } from '../../ui/Text';

/**
 * One file as a card: a picture of an image, else its kind drawing and extension, then its name and where it came from.
 * The Library's grid and a thread's Artifacts screen draw it. `where` is the line under the name ("#omni-os · 5m").
 */
export function ArtifactCard({ artifact, width, tall, where, onOpen }: { artifact: Artifact; width: number; tall: boolean; where: string; onOpen: () => void }) {
  const { colors } = useOmniTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${artifact.name}, ${artifact.kind}, ${where}`}
      onPress={onOpen}
      style={({ pressed }) => [styles.card, { width, backgroundColor: colors.surface, opacity: pressed ? 0.7 : 1 }]}
    >
      <View style={[styles.thumb, { height: tall ? 170 : 110, backgroundColor: colors.surface3 }]}>
        {hasThumbnail(artifact.kind) ? <Thumbnail artifact={artifact} /> : <Label artifact={artifact} />}
      </View>
      <View style={styles.meta}>
        <Text numberOfLines={1} style={[styles.name, { color: colors.fg }]}>
          {artifact.name}
        </Text>
        <Text numberOfLines={1} style={[styles.where, { color: colors.fg3 }]}>
          {where}
        </Text>
      </View>
    </Pressable>
  );
}

function Thumbnail({ artifact }: { artifact: Artifact }) {
  const load = useArtifactFile(artifact);
  if (load.status !== 'ready') return <Label artifact={artifact} />;
  return <Image source={{ uri: load.file.uri }} resizeMode="cover" style={StyleSheet.absoluteFill} accessibilityIgnoresInvertColors />;
}

/** The shared kind drawing and extension when a file has no thumbnail. */
function Label({ artifact }: { artifact: Artifact }) {
  const { colors } = useOmniTheme();
  return (
    <View style={styles.label}>
      <Icon name={artifact.kind === 'image' || artifact.kind === 'screenshot' ? 'image' : artifact.kind === 'html' || artifact.kind === 'svg' ? 'globe' : 'file'} size={24} color={colors.fg3} />
      <Text style={[styles.ext, { color: colors.fg3 }]}>{extensionOf(artifact.name)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    padding: space.s2 + 2,
    gap: space.s4,
  },
  thumb: {
    borderRadius: radius.md - 1,
    overflow: 'hidden',
  },
  meta: {
    paddingHorizontal: space.s2 + 2,
    paddingBottom: space.s2 + 2,
    gap: space.s1,
  },
  name: {
    fontSize: fontSize.small,
    fontFamily: 'Menlo',
  },
  where: {
    fontSize: fontSize.caption,
  },
  label: {
    flex: 1,
    gap: space.s4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ext: {
    fontSize: fontSize.body,
    fontFamily: 'Menlo',
    textTransform: 'uppercase',
  },
});
