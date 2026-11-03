import { useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../ui/Text';
import { anyRunning, liveRun, SETUP_MODE_LABEL, type ActionRun, type ChannelAction } from '@omni/shared/channel-actions.ts';

import { StatusDot } from '../components/StatusDot';
import { Notice } from '../components/Notice';
import { actionDetail, outputCut, RUN_STATE_LABEL, runTone, runWhen } from '../live/actions-model';
import { useActionsLive, useActionsView } from '../live/react';
import type { RootScreenProps } from '../navigation/types';
import { Button } from '../ui/Button';
import { fontSize, minTarget, radius, space, useOmniTheme, weight } from '../theme';

const MONO = 'Menlo';

function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

/** The channel's named commands, run in this thread's checkout, and the thread's runs of them with their output. */
export function ActionsScreen({ route }: RootScreenProps<'Actions'>) {
  const { threadId } = route.params;
  const { colors } = useOmniTheme();
  const live = useActionsLive(threadId);
  const view = useActionsView(live);
  const data = view?.data ?? null;
  const now = useNow(anyRunning(data ?? undefined));

  if (!view || !live || !data) {
    return view?.error ? (
      <Notice title="Could not load actions" body={view.error} action={{ label: 'Try again', onPress: () => void live?.reload() }} />
    ) : (
      <Notice title="Loading actions" />
    );
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={false} onRefresh={() => void live.reload()} tintColor={colors.fg3} />}
    >
      <Text style={[styles.lede, { color: colors.fg3 }]}>Runs in this thread's checkout</Text>
      {view.error ? <Text style={[styles.error, { color: colors.fg2 }]}>{`Last refresh failed: ${view.error}`}</Text> : null}

      {data.actions.length > 0 ? (
        <View style={styles.section}>
          <Text accessibilityRole="header" style={[styles.heading, { color: colors.fg3 }]}>
            Actions
          </Text>
          {data.blocked ? <Text style={[styles.blocked, { color: colors.fg2, backgroundColor: colors.surface2 }]}>{data.blocked}</Text> : null}
          {data.actions.map((a) => {
            const running = liveRun(data, a);
            return (
              <View key={a.id} style={[styles.card, { backgroundColor: colors.surface }]}>
                <View style={styles.cardRow}>
                  <ActionLine action={a} />
                  {running ? (
                    <Button label="Stop" variant="secondary" busy={view.busy.has(running.id)} onPress={() => void live.stop(running)} />
                  ) : (
                    <Button label="Run" busy={view.busy.has(a.id)} disabled={!!data.blocked} onPress={() => void live.run(a)} accessibilityHint={`Runs ${a.name} in this thread`} />
                  )}
                </View>
                {view.errors[a.id] ? <Text style={[styles.error, { color: colors.fg2 }]}>{view.errors[a.id]}</Text> : null}
              </View>
            );
          })}
        </View>
      ) : (
        <View style={styles.empty}>
          <Text style={[styles.emptyTitle, { color: colors.fg }]}>No actions in this channel</Text>
          <Text style={[styles.emptyBody, { color: colors.fg3 }]}>
            Name the commands threads here can run, like a theme preview or the tests, in the channel's settings on the desktop.
          </Text>
        </View>
      )}

      {data.runs.length > 0 ? (
        <View style={styles.section}>
          <Text accessibilityRole="header" style={[styles.heading, { color: colors.fg3 }]}>
            {`Runs  ${data.runs.length}`}
          </Text>
          {data.runs.map((r, i) => (
            <RunCard
              key={r.id}
              run={r}
              latest={i === 0}
              setup={r.id === data.setup_run?.id}
              now={now}
              busy={view.busy.has(r.id)}
              error={view.errors[r.id]}
              blocked={!!data.blocked}
              onStop={() => void live.stop(r)}
              onRetry={() => void live.retry(r)}
            />
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

function ActionLine({ action }: { action: ChannelAction }) {
  const { colors } = useOmniTheme();
  return (
    <View style={styles.lineText}>
      <View style={styles.nameRow}>
        <Text numberOfLines={1} style={[styles.name, { color: colors.fg }]}>
          {action.name}
        </Text>
        {action.setup ? <Chip label="Setup" /> : null}
      </View>
      <Text numberOfLines={1} style={[styles.command, { color: colors.fg3 }]}>
        {action.command}
      </Text>
      <Text style={[styles.meta, { color: colors.fg4 }]}>{[actionDetail(action), action.setup && SETUP_MODE_LABEL[action.setup]].filter(Boolean).join(' · ')}</Text>
    </View>
  );
}

function Chip({ label }: { label: string }) {
  const { colors } = useOmniTheme();
  return <Text style={[styles.chip, { color: colors.fg3, borderColor: colors.lineStrong }]}>{label}</Text>;
}

interface RunCardProps {
  run: ActionRun;
  latest: boolean;
  setup: boolean;
  now: number;
  busy: boolean;
  error: string | undefined;
  blocked: boolean;
  onStop: () => void;
  onRetry: () => void;
}

function RunCard({ run, latest, setup, now, busy, error, blocked, onStop, onRetry }: RunCardProps) {
  const { colors } = useOmniTheme();
  const [open, setOpen] = useState(latest);
  const running = run.state === 'running';
  const cut = outputCut(run);
  return (
    <View style={[styles.card, { backgroundColor: colors.surface }]}>
      <View style={styles.cardRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${run.name}, ${RUN_STATE_LABEL[run.state]}`}
          accessibilityState={{ expanded: open }}
          onPress={() => setOpen((o) => !o)}
          style={styles.lineText}
        >
          <View style={styles.nameRow}>
            <Text style={[styles.chevron, { color: colors.fg4, transform: [{ rotate: open ? '90deg' : '0deg' }] }]}>›</Text>
            <StatusDot tone={runTone(run.state)} />
            <Text numberOfLines={1} style={[styles.name, { color: colors.fg }]}>
              {run.name}
            </Text>
            {setup ? <Chip label="Setup" /> : null}
          </View>
          <Text style={[styles.meta, { color: colors.fg3 }]}>{[RUN_STATE_LABEL[run.state], runWhen(run, now)].filter(Boolean).join(' · ')}</Text>
        </Pressable>
        {running ? (
          <Button label="Stop" variant="secondary" busy={busy} onPress={onStop} />
        ) : run.action_id ? (
          <Button label="Retry" variant="secondary" busy={busy} disabled={blocked} onPress={onRetry} />
        ) : null}
      </View>
      {run.error ? <Text style={[styles.error, { color: colors.fg2 }]}>{run.error}</Text> : null}
      {error ? <Text style={[styles.error, { color: colors.fg2 }]}>{error}</Text> : null}
      {open ? (
        <View>
          {cut ? <Text style={[styles.meta, { color: colors.fg4, paddingBottom: space.s2 }]}>{cut}</Text> : null}
          <ScrollView nestedScrollEnabled style={[styles.output, { backgroundColor: colors.surface2 }]}>
            <Text selectable style={[styles.outputText, { color: run.output ? colors.fg2 : colors.fg4 }]}>
              {run.output || (running ? 'Waiting for output' : 'No output')}
            </Text>
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: space.s9,
    paddingBottom: space.s11,
    gap: space.s4,
  },
  lede: {
    fontSize: fontSize.meta,
    paddingTop: space.s2,
  },
  section: {
    gap: space.s4,
  },
  heading: {
    fontSize: fontSize.meta,
    fontWeight: weight.semibold,
    textTransform: 'uppercase',
    paddingTop: space.s9,
  },
  blocked: {
    fontSize: fontSize.body - 1,
    lineHeight: 19,
    padding: space.s6,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  card: {
    borderRadius: radius.md,
    padding: space.s6,
    gap: space.s4,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s6,
  },
  lineText: {
    flex: 1,
    minHeight: minTarget,
    justifyContent: 'center',
    gap: 2,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s4,
  },
  name: {
    flexShrink: 1,
    fontSize: fontSize.body + 1,
    fontWeight: weight.semibold,
  },
  command: {
    fontFamily: MONO,
    fontSize: fontSize.meta + 1,
  },
  meta: {
    fontSize: fontSize.meta,
  },
  chevron: {
    width: 12,
    fontSize: fontSize.body + 4,
    lineHeight: 20,
    textAlign: 'center',
  },
  chip: {
    fontSize: fontSize.meta - 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 1,
    overflow: 'hidden',
  },
  error: {
    fontSize: fontSize.meta + 1,
    lineHeight: 16,
  },
  output: {
    maxHeight: 260,
    borderRadius: radius.md - 4,
  },
  outputText: {
    fontFamily: MONO,
    fontSize: fontSize.meta + 1,
    lineHeight: 17,
    padding: space.s6,
  },
  empty: {
    paddingTop: space.s11,
    gap: space.s4,
  },
  emptyTitle: {
    fontSize: fontSize.heading,
    fontWeight: weight.semibold,
  },
  emptyBody: {
    fontSize: fontSize.body,
  },
});
