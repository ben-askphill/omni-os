import { useMemo } from 'react';
import { Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';

import type { ChannelWithRunning } from '@omni/client-core';

import { channelSections, channelSubtitle, needsByChannel } from '../live/channel-model';
import { useChannels, useLink, useLiveHub, useNeedsYou, usePullRefresh } from '../live/react';
import { ListHeading } from '../components/ListHeading';
import { StatusDot } from '../components/StatusDot';
import { StatusLine } from '../components/StatusLine';
import type { RootScreenProps } from '../navigation/types';
import { usePairing } from '../pairing/PairingProvider';
import { Button } from '../ui/Button';
import { Callout } from '../ui/Callout';
import { fontSize, minTarget, space, useOmniTheme } from '../theme';

interface ChannelSection {
  title: string | null;
  data: ChannelWithRunning[];
}

export function ChannelsScreen({ navigation }: RootScreenProps<'Channels'>) {
  const { colors } = useOmniTheme();
  const hub = useLiveHub();
  const pull = usePullRefresh();
  const { channels, error } = useChannels();
  const link = useLink();
  const needsYou = useNeedsYou();
  const needs = useMemo(() => needsByChannel(needsYou), [needsYou]);
  const { activeServer, statusById, notice, clearNotice } = usePairing();
  const incompatible = activeServer !== null && statusById[activeServer.id] === 'incompatible';

  const sections = useMemo<ChannelSection[]>(() => {
    if (!channels) return [];
    const model = channelSections(channels);
    const out: ChannelSection[] = [];
    if (model.conductor) out.push({ title: null, data: [model.conductor] });
    for (const group of model.groups) out.push({ title: group.label, data: group.channels });
    return out;
  }, [channels]);

  const empty = channels !== null && sections.length === 0;
  const summary = useMemo(() => {
    if (!channels) return null;
    const { listedCount, running } = channelSections(channels);
    return `${listedCount} ${listedCount === 1 ? 'channel' : 'channels'} · ${running} running`;
  }, [channels]);

  return (
    <SectionList
      sections={sections}
      keyExtractor={(channel) => channel.id}
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: colors.bg }}
      refreshControl={
        <RefreshControl
          refreshing={pull.refreshing}
          onRefresh={pull.onRefresh}
          tintColor={colors.fg3}
        />
      }
      ListHeaderComponent={
        <View style={styles.header}>
          {notice !== null && (
            <Callout message={notice}>
              <Button label="Dismiss" variant="secondary" onPress={clearNotice} />
            </Callout>
          )}
          {incompatible && <Callout message="This server speaks an API this app doesn't support. Update the app or the server." />}
          <StatusLine />
          {summary ? <Text style={[styles.summary, { color: colors.fg3 }]}>{summary}</Text> : null}
          {channels && error ? (
            <Text style={[styles.note, { color: colors.fg3 }]}>Last refresh failed. Pull down to try again.</Text>
          ) : null}
        </View>
      }
      ListEmptyComponent={
        channels === null ? (
          <Empty
            title={link.kind === 'unpaired' ? 'No server connected' : error ? 'Could not load channels' : 'Loading channels'}
            body={link.kind === 'unpaired' ? 'Pair this phone with an Omni server to see its channels.' : error ?? undefined}
            action={error && link.kind !== 'unpaired' ? { label: 'Try again', onPress: () => void hub.refreshChannels() } : undefined}
          />
        ) : empty ? (
          <Empty title="No channels yet" body="Channels appear here once the server has one." />
        ) : undefined
      }
      renderSectionHeader={({ section }) => (section.title ? <ListHeading>{section.title}</ListHeading> : <View style={styles.conductorGap} />)}
      renderItem={({ item }) => (
        <ChannelRow channel={item} needs={needs.get(item.id) ?? 0} onPress={() => navigation.navigate('Channel', { id: item.id })} />
      )}
      stickySectionHeadersEnabled={false}
    />
  );
}

function ChannelRow({ channel, needs, onPress }: { channel: ChannelWithRunning; needs: number; onPress: () => void }) {
  const { colors } = useOmniTheme();
  const running = channel.running || 0;
  const subtitle = channelSubtitle(channel);
  const label = [channel.name, needs > 0 && `${needs} ${needs === 1 ? 'needs' : 'need'} you`, running > 0 && `${running} running`].filter(Boolean).join(', ');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? colors.surface2 : colors.bg, borderColor: colors.line }]}
    >
      <View style={styles.text}>
        <Text numberOfLines={1} style={[styles.name, { color: colors.fg }]}>
          {channel.name}
        </Text>
        {subtitle ? (
          <Text numberOfLines={1} style={[styles.sub, { color: colors.fg3 }]}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {needs > 0 ? <Count tone="warn" value={needs} /> : null}
      {running > 0 ? <Count tone="ok" value={running} /> : null}
      <Text style={[styles.chevron, { color: colors.fg4 }]}>›</Text>
    </Pressable>
  );
}

function Count({ tone, value }: { tone: 'ok' | 'warn'; value: number }) {
  const { colors } = useOmniTheme();
  return (
    <View style={styles.count}>
      <StatusDot tone={tone} />
      <Text style={[styles.running, { color: colors.fg3 }]}>{value}</Text>
    </View>
  );
}

function Empty({ title, body, action }: { title: string; body?: string; action?: { label: string; onPress: () => void } }) {
  const { colors } = useOmniTheme();
  return (
    <View style={styles.empty}>
      <Text style={[styles.emptyTitle, { color: colors.fg }]}>{title}</Text>
      {body ? <Text style={[styles.emptyBody, { color: colors.fg3 }]}>{body}</Text> : null}
      {action ? (
        <Pressable accessibilityRole="button" onPress={action.onPress} style={styles.action}>
          <Text style={[styles.actionLabel, { color: colors.fg }]}>{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: space.s9,
    paddingTop: space.s2,
    gap: space.s2,
  },
  note: {
    fontSize: fontSize.meta,
    paddingBottom: space.s2,
  },
  conductorGap: {
    height: space.s6,
  },
  row: {
    minHeight: minTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s6,
    paddingHorizontal: space.s9,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  text: {
    flex: 1,
    paddingVertical: space.s4,
    gap: 2,
  },
  name: {
    fontSize: fontSize.input,
    fontWeight: '500',
  },
  sub: {
    fontSize: fontSize.meta,
  },
  summary: {
    fontSize: fontSize.meta,
    paddingBottom: space.s2,
  },
  count: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s2 + 1,
  },
  running: {
    fontSize: fontSize.meta,
    fontVariant: ['tabular-nums'],
  },
  chevron: {
    fontSize: fontSize.heading + 4,
    lineHeight: 22,
  },
  empty: {
    paddingHorizontal: space.s9,
    paddingTop: space.s11,
    gap: space.s4,
  },
  emptyTitle: {
    fontSize: fontSize.heading,
    fontWeight: '600',
  },
  emptyBody: {
    fontSize: fontSize.body,
  },
  action: {
    minHeight: minTarget,
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  actionLabel: {
    fontSize: fontSize.input,
    fontWeight: '600',
  },
});
