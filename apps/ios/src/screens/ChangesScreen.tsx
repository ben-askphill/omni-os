import type { Thread, TurnView } from '@omni/client-core';
import { baseLabel, headMove, shortSha, TURN_NOTE, turnStateNote, turnTitle } from '@omni/shared/changes-view.ts';
import { useHeaderHeight } from '@react-navigation/elements';
import { useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '../ui/Text';

import { Notice } from '../components/Notice';
import { DiffPane } from '../changes/DiffPane';
import { useBranchChanges, useTurnChanges } from '../changes/hooks';
import { useThreadLive, useThreadView } from '../live/react';
import type { RootScreenProps } from '../navigation/types';
import { DiffCount, Loading } from '../review/parts';
import { fontSize, lineHeight, mono, space, useOmniTheme, weight } from '../theme';
import { SegmentedControl } from '../ui/SegmentedControl';

type Mode = 'base' | 'turn';

const MODES = [
  { value: 'base', label: 'Since base' },
  { value: 'turn', label: 'This turn' },
] as const;

const EMPTY_TURN: Partial<Record<TurnView['state'], string>> = { running: 'This turn is running', capturing: 'Saving this turn', failed: 'Could not save this turn' };

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;
const PICK_HINT = 'Tap a line to pick it. Tap another line in the same hunk to extend the pick.';

export function ChangesScreen({ route, navigation }: RootScreenProps<'Changes'>) {
  const { id } = route.params;
  const { colors } = useOmniTheme();
  const live = useThreadLive(id);
  const view = useThreadView(live);
  const [mode, setMode] = useState<Mode>('base');
  const thread = view?.thread ?? null;

  if (!view || view.status === 'loading') return <Notice title="Loading thread" />;
  if (view.status === 'missing' || !thread) return <Notice title="Thread not found" body="It may have been archived or removed on the server." />;

  const back = () => navigation.goBack();
  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <View style={styles.modes}>
        <SegmentedControl options={MODES} value={mode} onChange={setMode} />
      </View>
      {mode === 'base' ? <BasePane thread={thread} onAdded={back} /> : <TurnPane thread={thread} onAdded={back} />}
    </View>
  );
}

interface PaneProps {
  thread: Thread;
  onAdded: () => void;
}

function BasePane({ thread, onAdded }: PaneProps) {
  const headerOffset = useHeaderHeight();
  const q = useBranchChanges(thread.id, thread.status, true);
  const { data, view } = q;

  if (!data) {
    if (q.failure) return <Notice title="Could not load the changes" body={q.failure.message} action={q.failure.retryable ? { label: 'Try again', onPress: q.reload } : undefined} />;
    return <Loading label="Loading changes" />;
  }
  if (!data.available) return <Message title="No changes to show" body={data.reason} />;
  if (!view) return <Loading label="Loading changes" />;

  const base = data.base;
  return (
    <DiffPane
      threadId={thread.id}
      scope="base"
      groups={view.groups}
      total={view.files}
      empty={{ title: 'No changes', body: `Nothing changed since ${shortSha(base.sha)}: no commits, staged, unstaged or untracked files.` }}
      source={{ from: base.sha, to: data.head, turn: null }}
      refreshing={q.loading}
      onRefresh={q.reload}
      onAdded={onAdded}
      headerOffset={headerOffset}
      header={
        <Summary
          lines={[
            <Text key="base">
              Base <Text style={styles.sha}>{shortSha(base.sha)}</Text>, {baseLabel(base)}
            </Text>,
            view.files > 0 ? (
              <Text key="n">
                {plural(view.files, 'file')} <DiffCount add={view.additions} del={view.deletions} />
                {data.branch ? <Text style={styles.sha}> on {data.branch}</Text> : null}
              </Text>
            ) : null,
          ]}
          failure={q.failure?.message ?? null}
          hint={view.files > 0}
        />
      }
    />
  );
}

