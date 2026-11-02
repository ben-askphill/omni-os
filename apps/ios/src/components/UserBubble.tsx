import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { fontSize, lineHeight, radius, space, useOmniTheme } from '../theme';

/** What Ben said, right-aligned with a caption under it. The transcript and the outbox draw it the same way. */
export function UserBubble({
  text,
  caption,
  busy = false,
  dimmed = false,
  children,
}: {
  text: string;
  caption: string;
  /** Shows a spinner beside the caption, for a message still on its way. */
  busy?: boolean;
  /** Fades the message text, for one that did not go out. The caption and buttons stay readable. */
  dimmed?: boolean;
  children?: ReactNode;
}) {
  const { colors } = useOmniTheme();
  return (
    <View style={styles.wrap}>
      <View style={[styles.bubble, { backgroundColor: colors.surface2 }]}>
        <Text selectable style={[styles.text, { color: colors.fg }, dimmed && styles.dimmed]}>
          {text}
        </Text>
        {busy ? (
          <View style={styles.captionRow}>
            <ActivityIndicator size="small" color={colors.fg3} />
            <Text style={[styles.caption, { color: colors.fg3 }]}>{caption}</Text>
          </View>
        ) : (
          <Text style={[styles.caption, { color: colors.fg3 }]}>{caption}</Text>
        )}
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'flex-end',
  },
  bubble: {
    maxWidth: '86%',
    borderRadius: radius.xl,
    paddingHorizontal: space.s8,
    paddingVertical: space.s6,
    gap: space.s2,
  },
  dimmed: {
    opacity: 0.6,
  },
  text: {
    fontSize: fontSize.input,
    lineHeight: Math.round(fontSize.input * lineHeight.body),
  },
  captionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s2,
  },
  caption: {
    fontSize: fontSize.meta,
  },
});
