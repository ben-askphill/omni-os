import { HarnessLogo } from '../../ui/Brand';
import type { HarnessInfo } from '@omni/client-core';
import { Pressable, StyleSheet } from 'react-native';
import { Text } from '../../ui/Text';
import { Icon } from '../../ui/Icon';

import { chipHeight, chipSlop, fontSize, radius, space, useOmniTheme, weight } from '../../theme';
import { nextTurnLabel, runChipLabel, type RunThread } from '../../thread/run-model';

interface RunChipProps {
  thread: RunThread;
  /** Null until `/harnesses` loads. */
  harnesses: HarnessInfo[] | null;
  onPress: () => void;
}

/**
 * The model button inside the composer, between the text and Send: the harness logo and a chevron. VoiceOver reads the
 * model and effort the thread runs on ("Sonnet 5.5 · high"). Tapping it opens the switch sheet.
 */
export function ModelButton({ thread, harnesses, onPress }: RunChipProps) {
  const { colors } = useOmniTheme();
  const label = runChipLabel(thread, harnesses);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label ? `Model: ${label}` : 'Model'}
      accessibilityHint="Opens the model and effort switch"
      hitSlop={{ top: 4, bottom: 4, left: 2, right: 2 }}
      onPress={onPress}
      style={({ pressed }) => [styles.model, { backgroundColor: pressed ? colors.surface3 : 'transparent' }]}
    >
      <HarnessLogo harness={thread.harness ?? 'claude-code'} size={18} />
      <Icon name="chevronDown" size={10} strokeWidth={2} color={colors.fg3} />
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
      hitSlop={chipSlop}
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
    height: chipHeight,
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
  model: {
    height: chipHeight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderRadius: radius.pill,
    paddingLeft: space.s4,
    paddingRight: space.s3,
  },
  label: {
    flexShrink: 1,
    fontSize: fontSize.body,
    fontWeight: weight.medium,
  },
});
