import { useEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Text, TextInput } from '../../ui/Text';

import type { HarnessInfo, SlashCommand, Thread } from '@omni/client-core';
import { commandMenu, replySlash } from '@omni/shared/composer-slash.ts';
import { pickCommand } from '@omni/shared/slash-menu.ts';

import { AttachControl, AttachNotice } from '../../attachments/AttachControl';
import { AttachmentChips } from '../../attachments/AttachmentChips';
import { clearStaged, getStaged, removeStagedFile, restoreStaged, useStaged } from '../../attachments/staged';
import { chipRecords } from '@omni/shared/message-context-machine.ts';
import type { FileMention, FileQuery } from '@omni/shared/mention-menu.ts';

import { addDraftContext, removeDraftContext, useDraftContext } from '../../context/draft';
import type { ThreadLive } from '../../live/hub';
import { useAgents, useLiveHub, useStore, useTechnical, useThreadKey } from '../../live/react';
import { agentMenu, composerRouting, pickAgent, threadAgents } from '../../thread/agents';
import { AgentAvatar } from '../AgentAvatar';
import { canStop, composerPlaceholder, sendLabel } from '../../send/rules';
import { fontSize, lineHeight, radius, space, useOmniTheme, weight } from '../../theme';
import { tap } from '../../ui/haptics';
import { Icon } from '../../ui/Icon';
import { getDraft, restoreDraft, setDraft, useDraft, useFocusRequests } from './drafts';
import { ModelButton, NextTurnChip } from './RunChips';
import { CommandMenu } from './CommandMenu';
import { commandStep } from '../../thread/commands';
import { useCommands, useThreadActions } from '../../thread/hooks';
import { targetOfThread } from '../../thread/target';
import { toUploadFiles } from '../../attachments/model';
import { newThreadId } from '../../newthread/draft';
import type { RootStackParamList } from '../../navigation/types';

const INPUT_LINE_HEIGHT = Math.round(fontSize.input * lineHeight.body);
const MAX_LINES = 6;
const BUTTON_SIZE = 36;
/** One line of text centered in a row as tall as the button. */
const INPUT_PADDING = (BUTTON_SIZE - INPUT_LINE_HEIGHT) / 2;

/**
 * The box a message is written in. It steers or queues while a turn runs (the placeholder and the button's label say
 * which), and swaps Send for Stop when the box is empty and a turn can be stopped. The draft is per server and thread
 * (live/thread-key.ts) and outlives the screen.
 */
