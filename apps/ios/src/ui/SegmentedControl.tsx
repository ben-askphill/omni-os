import { Pressable, StyleSheet, Text, View } from 'react-native';

import { fontSize, minTarget, radius, space, useOmniTheme } from '../theme';

interface SegmentedControlProps<T extends string> {
  options: readonly { value: T; label: string; count?: number }[];
  value: T;
  onChange: (value: T) => void;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: SegmentedControlProps<T>) {
  const { colors } = useOmniTheme();

  return (
    <View style={[styles.track, { backgroundColor: colors.surface2 }]}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityLabel={option.count === undefined ? option.label : `${option.label}, ${option.count}`}
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            style={[styles.segment, selected && { backgroundColor: colors.bg }]}
          >
            <Text numberOfLines={1} style={[styles.label, { color: selected ? colors.fg : colors.fg3 }]}>
              {option.label}
              {option.count === undefined ? null : <Text style={[styles.count, { color: colors.fg4 }]}>{` ${option.count}`}</Text>}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    borderRadius: radius.pill,
    padding: space.s2,
  },
  segment: {
    flex: 1,
    minHeight: minTarget - space.s4,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: fontSize.body,
    fontWeight: '600',
  },
  count: {
    fontSize: fontSize.meta,
    fontVariant: ['tabular-nums'],
  },
});