function TurnPane({ thread, onAdded }: PaneProps) {
  const headerOffset = useHeaderHeight();
  const q = useTurnChanges(thread.id, thread.status, true);
  const { data, view } = q;

  if (!data) {
    if (q.failure) return <Notice title="Could not load this turn" body={q.failure.message} action={q.failure.retryable ? { label: 'Try again', onPress: q.reload } : undefined} />;
    return <Loading label="Loading this turn" />;
  }
  if (!data.available || !view) {
    return <Message title={data.available ? 'No turns saved yet' : 'No turns to show'} body={data.reason ?? "Each turn's changes are saved here when it ends."} />;
  }

  const { turn } = view;
  const note = turnStateNote(turn);
  const moved = headMove(turn);
  return (
    <DiffPane
      threadId={thread.id}
      scope={turn.id}
      groups={view.groups}
      total={view.files}
      empty={{ title: EMPTY_TURN[turn.state] ?? 'No changes', body: note ?? 'Nothing in the worktree changed during this turn.' }}
      source={turn.before && turn.after ? { from: turn.before.sha, to: turn.after.sha, turn: turn.id } : null}
      refreshing={q.loading}
      onRefresh={q.reload}
      onAdded={onAdded}
      headerOffset={headerOffset}
      header={
        <Summary
          lines={[
            <Text key="t">{turnTitle(turn)}</Text>,
            turn.state === 'ready' ? (
              view.files ? (
                <Text key="n">
                  {plural(view.files, 'file')} <DiffCount add={view.additions} del={view.deletions} />
                  {moved ? <Text style={styles.sha}> · HEAD {moved}</Text> : null}
                </Text>
              ) : (
                <Text key="n">No files changed</Text>
              )
            ) : null,
          ]}
          failure={q.failure?.message ?? null}
          hint={view.files > 0}
          footnote={TURN_NOTE}
        />
      }
    />
  );
}

function Summary({ lines, failure, hint, footnote }: { lines: ReactNode[]; failure: string | null; hint: boolean; footnote?: string }) {
  const { colors } = useOmniTheme();
  return (
    <View style={styles.summary}>
      {lines.filter(Boolean).map((line, i) => (
        <Text key={i} style={[styles.summaryLine, { color: i === 0 ? colors.fg2 : colors.fg3 }]}>
          {line}
        </Text>
      ))}
      {footnote ? <Text style={[styles.footnote, { color: colors.fg4 }]}>{footnote}</Text> : null}
      {failure ? (
        <Text accessibilityRole="alert" style={[styles.footnote, { color: colors.needs }]}>
          Could not refresh: {failure}
        </Text>
      ) : null}
      {hint ? <Text style={[styles.footnote, { color: colors.fg4 }]}>{PICK_HINT}</Text> : null}
    </View>
  );
}

function Message({ title, body }: { title: string; body: string }) {
  const { colors } = useOmniTheme();
  return (
    <View style={styles.message}>
      <Text style={[styles.messageTitle, { color: colors.fg }]}>{title}</Text>
      <Text style={[styles.messageBody, { color: colors.fg3 }]}>{body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  modes: {
    paddingHorizontal: space.s8,
    paddingBottom: space.s4,
  },
  summary: {
    paddingHorizontal: space.s8,
    paddingBottom: space.s4,
    gap: 2,
  },
  summaryLine: {
    fontSize: fontSize.body,
    fontVariant: ['tabular-nums'],
  },
  sha: {
    fontFamily: mono,
    fontSize: fontSize.meta + 1,
  },
  footnote: {
    fontSize: fontSize.meta + 1,
    lineHeight: Math.round((fontSize.meta + 1) * lineHeight.body),
  },
  message: {
    paddingHorizontal: space.s9,
    paddingTop: space.s10,
    gap: space.s4,
  },
  messageTitle: {
    fontSize: fontSize.heading,
    fontWeight: weight.semibold,
  },
  messageBody: {
    fontSize: fontSize.body,
    lineHeight: Math.round(fontSize.body * lineHeight.body),
  },
});
