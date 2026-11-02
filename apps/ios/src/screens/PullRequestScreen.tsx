import { FIX_CONFLICTS_PROMPT, OPEN_PR_PROMPT } from '@omni/shared/thread-glance.ts';
import { watchCopy } from '@omni/shared/pr-watch.ts';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HeaderButton } from '../components/HeaderButton';
import { Notice } from '../components/Notice';
import { useThreadLive, useThreadView } from '../live/react';
import type { RootScreenProps } from '../navigation/types';
import { MERGE_ADVICE, prContent, type PRContent } from '../pr/model';
import { useMerge, usePRWatch, useThreadPR } from '../pr/hooks';
import type { MergeOutcome } from '../pr/actions';
import { CheckDot } from '../pr/CheckDot';
import { Chip, DiffCount, Loading, Section } from '../review/parts';
import { fontSize, lineHeight, minTarget, mono, space, useOmniTheme } from '../theme';
import { Button } from '../ui/Button';
import { Callout } from '../ui/Callout';
import { SlideToConfirm } from '../ui/SlideToConfirm';

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

export function PullRequestScreen({ route, navigation }: RootScreenProps<'PullRequest'>) {
  const { id } = route.params;
  const { colors } = useOmniTheme();
  const live = useThreadLive(id);
  const view = useThreadView(live);
  const thread = view?.thread ?? null;
  const pr = useThreadPR(thread);
  const watch = usePRWatch(id, pr.number !== null, pr.page.kind === 'pr' ? pr.page.pr : null);
  const merge = useMerge(pr.channelId, pr.number, pr.reloadDetail);
  const [asked, setAsked] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<MergeOutcome | null>(null);
  const insets = useSafeAreaInsets();

  const page = pr.page;
  const content = page.kind === 'pr' ? prContent(page.pr) : null;
  const url = content?.url;
  useEffect(() => {
    navigation.setOptions({
      title: content ? `#${content.number}` : 'Pull request',
      headerRight: url ? () => <HeaderButton label="GitHub" accessibilityLabel="Open on GitHub" onPress={() => void Linking.openURL(url)} /> : undefined,
    });
  }, [navigation, content?.number, url]);

  const ask = useCallback(
    async (prompt: string) => {
      if (!live || !thread) return;
      setAsked(null);
      if (live.send.state.get().outbox.item) return setAsked('Another message is still sending. Try again in a moment.');
      const sent = await live.send.submit(thread, prompt);
      if (sent) navigation.goBack();
      else setAsked(live.send.state.get().outbox.item?.phase === 'failed' ? 'The message did not send. It is kept in the thread.' : 'Could not send the message.');
    },
    [live, thread, navigation],
  );

  const slide = useCallback(async () => {
    setOutcome(null);
    const out = await merge();
    setOutcome(out.kind === 'merged' ? null : out);
    return out.kind === 'merged';
  }, [merge]);

  if (!view || view.status === 'loading') return <Notice title="Loading thread" />;
  if (view.status === 'missing') return <Notice title="Thread not found" body="It may have been archived or removed on the server." />;
  if (page.kind === 'loading') return <Loading label="Loading pull request" />;
  if (page.kind === 'failed') {
    return (
      <Notice
        title={page.of === 'list' ? 'Could not look for a pull request' : 'Could not load the pull request'}
        body={page.failure.message}
        action={page.failure.retryable ? { label: 'Try again', onPress: page.of === 'list' ? pr.reloadList : pr.reloadDetail } : undefined}
      />
    );
  }
  if (page.kind === 'empty') {
    return (
      <View style={[styles.screen, styles.empty, { backgroundColor: colors.bg }]}>
        <Text style={[styles.emptyTitle, { color: colors.fg }]}>Pull request</Text>
        <Text style={[styles.emptyBody, { color: colors.fg3 }]}>{page.text}</Text>
        {page.canOpen ? <Button label="Open PR" accessibilityHint="Asks the agent to push the branch and open a pull request" onPress={() => void ask(OPEN_PR_PROMPT)} /> : null}
        {asked ? <Text style={[styles.meta, { color: colors.fg3 }]}>{asked}</Text> : null}
      </View>
    );
  }

  const c = content as PRContent;
  const { action, line } = watchCopy(watch.watch);
  const canWatch = c.open || watch.watching;
  const fix = c.next?.kind === 'conflicts' || c.next?.kind === 'checks' ? c.next : null;
  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.head}>
          <Text selectable style={[styles.title, { color: colors.fg }]}>
            {c.title}
          </Text>
          <View style={styles.row}>
            <Chip label={c.badge.label} tone={c.badge.tone} />
            <DiffCount add={c.additions} del={c.deletions} />
            <Text style={[styles.meta, { color: colors.fg3 }]}>· {plural(c.files.length, 'file')}</Text>
          </View>
          <Text style={[styles.branches, { color: colors.fg3 }]}>{c.branches}</Text>
          {pr.githubRepo ? <Text style={[styles.meta, { color: colors.fg3 }]}>{pr.githubRepo}</Text> : null}
          <Text style={[styles.status, { color: c.status.tone === 'needs' ? colors.needs : colors.fg2 }]}>{c.status.text}</Text>
          {fix ? (
            <View style={styles.inline}>
              <Button variant="secondary" label={fix.label} onPress={() => void ask(fix.prompt)} />
            </View>
          ) : null}
          {asked ? <Text style={[styles.meta, { color: colors.fg3 }]}>{asked}</Text> : null}
        </View>

        {canWatch || watch.watch ? (
          <View style={styles.block}>
            <Section title="Watch">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={canWatch ? action : line}
                accessibilityHint={canWatch ? line : undefined}
                accessibilityState={{ disabled: !canWatch || watch.busy, busy: watch.busy }}
                disabled={!canWatch || watch.busy}
                onPress={() => void (watch.watching ? watch.stop() : watch.start())}
                style={({ pressed }) => [styles.watch, { opacity: watch.busy ? 0.6 : 1, backgroundColor: pressed ? colors.surface2 : 'transparent' }]}
              >
                <View style={[styles.watchDot, watch.watching ? { backgroundColor: colors.live } : { borderColor: colors.fg4, borderWidth: 2 }]} />
                <View style={styles.watchText}>
                  <Text style={[styles.rowLabel, { color: colors.fg }]}>{canWatch ? action : line}</Text>
                  {canWatch ? <Text style={[styles.meta, { color: colors.fg3 }]}>{line}</Text> : null}
                </View>
                {watch.busy ? <ActivityIndicator size="small" color={colors.fg3} /> : null}
              </Pressable>
            </Section>
            {watch.error ? <Callout message={watch.error} /> : null}
          </View>
        ) : null}

        {c.review.reviewers.length > 0 || c.reviewLine ? (
          <Section title="Reviews">
            <View style={styles.reviews}>
              {c.reviewLine ? <Text style={[styles.rowLabel, { color: colors.fg }]}>{c.reviewLine}</Text> : null}
              {c.review.reviewers.map((r) => (
                <Text key={r.login} style={[styles.meta, { color: colors.fg2 }]}>
                  {r.login} {r.verdict === 'approved' ? 'approved' : r.verdict === 'changes' ? 'requested changes' : 'commented'}
                </Text>
              ))}
              {c.review.latest.map((l, i) => (
                <Text key={`${l.login}:${i}`} style={[styles.excerpt, { color: colors.fg2, borderColor: colors.lineStrong }]}>
                  <Text style={{ color: colors.fg, fontWeight: '600' }}>{l.login}</Text> {l.excerpt}
                </Text>
              ))}
            </View>
          </Section>
        ) : null}

        {c.checks.length > 0 ? (
          <Section title="Checks" count={c.checks.length}>
            {c.checks.map((k, i) => (
              <View key={k.key} style={[styles.checkRow, i > 0 && { borderTopColor: colors.line, borderTopWidth: StyleSheet.hairlineWidth }]}>
                <CheckDot tone={k.tone} />
                <Text numberOfLines={1} style={[styles.rowLabel, styles.grow, { color: colors.fg }]}>
                  {k.name}
                </Text>
                <Text style={[styles.meta, { color: k.tone === 'needs' ? colors.needs : colors.fg3 }]}>{k.state}</Text>
              </View>
            ))}
          </Section>
        ) : null}

        <Section title="Files" count={c.files.length}>
          {c.files.map((f, i) => (
            <View key={f.path} style={[styles.checkRow, i > 0 && { borderTopColor: colors.line, borderTopWidth: StyleSheet.hairlineWidth }]}>
              <Text numberOfLines={1} ellipsizeMode="middle" style={[styles.path, styles.grow, { color: colors.fg }]}>
                {f.path}
              </Text>
              <DiffCount add={f.additions} del={f.deletions} />
            </View>
          ))}
        </Section>
      </ScrollView>

      {c.open ? (
        <View style={[styles.merge, { paddingBottom: Math.max(insets.bottom, space.s8), borderTopColor: colors.line }]}>
          {c.note ? <Text style={[styles.note, { color: colors.fg3 }]}>{c.note}</Text> : null}
          {outcome ? <MergeOutcomeNote outcome={outcome} onAsk={ask} /> : null}
          <SlideToConfirm label="Slide to squash and merge" doneLabel={`Merged #${c.number}`} busyLabel="Merging" disabled={!c.canMerge} onConfirm={slide} />
          {!c.canMerge ? <Text style={[styles.note, { color: colors.fg3 }]}>A draft cannot be merged. Mark it ready for review on GitHub.</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

function MergeOutcomeNote({ outcome, onAsk }: { outcome: MergeOutcome; onAsk: (prompt: string) => Promise<void> }) {
  const { colors } = useOmniTheme();
  if (outcome.kind === 'merged') return null;
  if (outcome.kind === 'refused') {
    const { failure } = outcome;
    return (
      <Callout message={failure.title}>
        <Text style={[styles.meta, { color: colors.fg2 }]}>{failure.detail}</Text>
        <Text style={[styles.meta, { color: colors.fg3 }]}>{MERGE_ADVICE[failure.kind]}</Text>
        {failure.kind === 'conflict' ? <Button variant="secondary" label="Fix conflicts" onPress={() => void onAsk(FIX_CONFLICTS_PROMPT)} /> : null}
      </Callout>
    );
  }
  return <Callout message={outcome.message} />;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  body: {
    padding: space.s9,
    gap: space.s9,
  },
  head: {
    gap: space.s4,
  },
  title: {
    fontSize: 22,
    lineHeight: Math.round(22 * lineHeight.heading),
    fontWeight: '500',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space.s4,
  },
  meta: {
    fontSize: fontSize.meta + 1,
    lineHeight: Math.round((fontSize.meta + 1) * lineHeight.body),
  },
  branches: {
    fontFamily: mono,
    fontSize: fontSize.meta + 1,
  },
  status: {
    fontSize: fontSize.body,
    fontWeight: '500',
  },
  inline: {
    alignSelf: 'flex-start',
  },
  block: {
    gap: space.s4,
  },
  watch: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s6,
    minHeight: minTarget,
    paddingHorizontal: space.s8,
    paddingVertical: space.s4,
  },
  watchDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  watchText: {
    flex: 1,
    gap: 2,
  },
  rowLabel: {
    fontSize: fontSize.body,
    fontWeight: '500',
  },
  reviews: {
    padding: space.s8,
    gap: space.s2,
  },
  excerpt: {
    fontSize: fontSize.body - 1,
    lineHeight: Math.round((fontSize.body - 1) * lineHeight.body),
    borderLeftWidth: 2,
    paddingLeft: space.s4,
    marginTop: space.s2,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s6,
    minHeight: minTarget,
    paddingHorizontal: space.s8,
    paddingVertical: space.s4,
  },
  grow: {
    flex: 1,
  },
  path: {
    fontFamily: mono,
    fontSize: fontSize.body - 1,
  },
  merge: {
    gap: space.s4,
    paddingHorizontal: space.s9,
    paddingTop: space.s4,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  note: {
    fontSize: fontSize.meta + 1,
    lineHeight: Math.round((fontSize.meta + 1) * lineHeight.body),
    textAlign: 'center',
  },
  empty: {
    paddingHorizontal: space.s9,
    paddingTop: space.s11,
    gap: space.s6,
  },
  emptyTitle: {
    fontSize: fontSize.heading,
    fontWeight: '600',
  },
  emptyBody: {
    fontSize: fontSize.body,
  },
});
