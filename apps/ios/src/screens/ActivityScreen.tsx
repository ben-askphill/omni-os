import { useLayoutEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { DoneRowView, InboxRowView, ShelfHeader, ShowMore, type RowAction } from '../components/activity/InboxRows';
import { OmniMark } from '../components/ChannelAvatar';
import { HeaderButton } from '../components/HeaderButton';
import { StatusLine } from '../components/StatusLine';
import { activityInbox, DONE_INITIAL, DONE_PAGE, type ActivityInbox, type InboxRow } from '../live/activity-model';
import { useActivity, useChannels, useLiveHub, useNeedsYou, usePullRefresh, useShelfOpen } from '../live/react';
import { useMinuteClock } from '../live/use-minute-clock';
import type { RootScreenProps } from '../navigation/types';
import { usePairing } from '../pairing/PairingProvider';
import { fontSize, lineHeight, minTarget, space, useOmniTheme, weight } from '../theme';
import type { ThreadAction } from '../thread/actions';
import { useThreadActions } from '../thread/hooks';
import type { ThreadTarget } from '../thread/target';
import { Button } from '../ui/Button';
import { Callout } from '../ui/Callout';
import { failure, tap } from '../ui/haptics';
import { Text } from '../ui/Text';

/**
 * Home: phone web's Inbox. Pinned threads, then the threads waiting on Ben, the latest back first; Working and Done fold
 * away below them (apps/web/src/mobile/ActivityScreen.tsx).
 */
export function ActivityScreen({ navigation }: RootScreenProps<'Activity'>) {
  const { colors } = useOmniTheme();
  const pull = usePullRefresh();
  const activity = useActivity();
  const { channels } = useChannels();
  const needsYou = useNeedsYou();
  const { activeServer, statusById, notice, clearNotice } = usePairing();
  const incompatible = activeServer !== null && statusById[activeServer.id] === 'incompatible';
  const now = useMinuteClock();
  const [workingOpen, toggleWorking] = useShelfOpen('working');
  const [doneOpen, toggleDone] = useShelfOpen('done');
  const [doneLimit, setDoneLimit] = useState(DONE_INITIAL);
  const act = useRowActions();

  const { recent, pinned } = activity;
  const inbox = useMemo(() => activityInbox({ recent, needsYou, pinned, channels, now }), [recent, needsYou, pinned, channels, now]);
  const open = (id: string) => navigation.navigate('Thread', { id });

  useLayoutEffect(() => {
    navigation.setOptions({
      // The title sits in the list under the bar, as phone web's MoTitle does. Search moves left beside the Conductor and
      // Settings keeps the right to itself (rootHeader), since iOS draws the gear in its own glass circle.
      headerTitle: '',
      headerLeft: () => (
        <View style={styles.headerLeft}>
          <ConductorButton mark={inbox.mark} onPress={() => navigation.navigate('Channel', { id: 'conductor' })} />
          <HeaderButton label="Search" icon="search" onPress={() => navigation.navigate('Search')} />
        </View>
      ),
    });
  }, [navigation, inbox.mark]);

  const rowActions = (row: InboxRow): RowAction[] => {
    const out: RowAction[] = [];
    if (row.pinned) out.push({ icon: 'pin', label: `Unpin ${row.title}`, run: () => act(row.target, { kind: 'pin' }, 'Unpinned') });
    if (row.canMarkDone) out.push({ icon: 'check', label: `Mark ${row.title} done`, run: () => act(row.target, { kind: 'done' }, 'Marked done') });
    return out;
  };
  const doneRows = doneOpen ? inbox.done.slice(0, doneLimit) : [];
  const moreDone = doneOpen ? Math.min(DONE_PAGE, Math.max(0, inbox.done.length - doneLimit)) : 0;

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={colors.fg3} />}
    >
      <View style={styles.header}>
        <View style={styles.titles}>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.fg }]}>
            Activity
          </Text>
          <Text style={[styles.subtitle, { color: colors.fg3 }]}>{inbox.subtitle}</Text>
        </View>
        {notice !== null && (
          <Callout message={notice}>
            <Button label="Dismiss" variant="secondary" onPress={clearNotice} />
          </Callout>
        )}
        {incompatible && <Callout message="This server speaks an API this app doesn't support. Update the app or the server." />}
        <StatusLine />
        {activity.recent && activity.error ? <Text style={[styles.note, { color: colors.fg3 }]}>Last refresh failed. Pull down to try again.</Text> : null}
      </View>

      <View style={styles.list}>
        {inbox.waiting.map((row, i) => (
          <InboxRowView key={row.id} row={row} last={i === inbox.waiting.length - 1} actions={rowActions(row)} onPress={() => open(row.id)} />
        ))}
        <Empty inbox={inbox} error={activity.error} />
      </View>

      <View style={[styles.list, styles.shelves]}>
        {inbox.working.length > 0 && (
          <>
            <ShelfHeader label="Working" count={inbox.working.length} open={workingOpen} onToggle={toggleWorking} />
            {workingOpen &&
              inbox.working.map((row, i) => (
                <InboxRowView key={row.id} row={row} last={i === inbox.working.length - 1} actions={rowActions(row)} onPress={() => open(row.id)} />
              ))}
          </>
        )}
        <ShelfHeader label="Done" count={inbox.done.length} open={doneOpen} onToggle={toggleDone} />
        {doneRows.map((row, i) => (
          <DoneRowView
            key={row.id}
            row={row}
            last={i === doneRows.length - 1}
            undo={{ icon: 'undo', label: `Move ${row.title} back to the inbox`, run: () => act(row.target, { kind: 'done' }, 'Back in the inbox') }}
            onPress={() => open(row.id)}
          />
        ))}
        {moreDone > 0 && <ShowMore count={moreDone} onPress={() => setDoneLimit((n) => n + DONE_PAGE)} />}
      </View>
    </ScrollView>
  );
}

