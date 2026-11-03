import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../../ui/Text';

import type { NeedsButton, NeedsGlyph, NeedsRow as NeedsRowModel } from '../../live/activity-model';
import { fontSize, lineHeight, minTarget, space, useOmniTheme, weight } from '../../theme';
import { Button } from '../../ui/Button';
import { type DotTone, StatusDot } from '../StatusDot';

const TONE: Record<NeedsGlyph, DotTone> = { needs: 'warn', done: 'ok', settled: 'muted' };

/**
 * A Needs you item as phone web's card heads it: where it came from, the thread, then why it is here. Tapping opens the
 * thread. The buttons under it answer on the spot (Retry, Resume, Mark done) or open the thread to Answer. One button
 * runs at a time, and a failure shows under the row.
 */
export function NeedsRow({ row, onPress, onButton }: { row: NeedsRowModel; onPress: () => void; onButton: (b: NeedsButton) => Promise<void> }) {
  const { colors } = useOmniTheme();
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const title = row.thread.title || 'Untitled';
  const press = async (b: NeedsButton) => {
    if (running) return;
    setRunning(b.key);
    setError(null);
    try {
      await onButton(b);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'Something went wrong');
    } finally {
      setRunning(null);
    }
  };
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={[title, row.label, row.detail, row.meta].filter(Boolean).join(', ')}
        onPress={onPress}
        style={({ pressed }) => [styles.row, { backgroundColor: pressed ? colors.surface2 : colors.bg }]}
      >
        <View style={styles.dot}>
          <StatusDot tone={TONE[row.glyph]} />
        </View>
        <View style={styles.body}>
          <Text numberOfLines={1} style={[styles.meta, { color: colors.fg3 }]}>
            {row.meta}
          </Text>
          <View style={styles.top}>
            <Text numberOfLines={2} style={[styles.title, { color: colors.fg }]}>
              {title}
            </Text>
            <Text style={[styles.ago, { color: colors.fg3 }]}>{row.ago}</Text>
          </View>
          <Text numberOfLines={4} style={[styles.reason, { color: colors.fg2 }]}>
            <Text style={{ color: colors.fg }}>{row.label}</Text>
            {row.detail ? ` · ${row.detail}` : null}
          </Text>
        </View>
      </Pressable>
      {row.buttons.length > 0 ? (
        <View style={styles.buttons}>
          {row.buttons.map((b, i) => (
            <Button
              key={b.key}
              label={b.label}
              variant={i === 0 && row.glyph === 'needs' ? 'primary' : 'secondary'}
              busy={running === b.key}
              disabled={running !== null && running !== b.key}
              onPress={() => void press(b)}
            />
          ))}
        </View>
      ) : null}
      {error ? <Text style={[styles.error, { color: colors.fg }]}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  buttons: {
    flexDirection: 'row',
    gap: space.s4,
    paddingLeft: space.s9 + 5 + space.s6,
    paddingRight: space.s9,
    paddingBottom: space.s6,
  },
  error: {
    fontSize: fontSize.meta,
    paddingHorizontal: space.s9,
    paddingBottom: space.s4,
  },
  row: {
    minHeight: minTarget,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.s6,
    paddingHorizontal: space.s9,
    paddingVertical: space.s6,
  },
  dot: {
    paddingTop: 5,
  },
  body: {
    flex: 1,
    gap: space.s2,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.s4,
  },
  title: {
    flex: 1,
    fontSize: fontSize.input,
    lineHeight: Math.round(fontSize.input * lineHeight.heading),
    fontWeight: weight.medium,
  },
  ago: {
    fontSize: fontSize.meta,
    fontVariant: ['tabular-nums'],
  },
  reason: {
    fontSize: fontSize.body,
    lineHeight: Math.round(fontSize.body * lineHeight.body),
  },
  meta: {
    fontSize: fontSize.meta,
  },
});
