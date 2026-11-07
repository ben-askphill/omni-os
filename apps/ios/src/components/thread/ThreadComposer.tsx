import { useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '../../ui/Text';

import type { HarnessInfo, Thread } from '@omni/client-core';

import { AttachControl, AttachNotice } from '../../attachments/AttachControl';
import { AttachmentChips } from '../../attachments/AttachmentChips';
import { clearStaged, getStaged, removeStagedFile, restoreStaged, useStaged } from '../../attachments/staged';
import { removeDraftContext, useDraftContext } from '../../context/draft';
import type { ThreadLive } from '../../live/hub';
import { useStore } from '../../live/react';
import { canStop, composerPlaceholder, sendLabel } from '../../send/rules';
import { fontSize, lineHeight, radius, space, useOmniTheme, weight } from '../../theme';
import { tap } from '../../ui/haptics';
import { Icon } from '../../ui/Icon';
import { restoreDraft, setDraft, useDraft, useFocusRequests } from './drafts';
import { NextTurnChip } from './RunChips';

const INPUT_LINE_HEIGHT = Math.round(fontSize.input * lineHeight.body);
const MAX_LINES = 6;
const BUTTON_SIZE = 36;
/** One line of text centered in a row as tall as the button. */
const INPUT_PADDING = (BUTTON_SIZE - INPUT_LINE_HEIGHT) / 2;

/**
 * The box a message is written in. It steers or queues while a turn runs (the placeholder and the button's label say
 * which), and swaps Send for Stop when the box is empty and a turn can be stopped. The draft is per thread and
 * outlives the screen.
 */
export function ThreadComposer({
  live,
  thread,
  harnesses,
  onOpenRun,
}: {
  live: ThreadLive;
  thread: Thread;
  /** From `/harnesses`; null until it loads. */
  harnesses: HarnessInfo[] | null;
  onOpenRun: () => void;
}) {
  const { colors } = useOmniTheme();
  const catalog = useStore(live.catalog);
  const { outbox, stopping, notice } = useStore(live.send.state);
  const draft = useDraft(thread.id);
  const files = useStaged(thread.id);
  const context = useDraftContext(thread.id);
  const [attachNotice, setAttachNotice] = useState<string | null>(null);
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  useFocusRequests(thread.id, input);

  const empty = draft.trim() === '' && context.length === 0;
  // The server takes files only with a message, so a file with no text says what is missing.
  const placeholder = files.length > 0 && empty ? 'Add a message to send with the files' : composerPlaceholder(thread, catalog);
  const slotTaken = outbox.item !== null;
  const showStop = empty && !slotTaken && canStop(thread);

  const send = async () => {
    if (empty || slotTaken) return;
    tap();
    const text = draft;
    const attached = getStaged(thread.id);
    setDraft(thread.id, '');
    clearStaged(thread.id);
    setAttachNotice(null);
    const sent = await live.send.submit(thread, text, attached, context);
    // A failed send keeps its text and files in the outbox, and its context stays in the draft until a send lands. Nothing in the slot and nothing sent means it never started.
    if (!sent && live.send.state.get().outbox.item === null) {
      restoreDraft(thread.id, text);
      restoreStaged(thread.id, attached);
    }
  };

  return (
    <View style={styles.composer}>
      <View style={styles.nextTurn}>
        <NextTurnChip thread={thread} harnesses={harnesses} onPress={onOpenRun} />
      </View>
      {notice ? (
        <Text accessibilityRole="alert" style={[styles.notice, { color: colors.fg2 }]}>
          {notice}
        </Text>
      ) : null}
      {attachNotice ? <AttachNotice text={attachNotice} /> : null}
      {files.length > 0 ? (
        <View style={styles.chips}>
          <AttachmentChips files={files} onRemove={(id) => removeStagedFile(thread.id, id)} />
        </View>
      ) : null}
      {context.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.contextRow} accessibilityLabel="Added to this message">
          {context.map((c) => (
            <View key={c.id} style={[styles.contextChip, { backgroundColor: colors.surface2 }]}>
              <Text numberOfLines={1} ellipsizeMode="middle" style={[styles.contextLabel, { color: colors.fg2 }]}>
                {c.label}
              </Text>
              <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${c.label}`} hitSlop={space.s6} onPress={() => removeDraftContext(thread.id, c.id)}>
                <Icon name="close" size={11} weight="semibold" color={colors.fg3} />
              </Pressable>
            </View>
          ))}
        </ScrollView>
      ) : null}
      <View style={[styles.pill, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <AttachControl scope={thread.id} disabled={slotTaken} onNotice={setAttachNotice} />
        <TextInput
          ref={input}
          accessibilityLabel={placeholder}
          multiline
          value={draft}
          onChangeText={(text) => setDraft(thread.id, text)}
          placeholder={placeholder}
          placeholderTextColor={colors.fg3}
          style={[styles.input, { color: colors.fg }]}
        />
        {showStop ? (
          <RoundButton
            label={stopping ? 'Stopping' : 'Stop'}
            busy={stopping}
            disabled={stopping}
            onPress={() => {
              tap();
              void live.send.stop();
            }}
          >
            <Icon name="stop" size={13} color={colors.onInk} />
          </RoundButton>
        ) : (
          <RoundButton label={sendLabel(thread, catalog)} busy={outbox.item?.phase === 'sending'} disabled={empty || slotTaken} onPress={() => void send()}>
            <Icon name="arrowUp" size={16} weight="bold" color={colors.onInk} />
          </RoundButton>
        )}
      </View>
    </View>
  );
}

function RoundButton({
  label,
  busy,
  disabled,
  onPress,
  children,
}: {
  label: string;
  busy: boolean;
  disabled: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  const { colors } = useOmniTheme();
  const inactive = busy || disabled;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inactive, busy }}
      disabled={inactive}
      hitSlop={space.s2}
      onPress={onPress}
      style={[styles.button, { backgroundColor: colors.fg, opacity: disabled && !busy ? 0.3 : 1 }]}
    >
      {busy ? <ActivityIndicator size="small" color={colors.onInk} /> : children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  composer: {
    gap: space.s2,
  },
  nextTurn: {
    flexDirection: 'row',
  },
  chips: {
    paddingHorizontal: space.s2,
  },
  contextRow: {
    gap: space.s2,
    paddingHorizontal: space.s2,
  },
  contextChip: {
    maxWidth: 260,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s2,
    borderRadius: radius.pill,
    paddingVertical: space.s2,
    paddingHorizontal: space.s4,
  },
  contextLabel: {
    flexShrink: 1,
    fontSize: fontSize.meta + 1,
    fontWeight: weight.semibold,
  },
  notice: {
    fontSize: fontSize.meta,
    paddingHorizontal: space.s6,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderRadius: radius.xxl,
    borderWidth: StyleSheet.hairlineWidth,
    paddingLeft: space.s2,
    paddingRight: space.s2,
    paddingVertical: space.s2,
    gap: space.s2,
  },
  input: {
    flex: 1,
    fontSize: fontSize.input,
    lineHeight: INPUT_LINE_HEIGHT,
    minHeight: BUTTON_SIZE,
    maxHeight: INPUT_LINE_HEIGHT * MAX_LINES + 2 * INPUT_PADDING,
    paddingVertical: INPUT_PADDING,
    paddingHorizontal: 0,
  },
  button: {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: BUTTON_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
