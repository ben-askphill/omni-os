// What the finished turn left open for Ben (apps/server/runner/aux.ts): questions it asked him, decisions it left to him
// and blockers only he can clear, as the Web UI shows them under the transcript
// (apps/web/src/components/thread/OpenItemsCard.tsx). Answers typed or picked here go back as one reply through the
// composer's outbox; + opens New thread with one item as its first prompt; x drops an item, the header's x the card.
// Any reply drops it too, and the next turn reads what is still open.
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { Thread } from '@omni/client-core';
import { OPEN_ITEM_LABEL, spawnPrompt, type OpenItem } from '@omni/shared/open-items.ts';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { ThreadLive } from '../../live/hub';
import { useLiveHub, useStore } from '../../live/react';
import type { RootStackParamList } from '../../navigation/types';
import { answerPlaceholder, answersAfter, answersReply, answersWait, SLOT_TAKEN, openItemsHeading, pickOption, shownOpenItems, type OpenAnswers } from '../../thread/open-items';
import { fontSize, lineHeight, minTarget, radius, space, useOmniTheme, weight } from '../../theme';
import { Button } from '../../ui/Button';
import { Icon, type IconName } from '../../ui/Icon';
import { Text, TextInput } from '../../ui/Text';
import { ErrorNote } from './QuestionCard';

type Busy = 'send' | 'dismiss-all' | `dismiss:${number}`;

export function OpenItemsCard({ thread, live, waiting }: { thread: Thread; live: ThreadLive; waiting: boolean }) {
  const { colors } = useOmniTheme();
  const hub = useLiveHub();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const outbox = useStore(live.send.state).outbox.item;
  const [answers, setAnswers] = useState<OpenAnswers>({});
  const [busy, setBusy] = useState<Busy | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Answers belong to this set of items: only a dismiss, which leaves some of the same ones, keeps what was typed.
  const [answeredFor, setAnsweredFor] = useState(thread.open_items);
  if (answeredFor !== thread.open_items) {
    setAnsweredFor(thread.open_items);
    setAnswers((a) => answersAfter(answeredFor, thread.open_items, a));
  }
  const items = shownOpenItems(thread, answersWait(waiting, outbox));
  if (!items.length) return null;

  const reply = answersReply(items, answers);
  const run = async (what: Busy, call: () => Promise<void>) => {
    if (busy) return;
    setBusy(what);
    setError(null);
    try {
      await call();
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'Something went wrong');
    } finally {
      setBusy(null);
    }
  };
  // The composer's own path: the reply shows in the outbox until the server has it, and a failure stays there to retry.
  const send = () =>
    run('send', async () => {
      if (!reply) return;
      if (await live.send.submit(thread, reply)) setAnswers({});
      // The outbox holds one message at a time: a failed one waits for its Retry or Edit before this can go.
      else if (live.send.state.get().outbox.item?.phase === 'failed') setError(SLOT_TAKEN);
    });
  const dismiss = (what: Busy, text?: string) =>
    run(what, async () => hub.applyThread(await hub.request((api) => api.dismissOpenItems(thread.id, text))));
  const spawn = (item: OpenItem) => navigation.navigate('NewThread', { channel: thread.channel_id, prompt: spawnPrompt(item, thread.title) });

  return (
    <View accessibilityLabel="Open items" style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.line }]}>
      <View style={[styles.head, { backgroundColor: colors.surface2 }]}>
        <Text style={[styles.heading, { color: colors.fg3 }]}>{openItemsHeading(items.length)}</Text>
        <IconTap icon="x" label="Dismiss all" disabled={!!busy} onPress={() => void dismiss('dismiss-all')} />
      </View>
      {items.map((item, i) => {
        const value = answers[item.text] ?? '';
        return (
          <View key={item.text} style={[styles.item, i > 0 && { borderTopColor: colors.line, borderTopWidth: StyleSheet.hairlineWidth }]}>
            <View style={styles.itemHead}>
              <View style={styles.itemText}>
                <Text style={[styles.kind, { color: colors.fg3 }]}>{OPEN_ITEM_LABEL[item.kind].toUpperCase()}</Text>
                {/* All of it, never clamped: New thread starts from exactly this. */}
                <Text selectable style={[styles.text, { color: colors.fg }]}>
                  {item.text}
                </Text>
              </View>
              <View style={styles.itemActions}>
                <IconTap icon="plus" label="New thread for this" disabled={!!busy} onPress={() => spawn(item)} />
                <IconTap icon="x" label="Dismiss" disabled={!!busy} onPress={() => void dismiss(`dismiss:${i}`, item.text)} />
              </View>
            </View>
            {item.options ? (
              <View style={styles.options} accessibilityLabel="Options">
                {item.options.map((o) => (
                  <Button
                    key={o}
                    label={o}
                    size="compact"
                    variant={value === o ? 'primary' : 'secondary'}
                    selected={value === o}
                    accessibilityHint={value === o ? 'Tap again to clear.' : undefined}
                    disabled={!!busy}
                    onPress={() => setAnswers((a) => pickOption(a, item, o))}
                  />
                ))}
              </View>
            ) : null}
            <TextInput
              accessibilityLabel={`Answer: ${item.text}`}
              value={value}
              onChangeText={(text) => setAnswers((a) => ({ ...a, [item.text]: text }))}
              editable={busy !== 'send'}
              placeholder={answerPlaceholder(item)}
              placeholderTextColor={colors.fg4}
              returnKeyType="send"
              // Return is never greyed out: it sends once any item has an answer, as Enter does on the web, even from an empty field.
              onSubmitEditing={() => void send()}
              style={[styles.input, { color: colors.fg, borderColor: colors.lineStrong, backgroundColor: colors.surface2 }]}
            />
          </View>
        );
      })}
      <View style={[styles.foot, { borderTopColor: colors.line }]}>
        <Text style={[styles.hint, { color: colors.fg3 }]}>Answers go back as one reply.</Text>
        <Button label="Send answers" size="compact" busy={busy === 'send'} disabled={!reply || !!busy} onPress={() => void send()} />
      </View>
      {error ? (
        <View style={styles.error}>
          <ErrorNote message={error} />
        </View>
      ) : null}
    </View>
  );
}

