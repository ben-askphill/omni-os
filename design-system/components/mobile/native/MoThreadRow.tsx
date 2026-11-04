import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CrewMark } from './CrewMark';
import { Icon } from './Icon';
import { StatusGlyph, type StatusState } from './StatusGlyph';
import { phone, type, useOmniTheme } from './theme';

/** Crew mark in a surface-2 disc with the status glyph on its corner. */
export function MoAvatar({ role = 'conductor', state, size = phone.avatar }: { role?: string; state?: StatusState; size?: number }) {
  const { colors } = useOmniTheme();
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' }}>
      <CrewMark role={role} size={Math.round(size * 0.46)} color={colors.fg2} />
      {state && (
        <View style={[styles.badge, { backgroundColor: colors.bg }]}><StatusGlyph state={state} size={8} /></View>
      )}
    </View>
  );
}

export function MoDiff({ add, del }: { add: number; del: number }) {
  const { colors } = useOmniTheme();
  return (
    <Text style={[type.sub, { fontVariant: ['tabular-nums'] }]}>
      <Text style={{ color: colors.fg2 }}>+{add}</Text> <Text style={{ color: colors.fg3 }}>−{del}</Text>
    </Text>
  );
}

export type MoThreadRowProps = {
  title: string; state?: StatusState; role?: string; channel?: string; progress?: string; meta?: string; time?: string;
  diff?: [number, number]; artifacts?: number; last?: boolean; onPress?: () => void; onLongPress?: () => void;
};

/**
 * One row wherever a thread is listed. Running progress reads in live text; needs-you titles are medium; finished
 * titles drop to fg-2. Wrap it in a swipe row for Pin, Done and Archive.
 */
export function MoThreadRow({ title, state = 'settled', role, channel, progress, meta, time, diff, artifacts, last, onPress, onLongPress }: MoThreadRowProps) {
  const { colors } = useOmniTheme();
  const settled = state === 'done' || state === 'settled';
  const lead = [channel && '#' + channel, state === 'needs' ? 'Needs you' : null, meta].filter(Boolean).join(' · ');
  return (
    <Pressable accessibilityRole="button" onPress={onPress} onLongPress={onLongPress}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.wash }]}>
      <MoAvatar role={role} state={state} />
      <View style={[styles.main, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.lineStrong }]}>
        <View style={styles.top}>
          <Text numberOfLines={1} style={[state === 'needs' ? type.rowStrong : type.row, styles.grow, { color: settled ? colors.fg2 : colors.fg }]}>{title}</Text>
          {time ? <Text style={[type.meta, { color: colors.fg3 }]}>{time}</Text> : null}
        </View>
        <View style={styles.sub}>
          <Text numberOfLines={1} style={[type.sub, styles.grow, { color: colors.fg3 }]}>
            {lead}
            {state === 'running' && progress ? <Text style={{ color: colors.live, fontVariant: ['tabular-nums'] }}>{lead ? ' · ' : ''}{progress}</Text> : null}
          </Text>
          {diff && <MoDiff add={diff[0]} del={diff[1]} />}
          {artifacts ? (
            <View style={styles.count}><Icon name="file" size={13} color={colors.fg3} /><Text style={[type.sub, { color: colors.fg3 }]}>{artifacts}</Text></View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  badge: { position: 'absolute', right: -1, bottom: -1, width: 14, height: 14, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 10, paddingHorizontal: 4, borderRadius: phone.innerRadius },
  main: { flex: 1, minWidth: 0, gap: 2, paddingBottom: 10 },
  top: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  sub: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  grow: { flex: 1, minWidth: 0 },
  count: { flexDirection: 'row', alignItems: 'center', gap: 4 },
});
