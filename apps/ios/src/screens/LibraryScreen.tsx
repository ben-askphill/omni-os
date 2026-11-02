import type { ArtifactWithThread } from '@omni/client-core';
import { ARTIFACT_FILTERS, matchesArtifactFilter, type ArtifactFilter } from '@omni/shared/artifacts.ts';
import { useMemo, useState } from 'react';
import { Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { useArtifactFile } from '../artifacts/use-artifact-file';
import { extensionOf, hasThumbnail } from '../artifacts/viewer-kind';
import { StatusLine } from '../components/StatusLine';
import { shortAgo } from '../live/channel-model';
import { useChannels, useLibrary, usePullRefresh } from '../live/react';
import { useMinuteClock } from '../live/use-minute-clock';
import { openArtifact } from '../navigation/open-artifact';
import type { RootScreenProps } from '../navigation/types';
import { fontSize, radius, space, useOmniTheme } from '../theme';
import { SegmentedControl } from '../ui/SegmentedControl';

const GAP = space.s4 + space.s2 / 2;

/** The Library tab: every file the crew made, newest first, the latest one full width. */
export function LibraryScreen({ navigation }: RootScreenProps<'Library'>) {
  const { colors } = useOmniTheme();
  const pull = usePullRefresh((hub) => hub.refreshLibrary());
  const library = useLibrary();
  const { channels } = useChannels();
  const now = useMinuteClock();
  const { width } = useWindowDimensions();
  const [filter, setFilter] = useState<ArtifactFilter>('all');

  const names = useMemo(() => new Map((channels ?? []).map((c) => [c.id, c.name])), [channels]);
  const list = useMemo(() => (library.artifacts ?? []).filter((a) => matchesArtifactFilter(filter, a.kind)), [library.artifacts, filter]);

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
        <Text style={[styles.sub, { color: colors.fg3 }]}>Reports, pages and files from every channel</Text>
        <StatusLine />
        {library.artifacts && library.error ? <Text style={[styles.note, { color: colors.fg3 }]}>Last refresh failed. Pull down to try again.</Text> : null}
        <SegmentedControl value={filter} onChange={setFilter} options={ARTIFACT_FILTERS.map((f) => ({ value: f.id, label: f.label }))} />
      </View>

      {list.length ? (
        <View style={styles.grid}>
          {list.map((a, i) => {
            const wide = i === 0 && filter === 'all';
            return (
              <Card
                key={a.id}
                artifact={a}
                width={wide ? inner : half}
                tall={wide}
                channel={names.get(a.channel_id) ?? a.channel_id}
                time={shortAgo(a.updated_at, now)}
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

function Card({
  artifact,
  width,
  tall,
  channel,
  time,
  onOpen,
}: {
  artifact: ArtifactWithThread;
  width: number;
  tall: boolean;
  channel: string;
  time: string;
  onOpen: () => void;
}) {
  const { colors } = useOmniTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${artifact.name}, ${artifact.kind}, in ${channel}, ${time}`}
      onPress={onOpen}
      style={({ pressed }) => [styles.card, { width, backgroundColor: colors.surface, opacity: pressed ? 0.7 : 1 }]}
    >
      <View style={[styles.thumb, { height: tall ? 170 : 110, backgroundColor: colors.surface3 }]}>
        {hasThumbnail(artifact.kind) ? <Thumbnail artifact={artifact} /> : <Label artifact={artifact} />}
      </View>
      <View style={styles.meta}>
        <Text numberOfLines={1} style={[styles.name, { color: colors.fg }]}>
          {artifact.name}
        </Text>
        <Text numberOfLines={1} style={[styles.where, { color: colors.fg3 }]}>
          {`#${channel} · ${time}`}
        </Text>
      </View>
    </Pressable>
  );
}

function Thumbnail({ artifact }: { artifact: ArtifactWithThread }) {
  const load = useArtifactFile(artifact);
  if (load.status !== 'ready') return <Label artifact={artifact} />;
  return <Image source={{ uri: load.file.uri }} resizeMode="cover" style={StyleSheet.absoluteFill} accessibilityIgnoresInvertColors />;
}

/** What a file shows when the app does not draw it: its extension, centred. */
function Label({ artifact }: { artifact: ArtifactWithThread }) {
  const { colors } = useOmniTheme();
  return (
    <View style={styles.label}>
      <Text style={[styles.ext, { color: colors.fg3 }]}>{extensionOf(artifact.name)}</Text>
    </View>
  );
}

/** The time the relative times count from, a minute fresh. */
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
  card: {
    borderRadius: radius.md + space.s2,
    padding: space.s2 + 2,
    gap: space.s4,
  },
  thumb: {
    borderRadius: radius.md - 1,
    overflow: 'hidden',
  },
  meta: {
    paddingHorizontal: space.s2 + 2,
    paddingBottom: space.s2 + 2,
    gap: 2,
  },
  name: {
    fontSize: 12.5,
    fontFamily: 'Menlo',
  },
  where: {
    fontSize: 12,
  },
  label: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ext: {
    fontSize: fontSize.body,
    fontFamily: 'Menlo',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  empty: {
    fontSize: fontSize.body,
    paddingHorizontal: space.s9,
    paddingVertical: space.s4,
  },
});
