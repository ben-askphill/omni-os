import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../../ui/Text';

import type { CommandList, SlashCommand } from '@omni/client-core';
import { SOURCE_TAG, rowKey, type MenuSection } from '@omni/shared/slash-menu.ts';

import { fontSize, mono, radius, space, useOmniTheme, weight } from '../../theme';

const ROW = 52;

/**
 * The `/` menu over the box, as the Web UI's: the commands Ben used last, then the rest by where they come from, or one
 * ranked list while he types a name (packages/shared/slash-menu.ts). Tapping a row puts `/name ` in the box.
 */
export function CommandMenu({ list, sections, technical, onPick }: { list: CommandList | null; sections: MenuSection[]; technical: boolean; onPick: (c: SlashCommand) => void }) {
  const { colors } = useOmniTheme();
  const loading = !list || list.status === 'loading';
  const empty = !sections.some((s) => s.commands.length);
  return (
    <View accessibilityLabel="Commands" style={[styles.menu, { backgroundColor: colors.elev, borderColor: colors.line }]}>
      <ScrollView keyboardShouldPersistTaps="always" style={styles.list}>
        {/* A thread's menu lists Omni's own commands either way, so say why the harness's are missing. */}
        {list?.status === 'unavailable' ? (
          <Text style={[styles.note, { color: colors.fg3 }]}>
            {"Couldn't read the commands."}
            {list.fix ? ` Run ${list.fix} in a terminal to see why.` : ''}
          </Text>
        ) : null}
        {loading && empty ? (
          <View style={styles.loading}>
            <ActivityIndicator size="small" color={colors.fg3} />
            <Text style={[styles.note, styles.loadingText, { color: colors.fg3 }]}>Loading commands</Text>
          </View>
        ) : null}
        {sections.map((s) => (
          <View key={s.label ?? 'matches'}>
            {s.label ? (
              <Text accessibilityRole="header" style={[styles.label, { color: colors.fg3 }]}>
                {s.label}
              </Text>
            ) : null}
            {s.commands.map((c) => (
              <Pressable
                key={rowKey(c)}
                accessibilityRole="button"
                accessibilityLabel={`/${c.name}${c.description ? `, ${c.description}` : ''}`}
                onPress={() => onPick(c)}
                style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surface2 }]}
              >
                <View style={styles.text}>
                  <View style={styles.nameLine}>
                    <Text numberOfLines={1} style={[styles.name, { color: colors.fg }]}>{`/${c.name}`}</Text>
                    {c.argumentHint ? (
                      <Text numberOfLines={1} style={[styles.hint, { color: colors.fg3 }]}>
                        {c.argumentHint}
                      </Text>
                    ) : null}
                  </View>
                  {c.description ? (
                    <Text numberOfLines={1} style={[styles.description, { color: colors.fg3 }]}>
                      {c.description}
                    </Text>
                  ) : null}
                </View>
                {/* Where a command comes from (project, plugin, mcp) is for whoever writes them: Show technical details. */}
                {technical ? (
                  <Text style={[styles.tag, { color: colors.fg3, backgroundColor: colors.surface2 }]}>{SOURCE_TAG[c.source]}</Text>
                ) : null}
              </Pressable>
            ))}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  menu: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: space.s2,
  },
  list: {
    maxHeight: ROW * 4.5,
  },
  label: {
    fontSize: fontSize.caption,
    fontWeight: weight.semibold,
    paddingHorizontal: space.s6,
    paddingTop: space.s4,
    paddingBottom: space.s2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s5,
    minHeight: ROW,
    paddingHorizontal: space.s6,
  },
  text: {
    flex: 1,
    minWidth: 0,
  },
  nameLine: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: space.s3,
  },
  name: {
    flexShrink: 0,
    maxWidth: '70%',
    fontFamily: mono,
    fontSize: fontSize.ui,
    fontWeight: weight.medium,
  },
  hint: {
    flexShrink: 1,
    fontFamily: mono,
    fontSize: fontSize.caption,
  },
  description: {
    fontSize: fontSize.caption,
  },
  tag: {
    overflow: 'hidden',
    borderRadius: radius.pill,
    paddingHorizontal: space.s3,
    paddingVertical: 1,
    fontSize: fontSize.meta,
  },
  note: {
    fontSize: fontSize.caption,
    paddingHorizontal: space.s6,
    paddingVertical: space.s4,
  },
  loading: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: space.s6,
  },
  loadingText: {
    paddingHorizontal: space.s3,
  },
});
