import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from './Icon';
import { MoRadio } from './MoList';
import { MoAvatar } from './MoThreadRow';
import { Press } from './Press';
import { StatusGlyph } from './StatusGlyph';
import { phone, type, useOmniTheme } from './theme';

/** After answering: a pill strip with the outcome and Undo. */
export function MoResolvedStrip({ text, onUndo }: { text: string; onUndo?: () => void }) {
  const { colors } = useOmniTheme();
  return (
    <View style={[styles.resolved, { backgroundColor: colors.surface }]}>
      <StatusGlyph state="done" size={9} />
      <Text numberOfLines={1} style={[type.body, { flex: 1, color: colors.fg2, lineHeight: 18 }]}>{text}</Text>
      {onUndo && (
        <Press accessibilityRole="button" onPress={onUndo} style={styles.undo}>
          <Icon name="undo" size={14} color={colors.fg} /><Text style={[type.chip, { color: colors.fg, fontSize: 13 }]}>Undo</Text>
        </Press>
      )}
    </View>
  );
}

export type MoDecisionOption = { label: string; sub?: string; recommended?: boolean };

export type MoDecisionCardProps = {
  kind?: 'confirm' | 'draft' | 'choice'; title: string; channel?: string; role?: string; via?: boolean; time?: string;
  body?: string; draftTo?: string; draft?: string; options?: MoDecisionOption[];
  confirmLabel?: string; denyLabel?: string; onConfirm?: (pick?: number) => void; onDeny?: () => void; onOpen?: () => void; inThread?: boolean;
};

/**
 * The decision card: the agent's question and the buttons that answer it, in Activity and in the thread.
 * The answer is a 48pt vermilion pill, the only filled vermilion on the screen.
 */
export function MoDecisionCard({ kind = 'confirm', title, channel, role = 'conductor', via, time, body, draftTo, draft, options = [], confirmLabel = 'Approve', denyLabel, onConfirm, onDeny, onOpen, inThread = false }: MoDecisionCardProps) {
  const { colors, shadow } = useOmniTheme();
  const [pick, setPick] = useState(Math.max(0, options.findIndex((o) => o.recommended)));
  const meta = [channel && '#' + channel, role, via && 'via Conductor'].filter(Boolean).join(' · ');
  const sheet = [styles.sheet, { backgroundColor: colors.elev, boxShadow: shadow.card }];
  return (
    <View style={[styles.card, { backgroundColor: colors.surface }]}>
      {inThread ? <Text style={[type.cardTitle, { color: colors.fg }]}>{title}</Text> : (
        <Pressable accessibilityRole="button" onPress={onOpen} style={styles.head}>
          <MoAvatar role={role} state="needs" />
          <View style={styles.headText}>
            <Text style={[type.meta, { color: colors.fg3 }]}>{meta}</Text>
            <Text style={[type.cardTitle, { color: colors.fg }]}>{title}</Text>
          </View>
          {time ? <Text style={[type.meta, { color: colors.fg3 }]}>{time}</Text> : null}
        </Pressable>
      )}
      {kind === 'confirm' && body ? <Text style={[type.body, { color: colors.fg2 }]}>{body}</Text> : null}
      {kind === 'draft' && (
        <View style={[sheet, styles.draft]}>
          {draftTo ? <Text style={[type.caption, { color: colors.fg3 }]}>Draft to {draftTo}</Text> : null}
          <Text style={[type.body, { color: colors.fg2 }]}>{draft}</Text>
        </View>
      )}
      {kind === 'choice' && (
        <View style={sheet} accessibilityRole="radiogroup">
          {options.map((o, i) => (
            <Pressable key={o.label} accessibilityRole="radio" accessibilityState={{ checked: pick === i }} onPress={() => setPick(i)}
              style={[styles.opt, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.lineStrong }]}>
              <View style={{ paddingTop: 1 }}><MoRadio on={pick === i} /></View>
              <View style={{ flex: 1, gap: 2 }}>
                <View style={styles.optHead}>
                  <Text style={[type.option, { color: colors.fg }]}>{o.label}</Text>
                  {o.recommended && (
                    <View style={[styles.rec, { borderColor: colors.lineStrong }]}><Text style={[type.tab, { color: colors.fg3 }]}>Recommended</Text></View>
                  )}
                </View>
                {o.sub ? <Text style={[type.sub, { fontSize: 13, color: colors.fg3 }]}>{o.sub}</Text> : null}
              </View>
            </Pressable>
          ))}
        </View>
      )}
      <View style={styles.actions}>
        <Press accessibilityRole="button" onPress={() => onConfirm?.(kind === 'choice' ? pick : undefined)} style={[styles.answer, { backgroundColor: colors.needs }]}>
          <Text style={[type.answer, { color: colors.onNeeds }]}>{confirmLabel}</Text>
        </Press>
        {denyLabel && (
          <Press accessibilityRole="button" onPress={onDeny} style={[styles.answer, { backgroundColor: colors.surface2 }]}>
            <Text style={[type.answer, { color: colors.fg }]}>{denyLabel}</Text>
          </Press>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: phone.cardRadius, padding: 14, gap: 12 },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  headText: { flex: 1, minWidth: 0, gap: 3 },
  sheet: { borderRadius: phone.innerRadius, overflow: 'hidden' },
  draft: { paddingVertical: 12, paddingHorizontal: 14, gap: 6 },
  opt: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 12, paddingHorizontal: 14 },
  optHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rec: { height: 20, paddingHorizontal: 8, borderRadius: 999, borderWidth: 1, justifyContent: 'center' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  answer: { flexGrow: 1, height: phone.answerH, paddingHorizontal: 16, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  resolved: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingLeft: 16, paddingRight: 8, borderRadius: 999 },
  undo: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, paddingHorizontal: 14, borderRadius: 999 },
});
