import type { ReactNode } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Notice } from '../components/Notice';
import { usePullRefresh } from '../live/react';
import type { Remote } from '../live/use-remote';
import { fontSize, lineHeight, space, useOmniTheme } from '../theme';
import { refreshNote, remoteView } from './remote-state';

export function RemoteList({
  remote,
  what,
  emptyTitle,
  emptyHint,
  children,
}: {
  remote: Pick<Remote<readonly unknown[]>, 'data' | 'error' | 'loading' | 'reload'>;
  /** What failed to load, in the failure title: "devices". */
  what: string;
  emptyTitle: string;
  emptyHint: string;
  children: ReactNode;
}) {
  const { colors } = useOmniTheme();
  const pull = usePullRefresh(() => remote.reload());
  const view = remoteView(remote);
  const note = refreshNote(remote);

  if (view === 'error') {
    return <Notice title={`Couldn't load ${what}`} body={remote.error ?? undefined} action={{ label: 'Retry', onPress: () => void remote.reload() }} />;
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={colors.fg3} />}
    >
      {view === 'loading' ? <ActivityIndicator accessibilityLabel="Loading" color={colors.fg3} style={styles.spinner} /> : null}
      {view === 'empty' ? (
        <View style={styles.empty}>
          <Text style={[styles.emptyTitle, { color: colors.fg }]}>{emptyTitle}</Text>
          <Text style={[styles.hint, { color: colors.fg3 }]}>{emptyHint}</Text>
        </View>
      ) : null}
      {view === 'list' ? children : null}
      {note ? <Text style={[styles.note, { color: colors.fg3 }]}>{note}</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: space.s9,
    paddingTop: space.s6,
    paddingBottom: space.s11,
    gap: space.s6,
  },
  spinner: {
    paddingTop: space.s11,
  },
  empty: {
    paddingTop: space.s10,
    gap: space.s4,
  },
  emptyTitle: {
    fontSize: fontSize.heading,
    fontWeight: '600',
  },
  hint: {
    fontSize: fontSize.body,
    lineHeight: Math.round(fontSize.body * lineHeight.body),
  },
  note: {
    fontSize: fontSize.meta,
  },
});
