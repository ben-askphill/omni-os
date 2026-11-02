import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { fontSize, radius, space, useOmniTheme } from '../theme';
import { formatBytes, type Staged } from './model';

const THUMB = 56;

/**
 * The files chosen for a message, as a row of chips: a thumbnail for an image, an icon and the name for anything
 * else. With `onRemove` each chip has a remove button. Without it the chips only show what is going out.
 */
export function AttachmentChips({ files, onRemove, dimmed = false }: { files: readonly Staged[]; onRemove?: (id: string) => void; dimmed?: boolean }) {
  if (files.length === 0) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      accessibilityLabel={`${files.length} attached ${files.length === 1 ? 'file' : 'files'}`}
      contentContainerStyle={styles.row}
      style={dimmed && styles.dimmed}
    >
      {files.map((file) => (
        <Chip key={file.id} file={file} onRemove={onRemove} />
      ))}
    </ScrollView>
  );
}

function Chip({ file, onRemove }: { file: Staged; onRemove?: (id: string) => void }) {
  const { colors } = useOmniTheme();
  return (
    <View style={styles.chipWrap}>
      {file.image ? (
        <Image accessibilityLabel={file.name} source={{ uri: file.uri }} style={[styles.thumb, { backgroundColor: colors.surface3 }]} />
      ) : (
        <View style={[styles.file, { backgroundColor: colors.surface2, borderColor: colors.line }]}>
          <Text style={styles.fileGlyph}>📄</Text>
          <View style={styles.fileText}>
            <Text numberOfLines={1} ellipsizeMode="middle" style={[styles.fileName, { color: colors.fg }]}>
              {file.name}
            </Text>
            {file.size !== null ? <Text style={[styles.fileSize, { color: colors.fg3 }]}>{formatBytes(file.size)}</Text> : null}
          </View>
        </View>
      )}
      {onRemove ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Remove ${file.name}`}
          hitSlop={8}
          onPress={() => onRemove(file.id)}
          style={[styles.remove, { backgroundColor: colors.fg, borderColor: colors.bg }]}
        >
          <Text style={[styles.removeGlyph, { color: colors.onInk }]}>×</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: space.s4,
    paddingTop: space.s2,
    paddingRight: space.s4,
  },
  dimmed: {
    opacity: 0.6,
  },
  chipWrap: {
    paddingTop: 6,
    paddingRight: 6,
  },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: radius.md - 2,
  },
  file: {
    height: THUMB,
    maxWidth: 190,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s4,
    paddingHorizontal: space.s6,
    borderRadius: radius.md - 2,
    borderWidth: StyleSheet.hairlineWidth,
  },
  fileGlyph: {
    fontSize: 22,
  },
  fileText: {
    flexShrink: 1,
    gap: 1,
  },
  fileName: {
    fontSize: fontSize.body - 1,
    fontWeight: '500',
  },
  fileSize: {
    fontSize: fontSize.meta,
  },
  remove: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeGlyph: {
    fontSize: 14,
    lineHeight: 16,
    fontWeight: '700',
  },
});
