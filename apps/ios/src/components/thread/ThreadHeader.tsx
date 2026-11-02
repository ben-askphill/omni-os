import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { HarnessInfo, ThreadStatus } from '@omni/client-core';
import { blockedNote } from '@omni/shared/thread-machine.ts';

import type { ThreadView } from '../../live/hub';
import { fontSize, lineHeight, radius, space, useOmniTheme } from '../../theme';
import { StatusLine } from '../StatusLine';
import { RunChip } from './RunChips';

interface ThreadHeaderProps {
  view: ThreadView;
  /** From `/harnesses`; null until it loads. */
  harnesses: HarnessInfo[] | null;
  onOpenRun: () => void;
  onOpenChanges: () => void;
  onOpenPR: () => void;
  /** What the last menu action did, for a moment after the sheet closes. */
  flash: string | null;
}

/** Above the transcript: the connection, the thread's status and channel, its model, a failed refresh, and why a turn cannot start here. */
export function ThreadHeader({ view, harnesses, onOpenRun, onOpenChanges, onOpenPR, flash }: ThreadHeaderProps) {
  const { colors } = useOmniTheme();
  const { thread } = view;
  // The handoff card and the Take over note say it when they can, so the same sentence is not shown twice.
  const blocked = blockedNote(view.blocked, view.handoff, thread?.status, view.takeover);
  const statusLine = [threadStatusLabel(thread?.status), view.channel?.name, thread?.pinned_at ? 'Pinned' : null].filter(Boolean).join(' · ');
  return (
    <>
      <View style={styles.statusBar}>
        <StatusLine />
        {statusLine ? <Text style={[styles.meta, { color: colors.fg3 }]}>{statusLine}</Text> : null}
        {view.error ? <Text style={[styles.meta, { color: colors.fg3 }]}>{`Last update failed: ${view.error}`}</Text> : null}
        {flash ? (
          <Text accessibilityLiveRegion="polite" style={[styles.meta, { color: colors.fg }]}>
            {flash}
          </Text>
        ) : null}
      </View>
      {thread ? (
        <View style={styles.chips}>
          <RunChip thread={thread} harnesses={harnesses} onPress={onOpenRun} />
          <LinkChip label="Changes" hint="Opens the files this thread changed" onPress={onOpenChanges} />
          <LinkChip label="Pull request" hint="Opens this branch's pull request" onPress={onOpenPR} />
        </View>
      ) : null}
      {blocked ? (
        <View style={[styles.blocked, { borderColor: colors.lineStrong }]}>
          <Text style={[styles.blockedText, { color: colors.fg }]}>{blocked}</Text>
        </View>
      ) : null}
    </>
  );
}

function LinkChip({ label, hint, onPress }: { label: string; hint: string; onPress: () => void }) {
  const { colors } = useOmniTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      onPress={onPress}
      style={({ pressed }) => [styles.link, { backgroundColor: pressed ? colors.surface3 : colors.surface2 }]}
    >
      <Text style={[styles.linkLabel, { color: colors.fg }]}>{label}</Text>
      <Text style={[styles.linkCaret, { color: colors.fg3 }]}>›</Text>
    </Pressable>
  );
}

function threadStatusLabel(status: ThreadStatus | undefined): string {
  switch (status) {
    case 'running':
      return 'Running';
    case 'queued':
      return 'Queued';
    case 'done':
      return 'Done';
    case 'failed':
      return 'Failed';
    case 'stopped':
      return 'Stopped';
    case 'imported':
      return 'Imported';
    default:
      return '';
  }
}

const styles = StyleSheet.create({
  statusBar: {
    paddingHorizontal: space.s9,
    paddingBottom: space.s4,
    gap: space.s2,
  },
  meta: {
    fontSize: fontSize.meta,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.s4,
    paddingHorizontal: space.s9,
    paddingBottom: space.s4,
  },
  link: {
    height: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s2,
    borderRadius: radius.pill,
    paddingHorizontal: space.s6,
  },
  linkLabel: {
    fontSize: fontSize.body,
    fontWeight: '500',
  },
  linkCaret: {
    fontSize: fontSize.body,
  },
  blocked: {
    marginHorizontal: space.s9,
    marginBottom: space.s4,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: space.s8,
  },
  blockedText: {
    fontSize: fontSize.body,
    lineHeight: Math.round(fontSize.body * lineHeight.body),
  },
});
