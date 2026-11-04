import { useState } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from './Icon';
import type { IconName } from './icon-paths';
import { Press } from './Press';
import { StatusGlyph } from './StatusGlyph';
import { motion, phone, type, useOmniTheme } from './theme';

export type MoTab = { id: string; icon: IconName; label: string };

export const MO_TABS: MoTab[] = [
  { id: 'activity', icon: 'inbox', label: 'Activity' },
  { id: 'channels', icon: 'hash', label: 'Channels' },
  { id: 'library', icon: 'layers', label: 'Library' },
  { id: 'prs', icon: 'pr', label: 'PRs' },
];

/**
 * Labelled tabs in a floating 60pt pill on elev with the menu shadow, the ink new-delegation disc beside it. The thumb
 * springs between tabs. A vermilion diamond rides Activity while anything needs you. Use as a custom tabBar for
 * @react-navigation/bottom-tabs, or absolutely positioned over a stack. Hidden on pushed screens.
 */
export function MoTabBar({ tabs = MO_TABS, value, onChange, needs = 0, onNew }: {
  tabs?: MoTab[]; value: string; onChange: (id: string) => void; needs?: number; onNew?: () => void;
}) {
  const { colors, shadow } = useOmniTheme();
  const insets = useSafeAreaInsets();
  const [w, setW] = useState(0);
  const i = Math.max(0, tabs.findIndex((t) => t.id === value));
  const seg = w > 0 ? (w - 8) / tabs.length : 0;
  const thumb = useAnimatedStyle(() => ({ transform: [{ translateX: withSpring(i * seg, motion.spring) }] }), [i, seg]);
  return (
    <View style={[styles.wrap, { bottom: Math.max(insets.bottom, 20) - phone.tabbarLift }]} pointerEvents="box-none">
      <View accessibilityRole="tablist" onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)}
        style={[styles.bar, { backgroundColor: colors.elev, boxShadow: shadow.menu }]}>
        {seg > 0 && <Animated.View style={[styles.thumb, { width: seg, backgroundColor: colors.surface2 }, thumb]} />}
        {tabs.map((t) => {
          const on = t.id === value;
          const c = on ? colors.fg : colors.fg3;
          return (
            <Pressable key={t.id} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={t.id === 'activity' && needs ? `${t.label}, ${needs} need you` : t.label}
              onPress={() => onChange(t.id)} style={styles.tab}>
              <View>
                <Icon name={t.icon} size={20} color={c} />
                {t.id === 'activity' && needs > 0 && (
                  <View style={[styles.badge, { backgroundColor: colors.elev }]}><StatusGlyph state="needs" size={8} /></View>
                )}
              </View>
              <Text style={[type.tab, { color: c }]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {onNew && (
        <Press accessibilityRole="button" accessibilityLabel="New delegation" onPress={onNew}
          style={[styles.new, { backgroundColor: colors.fg, boxShadow: shadow.menu }]}>
          <Icon name="plus" size={22} color={colors.onInk} />
        </Press>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: phone.tabbarInset, right: phone.tabbarInset, flexDirection: 'row', gap: 10, zIndex: 20 },
  bar: { flex: 1, height: phone.tabbarH, padding: 4, borderRadius: 999, flexDirection: 'row' },
  thumb: { position: 'absolute', top: 4, bottom: 4, left: 4, borderRadius: 999 },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4 },
  badge: { position: 'absolute', top: -3, right: -7, width: 13, height: 13, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  new: { width: phone.tabbarH, height: phone.tabbarH, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
});
