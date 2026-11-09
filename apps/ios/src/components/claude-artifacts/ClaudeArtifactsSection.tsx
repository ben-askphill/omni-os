import { CLAUDE_ARTIFACT_SCOPES, ERROR_TEXT, filterClaudeArtifacts, GALLERY_URL, type ClaudeArtifactScopeFilter } from '@omni/shared/claude-artifacts.ts';
import { useMemo, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import type { ClaudeArtifactsLiveState } from '../../live/claude-artifacts';
import { fontSize, minTarget, radius, space, useOmniTheme } from '../../theme';
import { Button } from '../../ui/Button';
import { Callout } from '../../ui/Callout';
import { EmptyState } from '../../ui/EmptyState';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { Text, TextInput } from '../../ui/Text';
import { ClaudeArtifactRow } from './ClaudeArtifactRow';
import { FreshnessLine } from './FreshnessLine';

/**
 * The Library's claude.ai switch: Ben's claude.ai Artifacts as the server last listed them, searchable and filtered by
 * whose they are. Pull to refresh lists again; a failed listing keeps the last good list under its error.
 */
export function ClaudeArtifactsSection({ live, now }: { live: ClaudeArtifactsLiveState; now: number }) {
  const { colors } = useOmniTheme();
  const [q, setQ] = useState('');
  const [scope, setScope] = useState<ClaudeArtifactScopeFilter>('all');
  const items = live.items ?? [];
  const list = useMemo(() => filterClaudeArtifacts(items, { scope, q }), [items, scope, q]);
  const counts = useMemo(() => Object.fromEntries(CLAUDE_ARTIFACT_SCOPES.map((s) => [s.id, filterClaudeArtifacts(items, { scope: s.id }).length])), [items]);
  const failure = live.server?.error ? ERROR_TEXT[live.server.error.code] : null;
  const gallery = () => void Linking.openURL(GALLERY_URL);

  return (
    <View style={styles.wrap}>
      <View style={styles.controls}>
        <FreshnessLine server={live.server} now={now} />
        {failure ? (
          <Callout message={`${failure.title}. ${failure.hint}`}>
            <View style={styles.action}>
              <Button label="Open claude.ai" variant="secondary" size="small" onPress={gallery} />
            </View>
          </Callout>
        ) : null}
        {live.error ? <Text style={[styles.note, { color: colors.fg3 }]}>{`Could not reach Omni: ${live.error}. Pull down to try again.`}</Text> : null}
        {items.length ? (
          <>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              clearButtonMode="while-editing"
              returnKeyType="search"
              value={q}
              onChangeText={setQ}
              placeholder="Search artifacts"
              placeholderTextColor={colors.fg4}
              accessibilityLabel="Search artifacts"
              style={[styles.search, { color: colors.fg, backgroundColor: colors.surface2 }]}
            />
            <SegmentedControl value={scope} onChange={setScope} options={CLAUDE_ARTIFACT_SCOPES.map((s) => ({ value: s.id, label: s.label, count: counts[s.id] }))} />
          </>
        ) : null}
      </View>

      {list.length ? (
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          {list.map((a, i) => (
            <ClaudeArtifactRow key={a.id} artifact={a} now={now} first={i === 0} />
          ))}
        </View>
      ) : items.length ? (
        <Text style={[styles.note, styles.inset, { color: colors.fg3 }]}>Nothing matches.</Text>
      ) : live.items === null || live.server?.refreshing || (!live.server?.last_success_at && !failure) ? (
        <EmptyState icon="globe" title="Fetching your artifacts from claude.ai" body="Claude Code lists them on the machine running Omni. This takes a few seconds." />
      ) : failure ? null : (
        <EmptyState icon="globe" title="No artifacts on claude.ai" body="Pages you publish to claude.ai, and ones shared with you, show up here." action={{ label: 'Open claude.ai', onPress: gallery }} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.s6 },
  controls: { paddingHorizontal: space.s9, gap: space.s6 },
  action: { flexDirection: 'row' },
  note: { fontSize: fontSize.meta },
  inset: { paddingHorizontal: space.s9 },
  search: { minHeight: minTarget, borderRadius: radius.pill, paddingHorizontal: space.s8, fontSize: fontSize.input },
  card: { marginHorizontal: space.s8, borderRadius: radius.lg, overflow: 'hidden' },
});
