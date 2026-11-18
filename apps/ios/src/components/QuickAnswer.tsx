// A quick ask's answer on the New screen, as the phone web's New sheet and the desktop app's Quick Prompt show it
// (apps/web/src/components/QuickAnswer.tsx): the questions and answers live, a follow-up box, Copy (through the share
// sheet), Keep as thread and Make it a task. The rules are @omni/shared/quick-ask.ts.
import { promotedLine, quickAskView } from '@omni/shared/quick-ask.ts';
import { useState } from 'react';
import { ActivityIndicator, Share, StyleSheet, View } from 'react-native';

import { useLiveHub, useStore, useThreadLive } from '../live/react';
import { fontSize, radius, space, useOmniTheme } from '../theme';
import { Button } from '../ui/Button';
import { Text, TextInput } from '../ui/Text';
import { Markdown } from './thread/Markdown';

export function QuickAnswer({ id, onOpen }: { id: string; onOpen: (threadId: string) => void }) {
  const live = useThreadLive(id);
  return live ? <Answer live={live} id={id} onOpen={onOpen} /> : <ActivityIndicator />;
}

function Answer({ live, id, onOpen }: { live: NonNullable<ReturnType<typeof useThreadLive>>; id: string; onOpen: (threadId: string) => void }) {
  const { colors } = useOmniTheme();
  const hub = useLiveHub();
  const state = useStore(live.view);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<'send' | 'keep' | 'task' | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!state.thread) return <ActivityIndicator />;
  const view = quickAskView(state.thread, state.rows);

  const act = async (what: 'send' | 'keep' | 'task') => {
    setBusy(what);
    setError(null);
    try {
      if (what === 'send') {
        if (!text.trim()) return;
        await hub.request((api) => api.sendMessage(id, { prompt: text.trim(), mode: 'queue' }));
      } else {
        const r = await hub.request((api) => api.promoteQuickAsk(id, what, text.trim() || undefined));
        onOpen(r.task?.id ?? r.ask.id);
      }
      setText('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={styles.wrap} accessibilityLabel="Answer">
      {!view.turns.length ? (
        <View style={styles.line}>
          <ActivityIndicator size="small" />
          <Text style={[styles.note, { color: colors.fg3 }]}>Thinking</Text>
        </View>
      ) : null}
      {view.turns.map((t, i) => (
        <View key={i} style={styles.turn}>
          <Text style={[styles.question, { color: colors.fg2 }]}>{t.question}</Text>
          {t.answer ? (
            <Markdown text={t.answer} onOpenThread={onOpen} />
          ) : view.busy && i === view.turns.length - 1 ? (
            <View style={styles.line}>
              <ActivityIndicator size="small" />
              <Text style={[styles.note, { color: colors.fg3 }]}>Thinking</Text>
            </View>
          ) : null}
        </View>
      ))}
      {view.promoted ? (
        <View style={styles.line}>
          <Text style={[styles.note, styles.grow, { color: colors.fg2 }]}>{promotedLine(view.promoted.auto)}</Text>
          <Button size="compact" variant="secondary" label="Open task" onPress={() => onOpen(view.promoted!.thread_id)} />
        </View>
      ) : view.kept ? (
        <View style={styles.line}>
          <Text style={[styles.note, styles.grow, { color: colors.fg2 }]}>Kept as a thread.</Text>
          <Button size="compact" variant="secondary" label="Open" onPress={() => onOpen(id)} />
        </View>
      ) : (
        <>
          <TextInput
            multiline
            value={text}
            onChangeText={setText}
            accessibilityLabel="Follow-up"
            placeholder="Ask a follow-up"
            placeholderTextColor={colors.fg4}
            style={[styles.input, { color: colors.fg, backgroundColor: colors.surface }]}
          />
          <View style={styles.actions}>
            <Button size="small" variant="primary" label="Send" disabled={!text.trim() || busy !== null} onPress={() => void act('send')} />
            <Button size="small" variant="secondary" label="Copy" disabled={!view.copy} onPress={() => view.copy && void Share.share({ message: view.copy })} />
            <Button size="small" variant="secondary" label="Keep as thread" disabled={view.busy || busy !== null} onPress={() => void act('keep')} />
            <Button size="small" variant="secondary" label="Make it a task" disabled={busy !== null} onPress={() => void act('task')} />
          </View>
        </>
      )}
      {error ? <Text style={[styles.note, { color: colors.fg2 }]}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.s6 },
  turn: { gap: space.s3 },
  question: { fontSize: fontSize.body, fontWeight: '500' },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.s4 },
  grow: { flex: 1 },
  note: { fontSize: fontSize.small },
  input: { borderRadius: radius.md, paddingHorizontal: space.s6, paddingVertical: space.s5, fontSize: 16, minHeight: 44 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s4 },
});