/**
 * Mark done, undo and unpin, run straight from the row. The row moves by itself once the lists refetch; VoiceOver hears
 * what happened, as phone web's toast says it, and a refusal shows as an alert.
 */
function useRowActions() {
  const hub = useLiveHub();
  const run = useThreadActions();
  return (target: ThreadTarget, action: ThreadAction, ok: string) => {
    tap();
    void run(target, action).then(async (outcome) => {
      if (outcome.kind === 'failed') {
        failure();
        Alert.alert('Could not change this thread', outcome.error);
        return;
      }
      AccessibilityInfo.announceForAccessibility(ok);
      await Promise.all([hub.refreshNeedsYou(), hub.refreshActivity()]);
    });
  };
}

/** The Omni mark and "Conductor", which opens the Conductor's channel. The mark turns vermilion while something needs Ben. */
function ConductorButton({ mark, onPress }: { mark: ActivityInbox['mark']; onPress: () => void }) {
  const { colors } = useOmniTheme();
  const tint = mark === 'attention' ? colors.needs : mark === 'delegating' ? colors.live : colors.fg;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={mark === 'idle' ? 'Open the Conductor' : `Open the Conductor, ${mark === 'attention' ? 'something needs you' : 'delegating'}`}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [styles.conductor, { opacity: pressed ? 0.6 : 1 }]}
    >
      <OmniMark size={24} color={tint} />
      <Text style={[styles.conductorLabel, { color: colors.fg }]}>Conductor</Text>
    </Pressable>
  );
}

function Empty({ inbox, error }: { inbox: ActivityInbox; error: string | null }) {
  const { colors } = useOmniTheme();
  if (inbox.waiting.length) return null;
  const text = inbox.loaded ? 'Nothing is waiting on you.' : (error ?? 'Loading');
  return <Text style={[styles.empty, { color: colors.fg3 }]}>{text}</Text>;
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: space.s11,
  },
  header: {
    paddingHorizontal: space.s9,
    paddingBottom: space.s6,
    gap: space.s6,
  },
  titles: {
    gap: space.s3,
  },
  title: {
    fontSize: fontSize.titleLg,
    lineHeight: Math.round(fontSize.titleLg * lineHeight.tight),
    fontWeight: weight.medium,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: fontSize.ui,
    fontVariant: ['tabular-nums'],
  },
  note: {
    fontSize: fontSize.meta,
  },
  list: {
    paddingHorizontal: space.s8,
  },
  shelves: {
    paddingTop: space.s10,
  },
  empty: {
    fontSize: fontSize.body,
    lineHeight: Math.round(fontSize.body * 1.5),
    paddingHorizontal: space.s2,
    paddingVertical: space.s8,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s6,
  },
  conductor: {
    minHeight: minTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s4,
  },
  conductorLabel: {
    fontSize: fontSize.body,
    fontWeight: weight.medium,
  },
});
