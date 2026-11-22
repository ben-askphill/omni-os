import type { Artifact } from '@omni/client-core';
import { useMemo } from 'react';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { threadArtifacts } from '../artifacts/thread-artifacts';
import { ArtifactCard } from '../components/artifact/ArtifactCard';
import { Notice } from '../components/Notice';
import { shortAgo } from '../live/channel-model';
import { useThreadLive, useThreadView } from '../live/react';
import { useMinuteClock } from '../live/use-minute-clock';
import { openArtifact } from '../navigation/open-artifact';
import type { RootScreenProps } from '../navigation/types';
import { fontSize, space, useOmniTheme, weight } from '../theme';
import { EmptyState } from '../ui/EmptyState';
import { Text } from '../ui/Text';

const GAP = space.s4 + space.s2 / 2;

/**
 * One thread's artifacts, from its menu: its own files and screenshots, then those of the threads it delegated to, the
 * set desktop's Files and Browser tabs show. Both come with the thread and its stream, so a new one appears while the
 * screen is open. A card opens the file full screen in the viewer the Library uses.
 */
export function ThreadArtifactsScreen({ navigation, route }: RootScreenProps<'ThreadArtifacts'>) {
  const { id } = route.params;
  const { colors } = useOmniTheme();
  const live = useThreadLive(id);
  const view = useThreadView(live);
  const now = useMinuteClock();
  const { width } = useWindowDimensions();
  const artifacts = view?.artifacts;
  const crewArtifacts = view?.crewArtifacts;
  const list = useMemo(() => threadArtifacts(artifacts ?? [], crewArtifacts ?? []), [artifacts, crewArtifacts]);

  if (!view || view.status === 'loading') return <Notice title="Loading" />;
  if (view.status === 'missing') return <Notice title="Thread not found" body="It may have been archived or removed on the server." />;
  if (view.status === 'error' && !view.thread) return <Notice title="Could not open this thread" body={view.error ?? undefined} action={{ label: 'Try again', onPress: () => live?.retry() }} />;

  if (!list.own.length && !list.crew.length) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.bg }]}>
        <EmptyState icon="layers" title="No files yet" body="Screenshots and files this thread and the threads it delegates to make show up here." />
      </View>
    );
  }

  const half = (width - space.s8 * 2 - GAP) / 2;
  const grid = <A extends Artifact>(items: readonly A[], where: (a: A) => string) => (
    <View style={styles.grid}>
      {items.map((a) => (
        <ArtifactCard key={a.id} artifact={a} width={half} tall={false} where={where(a)} onOpen={() => openArtifact(navigation, a)} />
      ))}
    </View>
  );

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.content}>
      {list.own.length ? grid(list.own, (a) => shortAgo(a.updated_at, now)) : null}
      {list.crew.length ? (
        <View style={styles.section}>
          <Text accessibilityRole="header" style={[styles.caption, { color: colors.fg3 }]}>
            From delegated threads
          </Text>
          {grid(list.crew, (a) => `${a.thread_title || 'Untitled'} · ${shortAgo(a.updated_at, now)}`)}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    paddingTop: space.s4,
    paddingBottom: space.s11,
    gap: space.s9,
  },
  section: {
    gap: space.s4,
  },
  caption: {
    fontSize: fontSize.meta,
    fontWeight: weight.medium,
    paddingHorizontal: space.s9,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GAP,
    paddingHorizontal: space.s8,
  },
});
