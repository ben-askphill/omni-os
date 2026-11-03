import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';

import { fontSize, lineHeight, minTarget, space, useOmniTheme, weight } from '../theme';

interface OptionRowProps {
  label: string;
  sub?: string | null;
  leading?: ReactNode;
  /** Draws the radio. Leave undefined for a row that is not a choice. */
  selected?: boolean;
  /** A chevron after the label, for a row that opens another page of the sheet. */
  opens?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  last?: boolean;
  depth?: number;
}

/** A row of a sheet's grouped list: a choice (with a radio), an action, or a line of text when it has no `onPress`. */
export function OptionRow({ label, sub, leading, selected, opens, disabled, onPress, last, depth = 0 }: OptionRowProps) {
  const { colors } = useOmniTheme();
  return (
    <Pressable
      accessibilityRole={selected === undefined ? 'button' : 'radio'}
      accessibilityLabel={sub ? `${label}, ${sub}` : label}
      accessibilityState={{ disabled: !!disabled, selected }}
      disabled={disabled || !onPress}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: pressed ? colors.surface3 : 'transparent', opacity: disabled ? 0.45 : 1, paddingLeft: space.s8 + depth * space.s8 },
      ]}
    >
      {leading ? <View style={styles.leading}>{leading}</View> : null}
      <View style={[styles.body, !last && { borderBottomColor: colors.line, borderBottomWidth: StyleSheet.hairlineWidth }]}>
        <View style={styles.text}>
          <Text style={[styles.label, { color: colors.fg }]}>{label}</Text>
          {sub ? <Text style={[styles.sub, { color: colors.fg3 }]}>{sub}</Text> : null}
        </View>
        {selected === undefined ? null : <Radio on={selected} />}
        {opens ? <Text style={[styles.chevron, { color: colors.fg4 }]}>›</Text> : null}
      </View>
    </Pressable>
  );
}

function Radio({ on }: { on: boolean }) {
  const { colors } = useOmniTheme();
  return (
    <View style={[styles.radio, { borderColor: on ? colors.fg : colors.lineStrong }]}>
      {on ? <View style={[styles.dot, { backgroundColor: colors.fg }]} /> : null}
    </View>
  );
}

/** A titled group of rows on a rounded surface, as the settings lists on iOS draw them. */
export function OptionGroup({ title, trailing, children }: { title?: string; trailing?: string; children: ReactNode }) {
  const { colors } = useOmniTheme();
  return (
    <View style={styles.group}>
      {title ? (
        <View style={styles.groupHeading}>
          <Text accessibilityRole="header" style={[styles.groupTitle, { color: colors.fg3 }]}>
            {title}
          </Text>
          {trailing ? <Text style={[styles.groupTitle, { color: colors.fg4 }]}>{trailing}</Text> : null}
        </View>
      ) : null}
      <View style={[styles.card, { backgroundColor: colors.surface }]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: minTarget + 4,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: space.s8,
  },
  leading: {
    width: 28,
    marginRight: space.s6,
    alignItems: 'center',
  },
  body: {
    flex: 1,
    minHeight: minTarget + 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s6,
    paddingRight: space.s8,
    paddingVertical: space.s4,
  },
  text: {
    flex: 1,
    gap: 2,
  },
  label: {
    fontSize: fontSize.input,
  },
  sub: {
    fontSize: fontSize.meta + 1,
    lineHeight: Math.round((fontSize.meta + 1) * lineHeight.body),
  },
  chevron: {
    fontSize: 22,
    lineHeight: 24,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  group: {
    gap: space.s4,
  },
  groupHeading: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: space.s9,
  },
  groupTitle: {
    fontSize: fontSize.meta,
    fontWeight: weight.semibold,
    textTransform: 'uppercase',
  },
  card: {
    marginHorizontal: space.s8,
    borderRadius: 14,
    overflow: 'hidden',
  },
});
