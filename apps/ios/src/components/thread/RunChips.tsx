import type { HarnessInfo } from '@omni/client-core';
import { Pressable, StyleSheet, Text } from 'react-native';

import { fontSize, radius, space, useOmniTheme } from '../../theme';
import { nextTurnLabel, runChipLabel, type RunThread } from '../../thread/run-model';

interface RunChipProps {
  thread: RunThread;
  /** Null until `/harnesses` loads. */
  harnesses: HarnessInfo[] | null;
  onPress: () => void;
}

/** The model and effort the thread runs on ("Sonnet 5.5 · high"). Tapping it opens the switch sheet. Hidden until the catalog loads. */
export function RunChip({ thread, harnesses, onPress }: RunChipProps) {
  const { colors } = useOmniTheme();
  const label = runChipLabel(thread, harnesses);
  if (!label) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Model: ${label}`}
      accessibilityHint="Opens the model and effort switch"
      onPress={onPress}
      style={({ pressed }) => [styles.chip, { backgroundColor: pressed ? colors.surface3 : colors.surface2 }]}
    >
      <Text numberOfLines={1} style={[styles.label, { color: colors.fg }]}>
        {label}
      </Text>
      <Text style={[styles.caret, { color: colors.fg3 }]}>▾</Text>
    </Pressable>
  );
}

/**
 * "Next turn · Codex": shown while a switch picked during a turn waits for the turn to end. Renders nothing otherwise, so
 * the composer can place it without a condition. Tapping it opens the switch sheet.
 */
export function NextTurnChip({ thread, harnesses, onPress }: RunChipProps) {
  const { colors } = useOmniTheme();
  const next = nextTurnLabel(thread, harnesses);
  if (!next) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Next turn runs on ${next}`}
      onPress={onPress}
      style={({ pressed }) => [styles.chip, styles.next, { backgroundColor: pressed ? colors.surface3 : colors.surface2, borderColor: colors.fg3 }]}
    >
      <Text style={[styles.label, { color: colors.fg3 }]}>Next turn</Text>
      <Text numberOfLines={1} style={[styles.label, { color: colors.fg }]}>
        {next}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    height: 36,
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s4,
    borderRadius: radius.pill,
    paddingHorizontal: space.s6,
  },
  next: {
    borderWidth: 1,
  },
  label: {
    flexShrink: 1,
    fontSize: fontSize.body,
    fontWeight: '500',
  },
  caret: {
    fontSize: fontSize.meta,
  },
});
