import { codeRuns, mergeReady, mergeRiskTitle, mergeRiskVerdict, riskGap, shortHead, type MergeRiskP } from '@omni/shared/merge-risk.ts';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import type { ThreadRow } from '../../../thread/rows';
import { fontSize, mono, radius, space, useOmniTheme, weight, type ColorTokens } from '../../../theme';
import { Icon } from '../../../ui/Icon';
import { Text } from '../../../ui/Text';
import { StatusPill } from '../../StatusPill';

// The merge-risk gate's rating of one head of the thread's PR, under its turn: the level, what it means for merging,
// the label the PR got and the areas not rated good (web: MergeRiskCard).

type Of<K extends ThreadRow['kind']> = { row: Extract<ThreadRow, { kind: K }> };

const levelColor = (level: MergeRiskP['level'], c: ColorTokens) => (level === 'medium' ? c.warn : level === 'high' ? c.dangerText : level === 'not rated' ? c.fg2 : c.fg);

export function MergeRiskRow({ row }: Of<'merge_risk'>) {
  const { colors } = useOmniTheme();
  const { p } = row;
  const ready = mergeReady(p);
  const gaps = p.bullets.map(riskGap);
  return (
    <View accessibilityLabel={`Merge risk for pull request ${p.pr}`} style={[styles.card, { backgroundColor: colors.surface }]}>
      <View style={styles.line}>
        <Icon name={ready ? 'check' : 'pr'} size={15} color={ready ? colors.fg : colors.fg2} />
        <Text style={[styles.title, { color: levelColor(p.level, colors) }]}>{mergeRiskTitle(p)}</Text>
        <View style={styles.grow} />
        <StatusPill glyph={ready ? 'done' : 'needs'} label={p.label} />
      </View>
      <View style={[styles.line, styles.wrap]}>
        <Text style={[styles.small, { color: colors.fg2 }]}>{mergeRiskVerdict(p)}</Text>
        <Pressable accessibilityRole="link" accessibilityLabel={`Open pull request ${p.pr} on GitHub`} onPress={() => void Linking.openURL(p.url)} hitSlop={8} style={styles.line}>
          <Text style={[styles.small, styles.link, { color: colors.fg }]}>{`PR #${p.pr}`}</Text>
          <Icon name="external" size={12} color={colors.fg3} />
        </Pressable>
        <Text style={[styles.small, { color: colors.fg3 }]}>
          rated <Text style={[styles.mono, { color: colors.fg3 }]}>{shortHead(p.head)}</Text>
        </Text>
      </View>
      {gaps.map((g, i) => (
        <View key={i} style={styles.gap}>
          {g.verdict ? <Text style={[styles.verdict, { color: g.verdict === 'poor' ? colors.dangerText : colors.warn }]}>{g.verdict.toUpperCase()}</Text> : null}
          <Text style={[styles.small, styles.grow, { color: colors.fg2 }]}>
            {g.area ? <Text style={{ color: colors.fg, fontWeight: weight.medium }}>{`${g.area} `}</Text> : null}
            {codeRuns(g.text).map((r, k) =>
              r.code ? (
                <Text key={k} style={[styles.mono, { color: colors.fg }]}>
                  {r.text}
                </Text>
              ) : (
                r.text
              ),
            )}
          </Text>
        </View>
      ))}
      {p.reason ? <Text style={[styles.small, { color: colors.fg2 }]}>{p.reason}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.xl, paddingHorizontal: space.s6, paddingVertical: space.s6, gap: space.s4 },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.s3 },
  wrap: { flexWrap: 'wrap', columnGap: space.s4 },
  title: { fontSize: fontSize.ui, fontWeight: weight.semibold },
  grow: { flex: 1 },
  small: { fontSize: fontSize.small, lineHeight: 18 },
  link: { fontWeight: weight.semibold },
  mono: { fontFamily: mono, fontSize: fontSize.small - 1 },
  gap: { flexDirection: 'row', alignItems: 'baseline', gap: space.s4 },
  verdict: { fontSize: fontSize.caption, fontWeight: weight.medium, letterSpacing: 0.4 },
});
