import { useEffect, useMemo, useState } from 'react';
import { Alert, RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';

import { channelThreads, threadSections, type ThreadRow } from '../live/channel-model';
import { useChannels, useHandoffOpen, useLiveHub, usePullRefresh } from '../live/react';
import { FolderHeader } from '../components/FolderHeader';
import { HandoffRowView } from '../components/HandoffRowView';
import { ListHeading } from '../components/ListHeading';
import { StatusLine } from '../components/StatusLine';
import { ThreadMenuSheet } from '../components/thread/ThreadMenuSheet';
import { ThreadSwipeRow } from '../components/ThreadSwipeRow';
import type { RootScreenProps } from '../navigation/types';
import { fontSize, space, useOmniTheme } from '../theme';

export function ChannelScreen({ route, navigation }: RootScreenProps<'Channel'>) {
  const { id } = route.params;
  const { colors } = useOmniTheme();
  const hub = useLiveHub();
  const pull = usePullRefresh();
  const { channels } = useChannels();
  const channel = channels?.find((c) => c.id === id) ?? null;
  const name = channel?.name ?? null;
  const [menuId, setMenuId] = useState<string | null>(null);

  useEffect(() => {
    if (name) navigation.setOptions({ title: name });
  }, [name, navigation]);

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
          <View style={styles.empty}>
            <Text style={[styles.emptyTitle, { color: colors.fg }]}>
              {channels === null ? 'Loading threads' : channel ? 'No threads yet' : 'Channel not found'}
            </Text>
            {channel === null && channels !== null ? (
              <Text style={[styles.emptyBody, { color: colors.fg3 }]}>It may have been archived or removed on the server.</Text>
            ) : null}
          </View>
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

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: space.s9,
    paddingTop: space.s2,
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
});
