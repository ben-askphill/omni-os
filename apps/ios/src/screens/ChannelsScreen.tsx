import { useMemo } from 'react';
import { ActionSheetIOS, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../ui/Text';

import type { ChannelWithRunning } from '@omni/client-core';

import { channelSections, channelSubtitle, needsByChannel } from '../live/channel-model';
import { useChannels, useLink, useLiveHub, useNeedsYou, usePullRefresh } from '../live/react';
import { ChannelAvatar } from '../components/ChannelAvatar';
import { ListHeading } from '../components/ListHeading';
import { type Glyph, StatusDot } from '../components/StatusDot';
import { StatusLine } from '../components/StatusLine';
import type { RootScreenProps } from '../navigation/types';
import { usePairing } from '../pairing/PairingProvider';
import { Button } from '../ui/Button';
import { Callout } from '../ui/Callout';
import { EmptyState } from '../ui/EmptyState';
import { GroupedList } from '../ui/GroupedList';
import { Icon } from '../ui/Icon';
import { fontSize, minTarget, space, useOmniTheme, weight } from '../theme';

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
  const model = useMemo(() => (channels ? channelSections(channels) : null), [channels]);
  const empty = model !== null && !model.conductor && model.groups.length === 0;
  const summary = model ? `${model.listedCount} ${model.listedCount === 1 ? 'channel' : 'channels'} · ${model.running} running` : null;
  const open = (channel: ChannelWithRunning) => navigation.navigate('Channel', { id: channel.id });
  // Hold a channel for what the Web UI's sidebar menu offers: its settings and a new thread in it.
  const menu = (channel: ChannelWithRunning) =>
    ActionSheetIOS.showActionSheetWithOptions(
      { title: channel.id === 'conductor' ? channel.name : `#${channel.name}`, options: ['Channel settings', 'New thread', 'Cancel'], cancelButtonIndex: 2 },
      (i) => {
        if (i === 0) navigation.navigate('ChannelSettings', { id: channel.id });
        if (i === 1) navigation.navigate('NewThread', { channel: channel.id });
      },
    );

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={colors.fg3} />}
    >
      <View style={styles.header}>
        {notice !== null && (
          <Callout message={notice}>
            <Button label="Dismiss" variant="secondary" onPress={clearNotice} />
          </Callout>
        )}
        {incompatible && <Callout message="This server speaks an API this app doesn't support. Update the app or the server." />}
        <StatusLine />
        {summary ? <Text style={[styles.summary, { color: colors.fg3 }]}>{summary}</Text> : null}
        {channels && error ? <Text style={[styles.summary, { color: colors.fg3 }]}>Last refresh failed. Pull down to try again.</Text> : null}
      </View>

      {model === null ? (
        <EmptyState
          icon={link.kind === 'unpaired' ? 'server' : error ? 'wifiOff' : 'hash'}
          title={link.kind === 'unpaired' ? 'No server connected' : error ? 'Could not load channels' : 'Loading channels'}
          body={link.kind === 'unpaired' ? 'Pair this phone with an Omni server to see its channels.' : error ?? undefined}
          action={error && link.kind !== 'unpaired' ? { label: 'Try again', onPress: () => void hub.refreshChannels() } : undefined}
        />
      ) : empty ? (
        <EmptyState icon="hash" title="No channels yet" body="Channels appear here once the server has one." />
      ) : (
        <>
          {model.conductor ? (
            <View style={styles.card}>
              <GroupedList>
                <ChannelRow channel={model.conductor} needs={needs.get(model.conductor.id) ?? 0} first onPress={() => open(model.conductor!)} onLongPress={() => menu(model.conductor!)} />
              </GroupedList>
            </View>
          ) : null}
          {model.groups.map((group) => (
            <View key={group.label}>
              <ListHeading count={group.channels.length}>{group.label}</ListHeading>
              <View style={styles.card}>
                <GroupedList>
                  {group.channels.map((channel, i) => (
                    <ChannelRow key={channel.id} channel={channel} needs={needs.get(channel.id) ?? 0} first={i === 0} onPress={() => open(channel)} onLongPress={() => menu(channel)} />
                  ))}
                </GroupedList>
              </View>
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}

function ChannelRow({ channel, needs, first, onPress, onLongPress }: { channel: ChannelWithRunning; needs: number; first: boolean; onPress: () => void; onLongPress: () => void }) {
  const { colors } = useOmniTheme();
  const running = channel.running || 0;
  const conductor = channel.id === 'conductor';
  const subtitle = channelSubtitle(channel);
  const label = [channel.name, needs > 0 && `${needs} ${needs === 1 ? 'needs' : 'need'} you`, running > 0 && `${running} running`].filter(Boolean).join(', ');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Hold for channel settings."
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.wash }]}
    >
      <ChannelAvatar name={channel.name} icon={channel.icon} avatarBg={channel.avatar_bg} conductor={conductor} size={34} />
      <View style={[styles.text, !first && { borderTopColor: colors.line, borderTopWidth: StyleSheet.hairlineWidth }]}>
        <View style={styles.grow}>
          <Text numberOfLines={1} style={[styles.name, { color: colors.fg }]}>
            {conductor ? channel.name : `#${channel.name}`}
          </Text>
          {subtitle ? (
            <Text numberOfLines={1} style={[styles.sub, { color: colors.fg3 }]}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {needs > 0 ? <Count glyph="needs" value={needs} /> : null}
        {running > 0 ? <Count glyph="running" value={running} /> : null}
        <Icon name="chevronRight" size={13} color={colors.fg4} />
      </View>
    </Pressable>
  );
}

function Count({ glyph, value }: { glyph: Glyph; value: number }) {
  const { colors } = useOmniTheme();
  return (
    <View style={styles.count}>
      <StatusDot glyph={glyph} />
      <Text style={[styles.countLabel, { color: glyph === 'running' ? colors.live : colors.fg2 }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: space.s11,
  },
  header: {
    paddingHorizontal: space.s9,
    paddingTop: space.s2,
    paddingBottom: space.s6,
    gap: space.s2,
  },
  summary: {
    fontSize: fontSize.small,
  },
  card: {
    paddingHorizontal: space.s8,
  },
  row: {
    minHeight: minTarget + space.s6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s6,
    paddingLeft: space.s7,
  },
  text: {
    flex: 1,
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s5,
    paddingVertical: space.s5,
    paddingRight: space.s7,
  },
  grow: {
    flex: 1,
    gap: space.s1,
  },
  name: {
    fontSize: fontSize.subhead,
    fontWeight: weight.medium,
  },
  sub: {
    fontSize: fontSize.small,
  },
  count: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s3,
  },
  countLabel: {
    fontSize: fontSize.ui,
    fontWeight: weight.medium,
    fontVariant: ['tabular-nums'],
  },
});
