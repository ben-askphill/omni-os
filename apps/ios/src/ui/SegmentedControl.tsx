import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';

import { fontSize, minTarget, radius, space, useOmniTheme, weight } from '../theme';
import { selection } from './haptics';

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
            onPress={() => {
              if (!selected) selection();
              onChange(option.value);
            }}
            style={[styles.segment, selected && [styles.thumb, { backgroundColor: colors.thumb }]]}
          >
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85} style={[styles.label, { color: selected ? colors.fg : colors.fg3 }]}>
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
  // Each segment grows from its own width, so a long label ("Needs you 12") takes the room a short one leaves.
  segment: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 'auto',
    paddingHorizontal: space.s4,
    minHeight: minTarget - space.s4,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // A slight lift for the selected segment.
  thumb: {
    shadowColor: '#17181a',
    shadowOpacity: 0.09,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
  },
  label: {
    fontSize: fontSize.ui,
    fontWeight: weight.semibold,
  },
  count: {
    fontSize: fontSize.meta,
    fontVariant: ['tabular-nums'],
  },
});
