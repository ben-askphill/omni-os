import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import type { ThreadLive, ThreadView } from '../../live/hub';
import { useMarkResultRead } from '../../live/react';
import { openArtifact } from '../../navigation/open-artifact';
import type { RootStackParamList } from '../../navigation/types';
import { CLOSED, type Disclosure, threadRows, type ThreadRow } from '../../thread/rows';
import { fontSize, minTarget, space, useOmniTheme } from '../../theme';
import { NeedsCards } from './NeedsCards';
import { PendingRows } from './PendingRows';
import type { SendAnswers } from './QuestionCard';
import { type RowActions, RowActionsContext } from './rows/actions';
import { RowView } from './rows/RowView';

/** Within this many points of the newest row, the thread counts as followed. */
const FOLLOW_SLACK = 48;

const toggled = <T,>(set: ReadonlySet<T>, v: T): ReadonlySet<T> => {
  const next = new Set(set);
  if (!next.delete(v)) next.add(v);
  return next;
};

function useThreadRows(view: ThreadView, disclosure: Disclosure): ThreadRow[] {
  const prev = useRef<readonly ThreadRow[]>([]);
  const { thread } = view;
  const rows = useMemo(() => {
    if (!thread) return [];
    return threadRows(
      {
        events: view.rows,
        spans: view.spans,
        thread,
        artifacts: view.artifacts,
        children: view.children,
        atStart: !view.hasOlder,
        conductor: thread.channel_id === 'conductor',
        disclosure,
      },
      prev.current,
    ).rows;
  }, [thread, view.rows, view.spans, view.artifacts, view.children, view.hasOlder, disclosure]);
  useEffect(() => {
    prev.current = rows;
  }, [rows]);
  return rows;
}

/** The transcript, newest at the bottom, with the messages the agent has not read yet and paging toward older rows. */
export function ThreadBody({ view, live }: { view: ThreadView; live: ThreadLive | null }) {
  const { colors } = useOmniTheme();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [disclosure, setDisclosure] = useState<Disclosure>(CLOSED);
  const rows = useThreadRows(view, disclosure);
  // The list is inverted, so the newest row sits at index 0 and scrolling up reaches older rows.
  const data = useMemo(() => [...rows].reverse(), [rows]);
  useMarkResultRead(view.threadId, view.thread?.status);
  const liveRef = useRef(live);
  useEffect(() => {
    liveRef.current = live;
  }, [live]);
  const cwd = view.thread?.cwd ?? null;
  const actions = useMemo<RowActions>(
    () => ({
      threadId: view.threadId,
      openArtifact: (artifact) => openArtifact(navigation, artifact),
      openThread: (id) => navigation.push('Thread', { id }),
      loadWhole: (eventId) => void liveRef.current?.loadFullRow(eventId),
      toggleTurn: (turn) => setDisclosure((d) => ({ ...d, turns: toggled(d.turns, turn) })),
      toggleCall: (id) => setDisclosure((d) => ({ ...d, calls: toggled(d.calls, id) })),
      loadOutput: (eventId, offset) => (liveRef.current ? liveRef.current.loadOutput(eventId, offset) : Promise.reject(new Error('Still connecting.'))),
      answer: ((questionId, answers) => (liveRef.current ? liveRef.current.answerQuestion(questionId, answers) : Promise.reject(new Error('Still connecting. Try again in a moment.')))) as SendAnswers,
      cwd,
    }),
    [navigation, cwd, view.threadId],
  );

  const renderItem = useCallback(({ item }: { item: ThreadRow }) => <RowView row={item} />, []);
  return (
    <RowActionsContext.Provider value={actions}>
      <FlatList
        inverted
        data={data}
        keyExtractor={rowKey}
        renderItem={renderItem}
        contentContainerStyle={styles.content}
        onScroll={(e) => live?.setFollowing(e.nativeEvent.contentOffset.y < FOLLOW_SLACK)}
        scrollEventThrottle={100}
        onEndReached={() => void live?.loadOlder()}
        onEndReachedThreshold={0.4}
        initialNumToRender={14}
        maxToRenderPerBatch={8}
        windowSize={9}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          live ? (
            <View>
              {view.thread ? <NeedsCards thread={view.thread} pending={view.pending} blocked={view.blocked !== null} act={(action) => live.act(action)} /> : null}
              <PendingRows view={view} live={live} />
            </View>
          ) : undefined
        }
        ListFooterComponent={<OlderFooter hasOlder={view.hasOlder} loading={view.loadingOlder} empty={rows.length === 0} onLoad={() => void live?.loadOlder()} />}
        ListEmptyComponent={view.status === 'ready' ? <Text style={[styles.meta, { color: colors.fg3 }]}>No messages yet.</Text> : undefined}
      />
    </RowActionsContext.Provider>
  );
}

const rowKey = (row: ThreadRow) => row.key;

function OlderFooter({ hasOlder, loading, empty, onLoad }: { hasOlder: boolean; loading: boolean; empty: boolean; onLoad: () => void }) {
  const { colors } = useOmniTheme();
  if (empty) return null;
  if (loading) {
    return (
      <View style={styles.olderRow}>
        <ActivityIndicator color={colors.fg3} />
      </View>
    );
  }
  if (!hasOlder) {
    return (
      <View style={styles.olderRow}>
        <Text style={[styles.meta, { color: colors.fg3 }]}>Start of thread</Text>
      </View>
    );
  }
  return (
    <Pressable accessibilityRole="button" onPress={onLoad} style={styles.olderRow}>
      <Text style={[styles.olderLabel, { color: colors.fg }]}>Load older messages</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  meta: {
    fontSize: fontSize.meta,
  },
  content: {
    paddingHorizontal: space.s9,
    paddingVertical: space.s6,
  },
  olderRow: {
    minHeight: minTarget,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: space.s4,
  },
  olderLabel: {
    fontSize: fontSize.body,
    fontWeight: '600',
  },
});
