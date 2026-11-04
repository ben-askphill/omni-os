import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { phone, type, useOmniTheme } from './theme';

/** Your message, right-aligned in a surface-2 bubble, who sent it above. sending fades it; failed puts the reason in the caption. */
export function MoBubble({ caption, state = 'sent', children }: { caption?: string; state?: 'sent' | 'sending' | 'failed'; children: ReactNode }) {
  const { colors } = useOmniTheme();
  return (
    <View style={styles.wrap}>
      {caption ? <Text style={[type.meta, { color: state === 'failed' ? colors.fg : colors.fg3 }]}>{caption}</Text> : null}
      <View style={[styles.body, { backgroundColor: colors.bubble, opacity: state === 'sending' ? 0.6 : 1 }]}>
        {typeof children === 'string' ? <Text style={[type.bubble, { color: colors.fg }]}>{children}</Text> : children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'flex-end', gap: 4 },
  body: { maxWidth: '86%', paddingVertical: 10, paddingHorizontal: 14, borderRadius: phone.cardRadius },
});
