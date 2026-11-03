import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '../../ui/Text';

import type { PendingMsg, Thread } from '@omni/client-core';

import type { NeedsAction } from '../../needs/actions';
import { threadCards, type CardButton, type ThreadCard } from '../../needs/thread-cards';
import { fontSize, lineHeight, radius, space, useOmniTheme, weight } from '../../theme';
import { Button } from '../../ui/Button';
import { ErrorNote } from './QuestionCard';

/**
 * What holds a thread up and what Ben can do about it: a worktree that did not set up, a usage limit, and messages
 * the server parked on a restart. One button runs at a time, so a second tap cannot double a recovery call.
 */
export function NeedsCards({
  thread,
  pending,
  blocked,
  act,
}: {
  thread: Thread;
  pending: PendingMsg[];
  blocked: boolean;
  act: (action: NeedsAction) => Promise<void>;
}) {
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cards = threadCards({ thread, pending, blocked, now: Date.now() });
  if (cards.length === 0) return null;

  const run = async (button: CardButton) => {
    if (running) return;
    setRunning(button.key);
    setError(null);
    try {
      await act(button.action);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'Something went wrong');
    } finally {
      setRunning(null);
    }
  };

  return (
    <View style={styles.stack}>
      {cards.map((card) => (
        <Card key={card.kind} card={card} running={running} run={run} />
      ))}
      {error ? <ErrorNote message={error} /> : null}
    </View>
  );
}

function Card({ card, running, run }: { card: ThreadCard; running: string | null; run: (b: CardButton) => void }) {
  const { colors } = useOmniTheme();
  const title = card.kind === 'parked' ? card.heading : card.title;
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.line }]}>
      <Text style={[styles.title, { color: colors.fg }]}>{title}</Text>
      {card.kind !== 'parked' ? <Text style={[styles.body, { color: colors.fg2 }]}>{card.body}</Text> : null}
      {card.kind === 'setup' && card.detail ? (
        <Text selectable numberOfLines={6} style={[styles.detail, { color: colors.fg3 }]}>
          {card.detail}
        </Text>
      ) : null}
      {card.kind === 'setup' && card.branch ? (
        <Text style={[styles.meta, { color: colors.fg3 }]}>{card.branch}</Text>
      ) : null}
      {card.kind === 'parked'
        ? card.rows.map((row) => (
            <View key={row.uuid} style={[styles.row, { backgroundColor: colors.surface2 }]}>
              <Text style={[styles.meta, { color: colors.fg3 }]}>{row.label}</Text>
              <Text numberOfLines={3} style={[styles.body, { color: colors.fg }]}>
                {row.text}
              </Text>
              <Buttons buttons={row.buttons} running={running} run={run} />
            </View>
          ))
        : null}
      <Buttons buttons={card.buttons} running={running} run={run} />
    </View>
  );
}

function Buttons({
  buttons,
  running,
  run,
}: {
  buttons: CardButton[];
  running: string | null;
  run: (b: CardButton) => void;
}) {
  if (buttons.length === 0) return null;
  return (
    <View style={styles.actions}>
      {buttons.map((b) => (
        <Button
          key={b.key}
          label={b.label}
          variant={b.primary ? 'primary' : 'secondary'}
          busy={running === b.key}
          disabled={running !== null && running !== b.key}
          onPress={() => run(b)}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: space.s4,
    paddingBottom: space.s6,
  },
  card: {
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.s8,
    gap: space.s6,
  },
  title: {
    fontSize: fontSize.input,
    fontWeight: weight.semibold,
  },
  body: {
    fontSize: fontSize.body,
    lineHeight: Math.round(fontSize.body * lineHeight.body),
  },
  detail: {
    fontSize: fontSize.meta,
    fontFamily: 'Menlo',
  },
  meta: {
    fontSize: fontSize.meta,
  },
  row: {
    borderRadius: radius.md,
    padding: space.s6,
    gap: space.s2,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.s4,
  },
});