export function ThreadComposer({
  live,
  thread,
  harnesses,
  onOpenRun,
  step,
}: {
  live: ThreadLive;
  thread: Thread;
  /** From `/harnesses`; null until it loads. */
  harnesses: HarnessInfo[] | null;
  onOpenRun: () => void;
  /** The branch step chip (StepChip), beside the next-turn chip. */
  step?: ReactNode;
}) {
  const { colors } = useOmniTheme();
  const catalog = useStore(live.catalog);
  const technical = useTechnical();
  const { outbox, stopping, notice } = useStore(live.send.state);
  const key = useThreadKey(thread.id);
  const draft = useDraft(key);
  const files = useStaged(key);
  const context = useDraftContext(key);
  const [attachNotice, setAttachNotice] = useState<string | null>(null);
  const [caret, setCaret] = useState(0);
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  useFocusRequests(key, input);
  const roster = useAgents();
  const agents = useMemo(() => threadAgents(thread, roster), [thread, roster]);
  // Who gets the message (ADR 0019): the lead in the placeholder, the agents an `@` names in the hint under the box.
  const routing = composerRouting(thread, agents, draft, context);
  const menu = routing.readOnly ? null : agentMenu(draft, Math.min(caret, draft.length), agents);
  // The `/` menu, and what Send does with a command, as in the Web UI's reply box (packages/shared/composer-slash.ts).
  const commands = useCommands({ thread: thread.id });
  const slashMenu = routing.readOnly ? null : commandMenu(draft, Math.min(caret, draft.length), commands.list, 'reply');
  const showSlash = !!slashMenu && (slashMenu.sections.length > 0 || commands.list?.status !== 'ready');
  const slash = replySlash(draft, commands.list, thread.harness);
  const omni = slash.action.kind !== 'send';
  const [running, setRunning] = useState(false);
  const hub = useLiveHub();
  const runAction = useThreadActions();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  // A fresh list each time the menu opens. The server only probes a list older than 30 seconds.
  const { load } = commands;
  useEffect(() => {
    if (showSlash) load();
  }, [showSlash, load]);

  const empty = draft.trim() === '' && context.length === 0;
  // The server takes files only with a message, so a file with no text says what is missing.
  const placeholder = files.length > 0 && empty ? 'Add a message to send with the files' : (routing.placeholder ?? composerPlaceholder(thread, catalog, technical));
  const slotTaken = outbox.item !== null;
  const showStop = empty && !slotTaken && canStop(thread);
  // Agent mentions the text names show inline when sent; the rest stay chips here, each with a remove.
  const chips = chipRecords(draft, context);

  const pick = (at: FileQuery, row: FileMention) => {
    tap();
    const picked = pickAgent(draft, at, row, context);
    const why = picked.record ? addDraftContext(key, picked.record) : null;
    if (why) return setAttachNotice(why);
    setDraft(key, picked.text);
    setCaret(picked.caret);
  };

  const pickRow = (c: SlashCommand) => {
    if (!slashMenu) return;
    tap();
    const picked = pickCommand(draft, slashMenu.at, c.name);
    setDraft(key, picked.text);
    setCaret(picked.caret);
  };

  /** Run the Omni command the message starts with. The thread itself sees none of it. */
  const runOmni = async () => {
    if (!slash.armed || running || routing.readOnly) return;
    tap();
    const text = draft;
    // Clear what was sent, unless Ben typed more while it was in flight.
    const sent = () => getDraft(key) === text && setDraft(key, '');
    const step = commandStep(slash.action, thread);
    if (step.kind === 'pick-model') {
      sent();
      return onOpenRun();
    }
    if (step.kind === 'open-new') {
      sent();
      return navigation.navigate('NewThread', { channel: step.channel, run: step.run });
    }
    setRunning(true);
    setAttachNotice(null);
    try {
      if (step.kind === 'start') {
        const attached = getStaged(key);
        const t = await hub.request((api) => api.createThread({ id: newThreadId(), ...step.body }, attached.length ? { files: toUploadFiles(attached) } : undefined));
        sent();
        clearStaged(key);
        navigation.push('Thread', { id: t.id });
      } else if (step.kind === 'rename') {
        const outcome = await runAction(targetOfThread(thread), { kind: 'rename', title: step.title });
        if (outcome.kind === 'failed') setAttachNotice(outcome.error);
        else sent();
      }
    } catch (e) {
      setAttachNotice(e instanceof Error && e.message ? e.message : 'Something went wrong');
    } finally {
      setRunning(false);
    }
  };

  const send = async () => {
    if (omni) return runOmni();
    if (empty || slotTaken || routing.readOnly) return;
    tap();
    const text = draft;
    const attached = getStaged(key);
    setDraft(key, '');
    clearStaged(key);
    setAttachNotice(null);
    const sent = await live.send.submit(thread, text, attached, context);
    // A failed send keeps its text and files in the outbox, and its context stays in the draft until a send lands. Nothing in the slot and nothing sent means it never started.
    // `key` is this render's: a send that ends after a server switch puts its text back on the server it was for.
    if (!sent && live.send.state.get().outbox.item === null) {
      restoreDraft(key, text);
      restoreStaged(key, attached);
    }
  };

  return (
    <View style={styles.composer}>
      <View style={styles.nextTurn}>
        <NextTurnChip thread={thread} harnesses={harnesses} onPress={onOpenRun} />
        {step}
      </View>
      {notice ? (
        <Text accessibilityRole="alert" style={[styles.notice, { color: colors.fg2 }]}>
          {notice}
        </Text>
      ) : null}
      {attachNotice ? <AttachNotice text={attachNotice} /> : null}
      {files.length > 0 ? (
        <View style={styles.chips}>
          <AttachmentChips files={files} onRemove={(id) => removeStagedFile(key, id)} />
        </View>
      ) : null}
      {menu ? <AgentMenu rows={menu.rows} onPick={(row) => pick(menu.at, row)} /> : null}
      {showSlash && slashMenu ? <CommandMenu list={commands.list} sections={slashMenu.sections} technical={technical} onPick={pickRow} /> : null}
      {chips.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.contextRow} accessibilityLabel="Added to this message">
          {chips.map((c) => (
            <View key={c.id} style={[styles.contextChip, { backgroundColor: colors.surface2 }]}>
              <Text numberOfLines={1} ellipsizeMode="middle" style={[styles.contextLabel, { color: colors.fg2 }]}>
                {c.label}
              </Text>
              <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${c.label}`} hitSlop={space.s6} onPress={() => removeDraftContext(key, c.id)}>
                <Icon name="close" size={11} color={colors.fg3} />
              </Pressable>
            </View>
          ))}
        </ScrollView>
      ) : null}
      <View style={[styles.pill, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <AttachControl scope={key} disabled={slotTaken} onNotice={setAttachNotice} />
        <TextInput
          ref={input}
          accessibilityLabel={placeholder}
          multiline
          editable={!routing.readOnly}
          value={draft}
          onChangeText={(text) => setDraft(key, text)}
          onFocus={load}
          onSelectionChange={(e) => setCaret(e.nativeEvent.selection.end)}
          placeholder={placeholder}
          placeholderTextColor={colors.fg3}
          style={[styles.input, { color: colors.fg }]}
        />
        <ModelButton thread={thread} harnesses={harnesses} onPress={onOpenRun} />
        {omni ? (
          // Named for what Send does, as the Web UI's Send button is: Rename, New thread, Pick model.
          <RoundButton label={slash.label ?? 'Send'} busy={running} disabled={!slash.armed || routing.readOnly} onPress={() => void runOmni()}>
            <Icon name="arrowUp" size={16} color={colors.onInk} />
          </RoundButton>
        ) : showStop ? (
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
          <RoundButton label={routing.toOthers ? 'Send' : sendLabel(thread, catalog)} busy={outbox.item?.phase === 'sending'} disabled={empty || slotTaken || routing.readOnly} onPress={() => void send()}>
            <Icon name="arrowUp" size={16} color={colors.onInk} />
          </RoundButton>
        )}
      </View>
      {slash.hint && !showSlash ? (
        <Text accessibilityLiveRegion="polite" style={[styles.hint, { color: colors.fg3 }]}>
          {slash.hint}
        </Text>
      ) : routing.hint ? (
        <Text accessibilityLiveRegion="polite" style={[styles.hint, { color: colors.fg3 }]}>
          {routing.hint}
        </Text>
      ) : null}
    </View>
  );
}

/** The `@` menu over the box: the thread's members, then the agents a mention would seat. */
function AgentMenu({ rows, onPick }: { rows: FileMention[]; onPick: (row: FileMention) => void }) {
  const { colors } = useOmniTheme();
  return (
    <View accessibilityLabel="Agents" style={[styles.menu, { backgroundColor: colors.elev, borderColor: colors.line }]}>
      <ScrollView keyboardShouldPersistTaps="always" style={styles.menuList}>
        {rows.map((r) => (
          <Pressable
            key={r.insert}
            accessibilityRole="button"
            accessibilityLabel={`${r.name}, ${r.detail}`}
            onPress={() => onPick(r)}
            style={({ pressed }) => [styles.menuRow, pressed && { backgroundColor: colors.surface2 }]}
          >
            <AgentAvatar agent={r.insert} size={24} />
            <Text numberOfLines={1} style={[styles.menuName, { color: colors.fg }]}>
              {r.name}
            </Text>
            <Text numberOfLines={1} style={[styles.menuDetail, { color: colors.fg3 }]}>
              {r.detail}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
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
    flexWrap: 'wrap',
    gap: space.s2,
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
    fontSize: fontSize.caption,
    fontWeight: weight.semibold,
  },
  notice: {
    fontSize: fontSize.meta,
    paddingHorizontal: space.s6,
  },
  hint: {
    fontSize: fontSize.caption,
    paddingHorizontal: space.s8,
  },
  menu: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: space.s2,
  },
  menuList: {
    maxHeight: 44 * 4.5,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s5,
    minHeight: 44,
    paddingHorizontal: space.s6,
  },
  menuName: {
    flexShrink: 1,
    fontSize: fontSize.body,
    fontWeight: weight.medium,
  },
  menuDetail: {
    marginLeft: 'auto',
    fontSize: fontSize.caption,
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
