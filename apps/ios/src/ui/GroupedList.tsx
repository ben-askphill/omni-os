import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

import { fontSize, lineHeight, minTarget, radius, space, useOmniTheme, weight } from '../theme';

export function GroupedList({ children }: { children: ReactNode }) {
  const { colors } = useOmniTheme();
  return <View style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.line }]}>{children}</View>;
}

export interface ListRowProps {
  title: string;
  /** A line icon before the title, as phone web's settings rows have. */
  icon?: IconName;
  /** Drawn before the title in place of `icon`, such as a channel's avatar. */
  lead?: ReactNode;
  detail?: string;
  value?: string;
  /** Replaces the value at the trailing edge, such as a switch. */
  trailing?: ReactNode;
  chevron?: boolean;
  tone?: 'default' | 'destructive';
  onPress?: () => void;
  disabled?: boolean;
  /** The first row of a group has no line above it. */
  first?: boolean;
  accessibilityHint?: string;
}

export function ListRow({ title, icon, lead, detail, value, trailing, chevron, tone = 'default', onPress, disabled, first, accessibilityHint }: ListRowProps) {
  const { colors } = useOmniTheme();
  const body = (
    <>
      {lead ?? (icon ? <Icon name={icon} size={18} color={tone === 'destructive' ? colors.fg : colors.fg2} /> : null)}
      <View style={styles.text}>
        <Text style={[styles.title, { color: colors.fg, opacity: disabled ? 0.5 : 1 }, tone === 'destructive' && styles.destructive]}>
          {title}
        </Text>
        {detail ? <Text style={[styles.detail, { color: colors.fg3 }]}>{detail}</Text> : null}
      </View>
      {trailing ?? (value ? <Text style={[styles.value, { color: colors.fg3 }]}>{value}</Text> : null)}
      {chevron ? <Icon name="chevronRight" size={13} weight="semibold" color={colors.fg4} /> : null}
    </>
  );
  const frame = [styles.row, !first && { borderTopColor: colors.line, borderTopWidth: StyleSheet.hairlineWidth }];
  if (!onPress) return <View style={frame}>{body}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[title, value, detail].filter(Boolean).join(', ')}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [frame, pressed && { backgroundColor: colors.surface2 }]}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  group: {
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  row: {
    minHeight: minTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s7,
    paddingHorizontal: space.s8,
    paddingVertical: space.s6,
  },
  text: {
    flex: 1,
    gap: space.s2 / 2,
  },
  title: {
    fontSize: fontSize.subhead,
  },
  destructive: {
    fontWeight: weight.semibold,
  },
  detail: {
    fontSize: fontSize.small,
    lineHeight: Math.round(fontSize.small * lineHeight.body),
  },
  value: {
    fontSize: fontSize.body,
  },
});
