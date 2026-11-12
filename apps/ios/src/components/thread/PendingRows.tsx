import { StyleSheet, View } from 'react-native';
import { Text } from '../../ui/Text';

import type { PendingMsg } from '@omni/client-core';
import { forwardedLabel, isForwarded } from '@omni/shared/forwarded.ts';

import { AttachmentRow } from '../../attachments/AttachmentRow';
import type { ThreadLive, ThreadView } from '../../live/hub';
import { useStore } from '../../live/react';
import { liveMessages } from '../../needs/thread-cards';
import { pendingLabel } from '../../send/rules';
import { useSyncTrouble } from '../../send/use-sync-trouble';
import { useMinuteClock } from '../../live/use-minute-clock';
import { fontSize, lineHeight, radius, space, useOmniTheme } from '../../theme';
import { OutboxRow } from './OutboxRow';

/**
 * Everything below the last transcript row: the messages the agent has not read yet, then the one this phone is
 * sending. The newest sits nearest the composer. Messages a restart parked on Ben are the Resume card's (NeedsCards).
 */
export function PendingRows({ view, live }: { view: ThreadView; live: ThreadLive }) {
  const hasOutbox = useStore(live.send.state).outbox.item !== null;
  const pending = liveMessages(view.pending);
  // A message to a thread another machine holds waits here until that machine takes it, and says when sync holds it up.
  const trouble = useSyncTrouble(pending.some(isForwarded));
  if (pending.length === 0 && !hasOutbox) return null;
  return (
    <View style={styles.rows}>
      {pending.map((m) => (
        <PendingRow key={m.uuid} message={m} threadId={view.threadId} trouble={trouble} />
      ))}
      <OutboxRow live={live} threadId={view.threadId} />
    </View>
  );
}

function PendingRow({ message, threadId, trouble }: { message: PendingMsg; threadId: string; trouble: string | null }) {
  const { colors } = useOmniTheme();
  const now = useMinuteClock();
  const quiet = message.kind === 'crew_report';
  const forwarded = isForwarded(message);
  const label = forwarded ? forwardedLabel(message, trouble, now) : pendingLabel(message);
  return (
    <View style={[styles.item, { backgroundColor: colors.surface }]}>
      <Text accessibilityRole={forwarded && trouble ? 'alert' : undefined} style={[styles.meta, { color: forwarded && trouble ? colors.needs : colors.fg3 }]}>
        {label}
      </Text>
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
