import { previewSections, type PreviewRow, type PreviewSection } from '@omni/shared/continue-flow.ts';
import type { Carryover } from '@omni/shared/continue.ts';
import { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { fontSize, lineHeight, minTarget, radius, space, useOmniTheme } from '../../theme';
import { OptionGroup } from '../../ui/OptionRow';
import { Tag } from './Tag';

const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });

/** What the new session is given, section by section: goal, constraints, changed files, checks, recent history, what was left out. */
export function CarryoverSections({ carryover }: { carryover: Carryover }) {
  return (
    <>
      {previewSections(carryover).map((section) => (
        <Section key={section.id} section={section} />
      ))}
    </>
  );
}

function Section({ section }: { section: PreviewSection }) {
  const { colors } = useOmniTheme();
  const lines = section.rows.length + (section.more ? 1 : 0);
  return (
    <OptionGroup title={section.title} trailing={section.count === null ? undefined : String(section.count)}>
      {section.rows.map((row, i) => (
        <View key={row.key} style={[styles.row, i < lines - 1 && { borderBottomColor: colors.line, borderBottomWidth: StyleSheet.hairlineWidth }]}>
          {row.label ? <Text style={[styles.who, { color: colors.fg3 }]}>{row.label}</Text> : null}
          <RowText row={row} />
          {row.tag ? <Tag label={row.tag} tone={row.tone} /> : null}
        </View>
      ))}
      {section.more ? <Text style={[styles.more, { color: colors.fg3 }]}>{section.more}</Text> : null}
    </OptionGroup>
  );
}

function RowText({ row }: { row: PreviewRow }) {
  const { colors } = useOmniTheme();
  return (
    <View style={styles.text}>
      <Text numberOfLines={4} style={[row.code ? styles.code : styles.plain, { color: colors.fg }]}>
        {row.text}
      </Text>
      {row.sub ? (
        <Text numberOfLines={2} style={[styles.sub, row.subCode && styles.mono, { color: colors.fg3 }]}>
          {row.sub}
        </Text>
      ) : null}
    </View>
  );
}

/** The Carryover exactly as the new session reads it, folded until asked for. */
export function ExactText({ text }: { text: string }) {
  const { colors } = useOmniTheme();
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.exact}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Show exact text"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((v) => !v)}
        style={styles.toggle}
      >
        <Text style={[styles.toggleLabel, { color: colors.fg }]}>{open ? '▾ Show exact text' : '▸ Show exact text'}</Text>
      </Pressable>
      {open ? (
        <ScrollView nestedScrollEnabled style={[styles.box, { backgroundColor: colors.surface }]}>
          <Text selectable style={[styles.mono, styles.boxText, { color: colors.fg2 }]}>
            {text}
          </Text>
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.s6,
    paddingHorizontal: space.s8,
    paddingVertical: space.s6,
  },
  who: {
    width: 52,
    fontSize: fontSize.body,
  },
  text: {
    flex: 1,
    gap: 2,
  },
  plain: {
    fontSize: fontSize.body + 1,
    lineHeight: Math.round((fontSize.body + 1) * lineHeight.body),
  },
  code: {
    fontFamily: MONO,
    fontSize: fontSize.body - 1,
    lineHeight: Math.round((fontSize.body - 1) * lineHeight.body),
  },
  mono: {
    fontFamily: MONO,
  },
  sub: {
    fontSize: fontSize.meta + 1,
    lineHeight: Math.round((fontSize.meta + 1) * lineHeight.body),
  },
  more: {
    paddingHorizontal: space.s8,
    paddingVertical: space.s6,
    fontSize: fontSize.body,
  },
  exact: {
    paddingHorizontal: space.s8,
    gap: space.s4,
  },
  toggle: {
    minHeight: minTarget,
    justifyContent: 'center',
  },
  toggleLabel: {
    fontSize: fontSize.body,
    fontWeight: '600',
  },
  box: {
    maxHeight: 360,
    borderRadius: radius.md,
  },
  boxText: {
    padding: space.s6,
    fontSize: fontSize.meta + 1,
    lineHeight: Math.round((fontSize.meta + 1) * lineHeight.body),
  },
});
