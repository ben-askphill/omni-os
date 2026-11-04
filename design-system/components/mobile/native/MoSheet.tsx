import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, SlideInDown, SlideOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MoRoundButton } from './MoButtons';
import { motion, phone, type, useOmniTheme } from './theme';

/**
 * Bottom sheet for secondary choices: thread menu, attach with model and effort, search, new delegation.
 * 28pt top corners, a 36 × 5 grabber, scrim tap closes. full stops 56pt below the top.
 * For drag-to-dismiss and detents, render the same content in a native formSheet screen (react-native-screens).
 */
export function MoSheet({ visible, title, onClose, full = false, right, children }: {
  visible: boolean; title?: string; onClose: () => void; full?: boolean; right?: ReactNode; children: ReactNode;
}) {
  const { colors, shadow } = useOmniTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      {visible && (
        <View style={StyleSheet.absoluteFill}>
          <Animated.View entering={FadeIn.duration(motion.duration.enter)} exiting={FadeOut.duration(motion.duration.enter)} style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }]}>
            <Pressable accessibilityLabel="Close" style={StyleSheet.absoluteFill} onPress={onClose} />
          </Animated.View>
          <Animated.View accessibilityViewIsModal entering={SlideInDown.duration(motion.duration.sheet)} exiting={SlideOutDown.duration(motion.duration.enter)}
            style={[styles.panel, { top: full ? insets.top + 8 : undefined, maxHeight: '92%', paddingBottom: Math.max(insets.bottom, 20), backgroundColor: colors.bg, boxShadow: shadow.menu }]}>
            <View style={[styles.grabber, { backgroundColor: colors.surface3 }]} />
            {title ? (
              <View style={styles.head}>
                <Text accessibilityRole="header" numberOfLines={1} style={[type.sheetTitle, { flex: 1, color: colors.fg }]}>{title}</Text>
                {right}
                <MoRoundButton icon="x" label="Close" size={phone.roundSmall} onPress={onClose} />
              </View>
            ) : null}
            <ScrollView contentContainerStyle={styles.body}>{children}</ScrollView>
          </Animated.View>
        </View>
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  panel: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopLeftRadius: phone.sheetRadius, borderTopRightRadius: phone.sheetRadius, overflow: 'hidden' },
  grabber: { width: phone.grabber.width, height: phone.grabber.height, borderRadius: 3, alignSelf: 'center', marginTop: 8, marginBottom: 2 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingTop: 4, paddingBottom: 8, paddingLeft: 20, paddingRight: 16 },
  body: { gap: 16, paddingHorizontal: 16 },
});
