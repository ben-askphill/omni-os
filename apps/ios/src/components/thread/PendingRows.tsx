import { StyleSheet, Text, View } from 'react-native';

import type { PendingMsg } from '@omni/client-core';

import { AttachmentRow } from '../../attachments/AttachmentRow';
import type { ThreadLive, ThreadView } from '../../live/hub';
import { useStore } from '../../live/react';
import { liveMessages } from '../../needs/thread-cards';
import { pendingLabel } from '../../send/rules';
import { fontSize, lineHeight, radius, space, useOmniTheme } from '../../theme';
import { OutboxRow } from './OutboxRow';

/**
 * Everything below the last transcript row: the messages the agent has not read yet, then the one this phone is
 * sending. The newest sits nearest the composer. Messages a restart parked on Ben are the Resume card's (NeedsCards).
 */
export function PendingRows({ view, live }: { view: ThreadView; live: ThreadLive }) {
  const hasOutbox = useStore(live.send.state).outbox.item !== null;
  const pending = liveMessages(view.pending);
  if (pending.length === 0 && !hasOutbox) return null;
  return (
    <View style={styles.rows}>
      {pending.map((m) => (
        <PendingRow key={m.uuid} message={m} threadId={view.threadId} />
      ))}
      <OutboxRow live={live} threadId={view.threadId} />
    </View>
  );
}

function PendingRow({ message, threadId }: { message: PendingMsg; threadId: string }) {
  const { colors } = useOmniTheme();
  const quiet = message.kind === 'crew_report';
  return (
    <View style={[styles.item, { backgroundColor: colors.surface }]}>
      <Text style={[styles.meta, { color: colors.fg3 }]}>{pendingLabel(message)}</Text>
      <Text numberOfLines={3} style={[styles.text, { color: quiet ? colors.fg3 : colors.fg2 }]}>
        {message.text}
      </Text>
      <AttachmentRow threadId={threadId} items={message.attachments ?? []} />
    </View>
  );
}

const styles = StyleSheet.create({
  rows: {
    gap: space.s4,
    paddingBottom: space.s6,
  },
  item: {
    borderRadius: radius.md,
    padding: space.s6,
    gap: space.s2,
  },
  meta: {
    fontSize: fontSize.meta,
  },
  text: {
    fontSize: fontSize.body,
    lineHeight: Math.round(fontSize.body * lineHeight.body),
  },
});
