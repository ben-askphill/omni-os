// The questions the threads delegated from this one wait on (GET /threads/:id/crew-questions), as the Web UI shows them
// on the delegating thread (apps/web/src/components/thread/CrewQuestions.tsx): Ben answers them here instead of opening
// each crew thread. Each card answers its own thread's question, which returns to that thread's waiting call. Gone once
// answered here or there.
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { crewAsker, type CrewQuestion } from '@omni/shared/question.ts';
import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useLiveHub, useNeedsYou } from '../../live/react';
import type { RootStackParamList } from '../../navigation/types';
import { useFetched, useOnChange } from '../../review/useFetched';
import { fontSize, minTarget, space, useOmniTheme } from '../../theme';
import { Icon } from '../../ui/Icon';
import { Text } from '../../ui/Text';
import { QuestionCard } from './QuestionCard';

export function CrewQuestions({ threadId }: { threadId: string }) {
  const hub = useLiveHub();
  const { data, reload } = useFetched(`crew-questions:${threadId}`, (api) => api.crewQuestions(threadId));
  // Every ask and answer, here, on another client or synced from the other Mac, sends a needs_you message, even when
  // Needs you itself stays the same (an archived delegating thread is not listed there).
  useEffect(() => hub.watchFeed((m) => isNeedsYou(m) && reload()), [hub, reload]);
  // Needs you reloads after a feed reconnect, which watchFeed does not hear: missed messages land here.
  useOnChange(useNeedsYou(), reload);
  const items = data?.items ?? [];
  if (!items.length) return null;
  return (
    <View style={styles.stack} accessibilityLabel="Questions from delegated threads">
      {items.map((c) => (
        <CrewCard key={c.question.id} c={c} onAnswered={reload} />
      ))}
    </View>
  );
}

const isNeedsYou = (m: unknown) => typeof m === 'object' && m !== null && (m as { type?: unknown }).type === 'needs_you';

function CrewCard({ c, onAnswered }: { c: CrewQuestion; onAnswered: () => void }) {
  const { colors } = useOmniTheme();
  const hub = useLiveHub();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  return (
    <View style={styles.item}>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`Open thread: ${c.thread_title}`}
        onPress={() => navigation.push('Thread', { id: c.thread_id })}
        style={styles.asker}
      >
        <Icon name="message" size={13} color={colors.fg3} />
        <Text numberOfLines={1} style={[styles.askerText, { color: colors.fg3 }]}>{`${crewAsker(c)} asks`}</Text>
      </Pressable>
      <QuestionCard
        q={c.question}
        send={async (questionId, answers) => {
          const r = await hub.request((api) => api.answerQuestion(c.thread_id, questionId, answers));
          onAnswered();
          return r;
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: space.s8,
    paddingBottom: space.s6,
  },
  item: {
    gap: space.s2,
  },
  asker: {
    minHeight: minTarget,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: space.s3,
  },
  askerText: {
    fontSize: fontSize.meta,
    flexShrink: 1,
  },
});
