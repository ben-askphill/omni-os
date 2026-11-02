import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { ListHeading } from '../components/ListHeading';
import { SearchHitRow } from '../components/SearchHitRow';
import { ThreadRowView } from '../components/ThreadRowView';
import { threadRow } from '../live/channel-model';
import { useActivity, useChannels } from '../live/react';
import { useMinuteClock } from '../live/use-minute-clock';
import type { RootScreenProps } from '../navigation/types';
import { hitRows, matchChannels, noMatchMessage, recentThreads, searchQuery } from '../search/search-model';
import { useThreadSearch } from '../search/use-thread-search';
import { fontSize, minTarget, radius, space, useOmniTheme } from '../theme';
import { GroupedList, ListRow } from '../ui/GroupedList';

export function SearchScreen({ navigation }: RootScreenProps<'Search'>) {
  const { colors } = useOmniTheme();
  const { channels } = useChannels();
  const { recent } = useActivity();
  const [text, setText] = useState('');
  const query = searchQuery(text);
  const search = useThreadSearch(query);
  const now = useMinuteClock();

  const channelMatches = useMemo(() => matchChannels(channels, query), [channels, query]);
  const hits = useMemo(() => (search.kind === 'done' ? hitRows(search.hits, channels, now) : []), [search, channels, now]);
  const latest = useMemo(() => (query ? [] : recentThreads(recent).map((t) => ({ ...threadRow(t, now), channel: channelName(channels, t.channel_id) }))), [query, recent, channels, now]);

  const openThread = (id: string) => navigation.navigate('Thread', { id });
  const status = statusLine(query, search.kind, hits.length, channelMatches.length, search.kind === 'error' ? search.message : null);

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <View style={styles.bar}>
        <TextInput
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
          returnKeyType="search"
          enablesReturnKeyAutomatically
          value={text}
          onChangeText={setText}
          placeholder="Threads and channels"
          placeholderTextColor={colors.fg4}
          accessibilityLabel="Search threads and channels"
          style={[styles.input, { color: colors.fg, backgroundColor: colors.surface2 }]}
        />
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={styles.content}>
        {channelMatches.length ? (
          <View style={styles.group}>
            <ListHeading>Channels</ListHeading>
            <GroupedList>
              {channelMatches.map((c, i) => (
                <ListRow key={c.id} first={i === 0} title={c.label} detail={c.detail ?? undefined} chevron onPress={() => navigation.navigate('Channel', { id: c.id })} />
              ))}
            </GroupedList>
          </View>
        ) : null}
        {hits.length ? <ListHeading count={hits.length}>Threads</ListHeading> : null}
        {hits.map((row) => (
          <SearchHitRow key={row.threadId} row={row} onPress={() => openThread(row.threadId)} />
        ))}
        {!query && latest.length ? <ListHeading>Recent</ListHeading> : null}
        {latest.map((row) => (
          <ThreadRowView key={row.id} row={row} onPress={() => openThread(row.id)} />
        ))}
        {status ? <Text style={[styles.status, { color: colors.fg3 }]}>{status}</Text> : null}
      </ScrollView>
    </View>
  );
}

function channelName(channels: ReturnType<typeof useChannels>['channels'], id: string): string {
  return channels?.find((c) => c.id === id)?.name ?? id;
}

function statusLine(query: string, kind: string, hits: number, channels: number, error: string | null): string | null {
  if (!query) return null;
  if (kind === 'error') return error;
  if (kind === 'searching') return channels || hits ? null : 'Searching';
  if (kind === 'done' && hits === 0 && channels === 0) return noMatchMessage(query);
  return null;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  bar: {
    paddingHorizontal: space.s8,
    paddingTop: space.s4,
    paddingBottom: space.s4,
  },
  input: {
    minHeight: minTarget,
    borderRadius: radius.pill,
    paddingHorizontal: space.s8,
    fontSize: fontSize.input,
  },
  content: {
    paddingBottom: space.s11,
  },
  group: {
    paddingHorizontal: space.s8,
    paddingBottom: space.s4,
  },
  status: {
    fontSize: fontSize.body,
    paddingHorizontal: space.s9,
    paddingTop: space.s6,
  },
});
