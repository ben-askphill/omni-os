import { ARTIFACT_FILTERS, matchesArtifactFilter, type ArtifactFilter } from '@omni/shared/artifacts.ts';
import { useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Text } from '../ui/Text';

import { ArtifactCard } from '../components/artifact/ArtifactCard';
import { ClaudeArtifactsSection } from '../components/claude-artifacts/ClaudeArtifactsSection';
import { StatusLine } from '../components/StatusLine';
import { shortAgo } from '../live/channel-model';
import { useChannels, useClaudeArtifacts, useLibrary, useLiveHub, usePullRefresh } from '../live/react';
import { useMinuteClock } from '../live/use-minute-clock';
import { openArtifact } from '../navigation/open-artifact';
import type { RootScreenProps } from '../navigation/types';
import { fontSize, space, useOmniTheme } from '../theme';
import { SegmentedControl } from '../ui/SegmentedControl';

const GAP = space.s4 + space.s2 / 2;

/** The Library's two lists: files the crew made here, and Ben's Artifacts on claude.ai. */
type Source = 'files' | 'claude';
const SOURCES = [
  { value: 'files', label: 'Files' },
  { value: 'claude', label: 'Claude Artifacts' },
] as const;

/**
 * The Library tab: every file the crew made, newest first, the latest one full width. Its claude.ai switch lists Ben's
 * claude.ai Artifacts instead, as phone web's Library does.
 */
export function LibraryScreen({ navigation }: RootScreenProps<'Library'>) {
  const { colors } = useOmniTheme();
  const hub = useLiveHub();
  const [source, setSource] = useState<Source>('files');
  const pull = usePullRefresh((h) => (source === 'claude' ? h.refreshClaudeArtifacts() : h.refreshLibrary()));
  const library = useLibrary();
  const claude = useClaudeArtifacts();
  const { channels } = useChannels();
  const now = useMinuteClock();
  const { width } = useWindowDimensions();
  const [filter, setFilter] = useState<ArtifactFilter>('all');

  const names = useMemo(() => new Map((channels ?? []).map((c) => [c.id, c.name])), [channels]);
  const list = useMemo(() => (library.artifacts ?? []).filter((a) => matchesArtifactFilter(filter, a.kind)), [library.artifacts, filter]);

  // Each time the switch is shown: load the list, and let the server list again if it has not in ten minutes.
  useEffect(() => {
    if (source === 'claude') void hub.openClaudeArtifacts();
  }, [hub, source]);

  const inner = width - space.s8 * 2;
  const half = (inner - GAP) / 2;

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={colors.fg3} />}
    >
      <View style={styles.header}>
        <SegmentedControl value={source} onChange={setSource} options={SOURCES} />
        <Text style={[styles.sub, { color: colors.fg3 }]}>{source === 'claude' ? 'Your Artifacts on claude.ai, opened in the Claude app or Safari' : 'Reports, pages and files from every channel'}</Text>
        <StatusLine />
        {source === 'files' && library.artifacts && library.error ? <Text style={[styles.note, { color: colors.fg3 }]}>Last refresh failed. Pull down to try again.</Text> : null}
        {source === 'files' ? <SegmentedControl value={filter} onChange={setFilter} options={ARTIFACT_FILTERS.map((f) => ({ value: f.id, label: f.label }))} /> : null}
      </View>

      {source === 'claude' ? (
        <ClaudeArtifactsSection live={claude} now={now} />
      ) : list.length ? (
        <View style={styles.grid}>
          {list.map((a, i) => {
            const wide = i === 0 && filter === 'all';
            return (
              <ArtifactCard
                key={a.id}
                artifact={a}
                width={wide ? inner : half}
                tall={wide}
                where={`#${names.get(a.channel_id) ?? a.channel_id} · ${shortAgo(a.updated_at, now)}`}
                onOpen={() => openArtifact(navigation, a)}
              />
            );
          })}
        </View>
      ) : (
        <Text style={[styles.empty, { color: colors.fg3 }]}>
          {library.error ??
            (library.artifacts === null
              ? 'Loading'
              : filter === 'all'
                ? 'Nothing here yet. Reports, pages and files the crew writes show up here.'
                : 'Nothing of this type yet.')}
        </Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: space.s11,
    gap: space.s6,
  },
  header: {
    paddingHorizontal: space.s9,
    paddingTop: space.s2,
    gap: space.s6,
  },
  sub: {
    fontSize: fontSize.body,
  },
  note: {
    fontSize: fontSize.meta,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GAP,
    paddingHorizontal: space.s8,
  },
  empty: {
    fontSize: fontSize.body,
    paddingHorizontal: space.s9,
    paddingVertical: space.s4,
  },
});
