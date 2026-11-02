import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AttachmentChips } from '../../attachments/AttachmentChips';
import { restoreStaged } from '../../attachments/staged';
import type { ThreadLive } from '../../live/hub';
import { useStore } from '../../live/react';
import { fontSize, space, useOmniTheme } from '../../theme';
import { Button } from '../../ui/Button';
import { UserBubble } from '../UserBubble';
import { editInComposer } from './drafts';

/**
 * The message on its way, drawn where it will land in the transcript. Files show as chips with a progress bar and a
 * Cancel while they upload. When it failed, the text and files stay here with a Retry (the same request id, so a send
 * that did reach the server is not repeated) and an Edit that moves them back into the composer.
 */
export function OutboxRow({ live, threadId }: { live: ThreadLive; threadId: string }) {
  const { outbox, progress } = useStore(live.send.state);
  const item = outbox.item;
  if (!item) return null;
  const text = [item.text, ...item.context.map((c) => `Attached ${c.label}`)].filter(Boolean).join('\n');

  if (item.phase === 'sending') {
    const uploading = item.files.length > 0;
    return (
      <UserBubble text={text} caption={uploading ? uploadCaption(progress) : 'Sending…'} busy>
        {uploading ? (
          <>
            <AttachmentChips files={item.files} />
            <UploadBar progress={progress} onCancel={live.send.cancelUpload} />
          </>
        ) : null}
      </UserBubble>
    );
  }

  const edit = () => {
    const taken = live.send.edit();
    if (!taken) return;
    restoreStaged(threadId, taken.files);
    editInComposer(threadId, taken.text);
  };

  return (
    <UserBubble text={text} caption={item.failure.message} dimmed>
      <AttachmentChips files={item.files} dimmed />
      <View style={styles.actions}>
        {item.failure.kind === 'signed-out' ? null : (
          <View style={styles.action}>
            <Button label="Retry" onPress={() => void live.send.retry()} />
          </View>
        )}
        <View style={styles.action}>
          <Button label="Edit" variant="secondary" onPress={edit} />
        </View>
      </View>
    </UserBubble>
  );
}

const uploadCaption = (progress: number | null) => (progress === null ? 'Uploading…' : `Uploading ${Math.round(progress * 100)}%`);

function UploadBar({ progress, onCancel }: { progress: number | null; onCancel: () => void }) {
  const { colors } = useOmniTheme();
  return (
    <View style={styles.upload}>
      <View
        accessibilityRole="progressbar"
        accessibilityLabel="Upload progress"
        accessibilityValue={progress === null ? undefined : { min: 0, max: 100, now: Math.round(progress * 100) }}
        style={[styles.track, { backgroundColor: colors.surface3 }]}
      >
        <View style={[styles.fill, { backgroundColor: colors.fg, width: `${Math.round((progress ?? 0) * 100)}%` }]} />
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Cancel upload" hitSlop={8} onPress={onCancel}>
        <Text style={[styles.cancel, { color: colors.fg }]}>Cancel</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: 'row',
    gap: space.s4,
    paddingTop: space.s2,
  },
  action: {
    flex: 1,
  },
  upload: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s6,
    paddingTop: space.s2,
  },
  track: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  fill: {
    height: 4,
    borderRadius: 2,
  },
  cancel: {
    fontSize: fontSize.body,
    fontWeight: '600',
  },
});
