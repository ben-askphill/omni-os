import { NOTES_FOLD, NOTES_TITLE, reportFolds, reportShape } from '@omni/shared/report-shape.ts';
import type { ReportP } from '@omni/shared/transcript-fold.ts';
import { useMemo, useState, type ReactNode } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { chipHeight, chipSlop, fontSize, minTarget, radius, space, useOmniTheme, weight } from '../../../theme';
import { Icon } from '../../../ui/Icon';
import { Text } from '../../../ui/Text';
import { Markdown } from '../Markdown';
import { useRowActions } from './actions';

/**
 * A crew report's body, as the web's ReportBody draws it: the outcome first, its pull requests as chips, each part the
 * agent wrote under a heading folded, and what it said while it worked folded last (report-shape.ts).
 */
export function ReportBody({ r }: { r: ReportP }) {
  const { colors } = useOmniTheme();
  const { openThread } = useRowActions();
  const shape = useMemo(() => reportShape(r.text || '(no reply)', r.notes), [r.text, r.notes]);
  const folds = reportFolds(shape);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(folds.open));
  const toggle = (key: string) =>
    setOpen((was) => {
      const next = new Set(was);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  return (
    <View style={styles.body}>
      {shape.lead ? <Markdown text={shape.lead} onOpenThread={openThread} /> : null}
      {shape.prs.length ? (
        <View style={styles.chips}>
          {shape.prs.map((pr) => (
            <Pressable
              key={pr.href}
              accessibilityRole="link"
              accessibilityLabel={`Open pull request ${pr.label.replace(/^PR /, '')}`}
              hitSlop={chipSlop}
              onPress={() => void Linking.openURL(pr.href)}
              style={({ pressed }) => [styles.chip, { backgroundColor: pressed ? colors.surface3 : colors.bg, borderColor: colors.line }]}
            >
              <Icon name="pr" size={13} color={colors.fg3} />
              <Text style={[styles.chipText, { color: colors.fg }]}>{pr.label}</Text>
              <Icon name="arrowUpRight" size={12} color={colors.fg3} />
            </Pressable>
          ))}
        </View>
      ) : null}
      {folds.keys.length ? (
        <View style={[styles.sections, { borderColor: colors.line }]}>
          {shape.sections.map((s, i) => (
            <Section key={s.key} title={s.title} count={s.count} first={i === 0} open={open.has(s.key)} onToggle={() => toggle(s.key)}>
              <Markdown text={s.body} onOpenThread={openThread} />
            </Section>
          ))}
          {shape.notes.length ? (
            <Section title={NOTES_TITLE} count={shape.notes.length} first={!shape.sections.length} open={open.has(NOTES_FOLD)} onToggle={() => toggle(NOTES_FOLD)}>
              <View style={[styles.notes, { borderColor: colors.line }]}>
                {shape.notes.map((n, i) => (
                  <Markdown key={i} text={n} onOpenThread={openThread} quiet />
                ))}
              </View>
            </Section>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function Section({ title, count, first, open, onToggle, children }: { title: string; count: number | null; first: boolean; open: boolean; onToggle: () => void; children: ReactNode }) {
  const { colors } = useOmniTheme();
  return (
    <View style={!first && [styles.divided, { borderTopColor: colors.line }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={count === null ? title : `${title}, ${count}`}
        onPress={onToggle}
        style={({ pressed }) => [styles.trigger, pressed && { backgroundColor: colors.surface3 }]}
      >
        <Text numberOfLines={1} style={[styles.title, { color: colors.fg }]}>
          {title}
        </Text>
        {count !== null ? (
          <View style={[styles.count, { backgroundColor: colors.surface3 }]}>
            <Text style={[styles.countText, { color: colors.fg2 }]}>{count}</Text>
          </View>
        ) : null}
        <View style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}>
          <Icon name="chevronDown" size={14} color={colors.fg3} />
        </View>
      </Pressable>
      {open ? <View style={styles.panel}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { gap: space.s6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s3 },
  chip: { height: chipHeight, flexDirection: 'row', alignItems: 'center', gap: space.s3, paddingHorizontal: space.s6, borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth },
  chipText: { fontSize: fontSize.ui, fontWeight: weight.medium },
  sections: { borderWidth: 1, borderRadius: radius.md + 2, overflow: 'hidden' },
  divided: { borderTopWidth: 1 },
  trigger: { minHeight: minTarget, flexDirection: 'row', alignItems: 'center', gap: space.s4, paddingHorizontal: space.s7 },
  title: { flex: 1, fontSize: fontSize.body, fontWeight: weight.medium },
  count: { borderRadius: radius.pill, paddingHorizontal: space.s4, paddingVertical: space.s1 },
  countText: { fontSize: fontSize.caption, fontWeight: weight.medium, fontVariant: ['tabular-nums'] },
  panel: { paddingHorizontal: space.s7, paddingBottom: space.s6 },
  notes: { gap: space.s4, borderLeftWidth: 1, paddingLeft: space.s6 },
});