function IconTap({ icon, label, disabled, onPress }: { icon: IconName; label: string; disabled: boolean; onPress: () => void }) {
  const { colors } = useOmniTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.iconTap, { opacity: disabled ? 0.4 : pressed ? 0.6 : 1 }]}
    >
      <Icon name={icon} size={16} color={colors.fg3} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    marginBottom: space.s6,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: space.s8,
    paddingRight: space.s2,
  },
  heading: {
    flex: 1,
    fontSize: fontSize.caption,
    fontWeight: weight.medium,
  },
  item: {
    paddingHorizontal: space.s8,
    paddingTop: space.s6,
    paddingBottom: space.s6,
    gap: space.s4,
  },
  itemHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.s2,
  },
  itemText: {
    flex: 1,
    gap: space.s1,
  },
  itemActions: {
    flexDirection: 'row',
    marginTop: -space.s6,
    marginRight: -space.s6,
  },
  kind: {
    fontSize: fontSize.meta,
    fontWeight: weight.medium,
    letterSpacing: 0.3,
  },
  text: {
    fontSize: fontSize.body,
    lineHeight: Math.round(fontSize.body * lineHeight.body),
  },
  options: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.s3,
  },
  // 16pt, so focusing it does not zoom, as phone web's --fs-input.
  input: {
    minHeight: minTarget,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.s6,
    paddingVertical: space.s4,
    fontSize: fontSize.input,
  },
  foot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s4,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingLeft: space.s8,
    paddingRight: space.s6,
    paddingVertical: space.s5,
  },
  hint: {
    flex: 1,
    fontSize: fontSize.caption,
  },
  iconTap: {
    width: minTarget,
    height: minTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  error: {
    paddingHorizontal: space.s8,
    paddingBottom: space.s6,
  },
});
