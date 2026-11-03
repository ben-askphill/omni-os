import { useMemo, useState, type ReactNode } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../ui/Text';

import { NeedsRow } from '../components/activity/NeedsRow';
import { ThreadGroupView } from '../components/activity/ThreadGroupView';
import { UsageMeters } from '../components/activity/UsageMeters';
import { ListHeading } from '../components/ListHeading';
import { StatusLine } from '../components/StatusLine';
import { ThreadRowView } from '../components/ThreadRowView';
import { activitySections, type NeedsButton, type NeedsRow as NeedsRowModel, type ThreadGroup } from '../live/activity-model';
import { useActivity, useChannels, useLiveHub, useNeedsYou, usePullRefresh } from '../live/react';
import { useMinuteClock } from '../live/use-minute-clock';
import { runNeedsAction } from '../needs/actions';
import type { RootScreenProps } from '../navigation/types';
import { usePairing } from '../pairing/PairingProvider';
import { fontSize, space, useOmniTheme } from '../theme';
import { Button } from '../ui/Button';
import { Callout } from '../ui/Callout';
import { SegmentedControl } from '../ui/SegmentedControl';

type Filter = 'all' | 'needs' | 'running' | 'done';

/** Home: what needs Ben first, then what runs, what he pinned, the latest threads and what finished today. */
export function ActivityScreen({ navigation }: RootScreenProps<'Activity'>) {
  const { colors } = useOmniTheme();
  const hub = useLiveHub();
  const pull = usePullRefresh();
  const activity = useActivity();
  const { channels } = useChannels();
  const { activeServer, statusById, notice, clearNotice } = usePairing();
  const incompatible = activeServer !== null && statusById[activeServer.id] === 'incompatible';
  const now = useMinuteClock();
  const [filter, setFilter] = useState<Filter>('all');

  const needsYou = useNeedsYou();
  const { recent, pinned, usage } = activity;
  const a = useMemo(
    () => activitySections({ recent, needsYou, pinned, channels, usage, now }),
    [recent, needsYou, pinned, channels, usage, now],
  );
  const show = (f: Filter) => filter === 'all' || filter === f;
  const open = (id: string) => navigation.navigate('Thread', { id });
  const press = async (row: NeedsRowModel, b: NeedsButton) => {
    const { run } = b;
    if (run.kind === 'open') return open(row.id);
    if (run.kind === 'read') return hub.markResultRead(run.uid);
    if (run.kind === 'done') await hub.request((api) => api.setDone(row.id, true));
    else await hub.request((api) => runNeedsAction(api, row.id, run.action));
    await Promise.all([hub.refreshNeedsYou(), hub.refreshActivity()]);
  };
  const groups = (list: ThreadGroup[]) => list.map((g) => <ThreadGroupView key={g.row.id} group={g} onOpen={(row) => open(row.id)} />);

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={colors.fg3} />}
    >
      <View style={styles.header}>
        <Text style={[styles.headline, { color: colors.fg3 }]}>{a.headline}</Text>
        <UsageMeters meters={a.usage} />
        {notice !== null && (
          <Callout message={notice}>
            <Button label="Dismiss" variant="secondary" onPress={clearNotice} />
          </Callout>
        )}
        {incompatible && <Callout message="This server speaks an API this app doesn't support. Update the app or the server." />}
        <StatusLine />
        {activity.recent && activity.error ? (
          <Text style={[styles.note, { color: colors.fg3 }]}>Last refresh failed. Pull down to try again.</Text>
        ) : null}
        <SegmentedControl
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'needs', label: 'Needs you', count: a.needs.length },
            { value: 'running', label: 'Running', count: a.runningCount },
            { value: 'done', label: 'Done', count: a.doneToday.length },
          ]}
        />
      </View>

      {show('needs') && (
        <Section title="Needs you" count={a.needs.length}>
          {a.needs.length ? a.needs.map((n) => <NeedsRow key={n.id} row={n} onPress={() => open(n.id)} onButton={(b) => press(n, b)} />) : <Empty>{a.nothingNeeded}</Empty>}
        </Section>
      )}
      {(filter === 'running' || (filter === 'all' && a.running.length > 0)) && (
        <Section title="Running" count={a.runningCount}>
          {a.running.length ? groups(a.running) : <Empty>Nothing is running.</Empty>}
        </Section>
      )}
      {filter === 'all' && a.pinned.length > 0 && (
        <Section title="Pinned" count={a.pinned.length}>
          {a.pinned.map((row) => (
            <ThreadRowView key={row.id} row={row} onPress={() => open(row.id)} />
          ))}
        </Section>
      )}
      {filter === 'all' && a.latest.length > 0 && (
        <Section title="Recent threads" count={a.latestCount}>
          {groups(a.latest)}
        </Section>
      )}
      {show('done') && (
        <Section title="Done today" count={a.doneToday.length}>
          {a.doneToday.length ? (
            a.doneToday.map((row) => <ThreadRowView key={row.id} row={row} onPress={() => open(row.id)} />)
          ) : (
            <Empty>{activity.error ?? (activity.recent === null ? 'Loading' : 'Nothing finished yet today.')}</Empty>
          )}
        </Section>
      )}
    </ScrollView>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <View>
      <ListHeading count={count}>{title}</ListHeading>
      {children}
    </View>
  );
}

function Empty({ children }: { children: string }) {
  const { colors } = useOmniTheme();
  return <Text style={[styles.empty, { color: colors.fg3 }]}>{children}</Text>;
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: space.s11,
  },
  header: {
    paddingHorizontal: space.s9,
    paddingTop: space.s2,
    gap: space.s6,
  },
  headline: {
    fontSize: fontSize.body,
  },
  note: {
    fontSize: fontSize.meta,
  },
  empty: {
    fontSize: fontSize.body,
    paddingHorizontal: space.s9,
    paddingVertical: space.s4,
  },
});
