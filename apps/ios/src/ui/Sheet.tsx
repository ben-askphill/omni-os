import type { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { fontSize, minTarget, space, useOmniTheme } from '../theme';

interface SheetProps {
  visible: boolean;
  title: string;
  onClose: () => void;
  /** The header's trailing slot, left of Done: a spinner while a request is out. */
  accessory?: ReactNode;
  children: ReactNode;
}

export function Sheet({ visible, title, onClose, accessory, children }: SheetProps) {
  const { colors } = useOmniTheme();
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose} onDismiss={onClose}>
      <View style={[styles.sheet, { backgroundColor: colors.bg }]}>
        <View style={styles.header}>
          <View style={styles.side}>{accessory}</View>
          <Text numberOfLines={1} accessibilityRole="header" style={[styles.title, { color: colors.fg }]}>
            {title}
          </Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Done" onPress={onClose} hitSlop={8} style={[styles.side, styles.done]}>
            <Text style={[styles.doneLabel, { color: colors.fg }]}>Done</Text>
          </Pressable>
        </View>
        {children}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: {
    flex: 1,
  },
  header: {
    minHeight: minTarget + space.s4,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.s8,
    paddingTop: space.s4,
  },
  side: {
    width: 64,
    minHeight: minTarget,
    justifyContent: 'center',
  },
  done: {
    alignItems: 'flex-end',
  },
  title: {
    flex: 1,
    textAlign: 'center',
    fontSize: fontSize.heading,
    fontWeight: '600',
  },
  doneLabel: {
    fontSize: fontSize.input,
    fontWeight: '600',
  },
});
