import { useEffect, useMemo, useState } from 'react';
import { Alert, RefreshControl, SectionList, StyleSheet, View } from 'react-native';
import { Text } from '../ui/Text';

import { channelThreads, threadSections, type ThreadRow } from '../live/channel-model';
import { useChannels, useHandoffOpen, useLiveHub, usePullRefresh } from '../live/react';
import { ChannelAvatar } from '../components/ChannelAvatar';
import { FolderHeader } from '../components/FolderHeader';
import { HandoffRowView } from '../components/HandoffRowView';
import { ListHeading } from '../components/ListHeading';
import { StatusLine } from '../components/StatusLine';
import { ThreadMenuSheet } from '../components/thread/ThreadMenuSheet';
import { ThreadSwipeRow } from '../components/ThreadSwipeRow';
import type { RootScreenProps } from '../navigation/types';
import { EmptyState } from '../ui/EmptyState';
import { fontSize, space, useOmniTheme, weight } from '../theme';

export function ChannelScreen({ route, navigation }: RootScreenProps<'Channel'>) {
  const { id } = route.params;
  const { colors } = useOmniTheme();
  const hub = useLiveHub();
  const pull = usePullRefresh();
  const { channels } = useChannels();
  const channel = channels?.find((c) => c.id === id) ?? null;
  const name = channel?.name ?? null;
  const icon = channel?.icon ?? null;
  const [menuId, setMenuId] = useState<string | null>(null);

  useEffect(() => {
    if (name) navigation.setOptions({ title: name, headerTitle: () => <ChannelTitle name={name} icon={icon} avatarBg={channel?.avatar_bg} conductor={id === 'conductor'} /> });
  }, [id, name, icon, channel?.avatar_bg, navigation]);

  const sections = useMemo(() => {
    if (!channel) return [];
    const nameOf = (channelId: string) => channels?.find((c) => c.id === channelId)?.name ?? channelId;
    return threadSections(channelThreads(channel, Date.now(), nameOf));
  }, [channel, channels]);

  const toggleFolder = async (folderId: string, collapsed: boolean) => {
    const failure = await hub.setFolderCollapsed(folderId, collapsed);
    if (failure) Alert.alert('Could not update the folder', failure);
  };

  const open = (threadId: string) => navigation.navigate('Thread', { id: threadId });

  const menuTarget = useMemo(() => {
    for (const section of sections) {
      const row = section.data.find((r) => r.id === menuId);
      if (row) return row.target;
    }
    return null;
  }, [sections, menuId]);

  return (
    <>
      <SectionList
        sections={sections}
        keyExtractor={(row) => row.id}
        contentInsetAdjustmentBehavior="automatic"
        style={{ backgroundColor: colors.bg }}
        refreshControl={
          <RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={colors.fg3} />
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <StatusLine />
          </View>
        }
        ListEmptyComponent={
          channels === null ? (
            <EmptyState icon="hash" title="Loading threads" />
          ) : channel ? (
            <EmptyState icon="message" title="No threads yet" body="Start one with the + button above." action={{ label: 'New thread', onPress: () => navigation.navigate('NewThread', { channel: id }) }} />
          ) : (
            <EmptyState icon="alert" title="Channel not found" body="It may have been archived or removed on the server." />
          )
        }
        renderSectionHeader={({ section }) =>
          section.folder ? (
            <FolderHeader
              name={section.title}
              collapsed={section.folder.collapsed}
              count={section.folder.count}
              running={section.folder.running}
              onToggle={() => void toggleFolder(section.folder!.id, !section.folder!.collapsed)}
            />
          ) : (
            <ListHeading>{section.title}</ListHeading>
          )
        }
        renderItem={({ item }) => <ChannelThreadRow row={item} onOpen={open} onMenu={setMenuId} />}
        stickySectionHeadersEnabled={false}
      />
      <ThreadMenuSheet target={menuTarget} folders={channel?.folders ?? []} onClose={() => setMenuId(null)} onChanged={() => {}} />
    </>
  );
}

/** A thread row, or a Conductor thread with the threads it delegated under it. Either swipes and opens the thread menu. */
function ChannelThreadRow({ row, onOpen, onMenu }: { row: ThreadRow; onOpen: (threadId: string) => void; onMenu: (threadId: string) => void }) {
  const [open, toggle] = useHandoffOpen(row.id);
  if (!row.handoff) return <ThreadSwipeRow row={row} onPress={() => onOpen(row.id)} onMenu={() => onMenu(row.id)} />;
  return <HandoffRowView row={{ ...row, handoff: row.handoff }} open={open} onToggle={toggle} onOpenThread={onOpen} onMenu={() => onMenu(row.id)} />;
}

function ChannelTitle({ name, icon, conductor, avatarBg }: { avatarBg?: string | null; name: string; icon: string | null; conductor: boolean }) {
  const { colors } = useOmniTheme();
  return (
    <View style={styles.title} accessibilityRole="header" accessibilityLabel={name}>
      <ChannelAvatar name={name} icon={icon} avatarBg={avatarBg} conductor={conductor} size={24} />
      <Text numberOfLines={1} style={[styles.titleText, { color: colors.fg }]}>
        {name}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  title: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s4,
    maxWidth: 240,
  },
  titleText: {
    flexShrink: 1,
    fontSize: fontSize.heading,
    fontWeight: weight.medium,
  },
  header: {
    paddingHorizontal: space.s9,
    paddingTop: space.s2,
  },
});
