import { StyleSheet, Text } from 'react-native';

import { fontSize, space, useOmniTheme } from '../theme';

/** A section label in a list, such as "Active" or a folder name, with how many rows it holds when given. */
export function ListHeading({ children, count }: { children: string; count?: number }) {
  const { colors } = useOmniTheme();
  return (
    <Text
      accessibilityRole="header"
      accessibilityLabel={count === undefined ? undefined : `${children}, ${count}`}
      style={[styles.heading, { color: colors.fg3 }]}
    >
      {children}
      {count === undefined ? null : <Text style={{ color: colors.fg4 }}>{`  ${count}`}</Text>}
    </Text>
  );
}

const styles = StyleSheet.create({
  heading: {
    fontSize: fontSize.meta,
    fontWeight: '600',
    textTransform: 'uppercase',
    paddingHorizontal: space.s9,
    paddingTop: space.s9,
    paddingBottom: space.s4,
  },
});
