import { LinkBrand } from '../ui/Brand';
import { FIX_CONFLICTS_PROMPT, OPEN_PR_PROMPT, stepParkedText, type PRStep } from '@omni/shared/thread-glance.ts';
import { watchCopy } from '@omni/shared/pr-watch.ts';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../ui/Text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HeaderButton } from '../components/HeaderButton';
import { Notice } from '../components/Notice';
import { useThreadLive, useThreadView } from '../live/react';
import type { RootScreenProps } from '../navigation/types';
import { MERGE_ADVICE, prContent, type PRContent } from '../pr/model';
import { useMerge, usePRWatch, useThreadPR } from '../pr/hooks';
import type { MergeOutcome } from '../pr/actions';
import { CheckDot } from '../pr/CheckDot';
import { stepWorking } from '../pr/step';
import { usePRStep } from '../pr/use-step';
import { CrewPRList } from '../pr/CrewPRs';
import { AutoMergeRow } from '../pr/AutoMerge';
import { DiffCount, Loading, Section } from '../review/parts';
import { Chip } from '../ui/Chip';
import { fontSize, lineHeight, minTarget, mono, space, useOmniTheme, weight } from '../theme';
import { Button } from '../ui/Button';
import { GroupedList, ListRow } from '../ui/GroupedList';
import { Callout } from '../ui/Callout';
import { SlideToConfirm } from '../ui/SlideToConfirm';

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

export function PullRequestScreen({ route, navigation }: RootScreenProps<'PullRequest'>) {
  const { id } = route.params;
  const { colors } = useOmniTheme();
  const live = useThreadLive(id);
  const view = useThreadView(live);
  const thread = view?.thread ?? null;
  const [picked, setPicked] = useState<string | null>(null);
  const pr = useThreadPR(thread, picked);
  // A delegated thread's PR is watched from that thread, so the watch here is for this thread's own PR only.
  const watch = usePRWatch(id, pr.number !== null && !pr.from, pr.page.kind === 'pr' && !pr.from ? pr.page.pr : null);
  const merge = useMerge(pr.channelId, pr.number, pr.refresh);
  const [asked, setAsked] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<MergeOutcome | null>(null);
  const insets = useSafeAreaInsets();

  const page = pr.page;
  const content = page.kind === 'pr' ? prContent(page.pr) : null;
  const url = content?.url;
  const crewOnly = page.kind === 'empty' && !thread?.branch && page.crew.length > 0;
  useEffect(() => {
    navigation.setOptions({
      title: content ? `#${content.number}` : crewOnly ? 'Delegated PRs' : 'Pull request',
      headerRight: url ? () => <HeaderButton label="GitHub" accessibilityLabel="Open on GitHub" onPress={() => void Linking.openURL(url)} /> : undefined,
    });
  }, [navigation, content?.number, url, crewOnly]);

  const step = usePRStep(live, view);
  const ask = useCallback(
    async (prompt: string) => {
      setAsked(null);
      const out = await step.ask(prompt);
      if (out.kind === 'sent') navigation.goBack();
      else setAsked(out.kind === 'busy' ? 'Another message is still sending. Try again in a moment.' : out.message);
    },
    [step.ask, navigation],
  );
  // A step's button reads as working while the agent is on it, and a step that never reached the agent says why.
  const stepButton = (kind: PRStep, label: string) => ({ label: stepWorking(step.working, kind) ?? label, busy: step.working === kind });
  const parkedNote = (kind: PRStep) => (step.parked?.step === kind && thread ? stepParkedText(kind, thread) : null);

  const from = pr.from;
  const openCrew = useCallback((p: { url: string }) => {
    setOutcome(null);
    setPicked(p.url);
  }, []);
  const slide = useCallback(async () => {
    setOutcome(null);
    // Keep the PR on screen once merged, though the first open one would move on to the next.
    if (from) setPicked(from.url);
    const out = await merge();
    setOutcome(out.kind === 'merged' ? null : out);
    return out.kind === 'merged';
  }, [merge, from]);

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
      <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={[styles.empty, { paddingBottom: Math.max(insets.bottom, space.s9) }]}>
        {page.text ? (
          <>
            <Text style={[styles.emptyTitle, { color: colors.fg }]}>Pull request</Text>
            <Text style={[styles.emptyBody, { color: colors.fg3 }]}>{page.text}</Text>
          </>
        ) : null}
        {page.canOpen ? (
          <Button {...stepButton('open', 'Open PR')} disabled={step.working !== null} accessibilityHint="Asks the agent to push the branch and open a pull request" onPress={() => void ask(OPEN_PR_PROMPT)} />
        ) : null}
        {parkedNote('open') ? <Text style={[styles.meta, { color: colors.fg3 }]}>{parkedNote('open')}</Text> : null}
        {asked ? <Text style={[styles.meta, { color: colors.fg3 }]}>{asked}</Text> : null}
        {page.crew.length > 0 ? <CrewPRList crew={page.crew} shown={null} onOpen={openCrew} /> : null}
      </ScrollView>
    );
  }

  const c = content as PRContent;
  const { action, line } = watchCopy(watch.watch);
  const canWatch = !from && (c.open || watch.watching);
  // The fix prompts go to this thread, so a delegated thread's PR has none here: its row opens that thread instead.
  const fix = !from && (c.next?.kind === 'conflicts' || c.next?.kind === 'checks') ? c.next : null;
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
          {pr.githubRepo ? <View style={styles.row}><LinkBrand brand="github" /><Text style={[styles.meta, { color: colors.fg3 }]}>{pr.githubRepo}</Text></View> : null}
          <Text style={[styles.status, { color: c.status.tone === 'needs' ? colors.needs : colors.fg2 }]}>{c.status.text}</Text>
          {fix ? (
            <View style={styles.inline}>
              <Button variant="secondary" {...stepButton(fix.kind, fix.label)} disabled={step.working !== null} onPress={() => void ask(fix.prompt)} />
            </View>
          ) : null}
          {fix && parkedNote(fix.kind) ? <Text style={[styles.meta, { color: colors.fg3 }]}>{parkedNote(fix.kind)}</Text> : null}
          {asked ? <Text style={[styles.meta, { color: colors.fg3 }]}>{asked}</Text> : null}
        </View>

        {from ? (
          <GroupedList>
            <ListRow
              first
              icon="message"
              title={from.thread_title || 'Untitled'}
              detail="The delegated thread that opened it"
              chevron
              onPress={() => navigation.push('Thread', { id: from.thread_id })}
            />
          </GroupedList>
        ) : null}

        {!from && (canWatch || watch.watch) ? (
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

        {c.open && page.kind === 'pr' ? <AutoMergeRow channelId={pr.channelId} number={c.number} request={page.pr.autoMergeRequest} draft={!c.canMerge} reload={pr.refresh} /> : null}

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
                  <Text style={{ color: colors.fg, fontWeight: weight.semibold }}>{l.login}</Text> {l.excerpt}
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

        {page.crew.length > 0 ? <CrewPRList crew={page.crew} shown={from?.url ?? null} onOpen={openCrew} /> : null}
      </ScrollView>

      {c.open ? (
        <View style={[styles.merge, { paddingBottom: Math.max(insets.bottom, space.s8), borderTopColor: colors.line }]}>
          {c.note ? <Text style={[styles.note, { color: colors.fg3 }]}>{c.note}</Text> : null}
          {outcome ? <MergeOutcomeNote outcome={outcome} onAsk={from ? undefined : ask} /> : null}
          <SlideToConfirm label="Slide to squash and merge" doneLabel={`Merged #${c.number}`} busyLabel="Merging" disabled={!c.canMerge} onConfirm={slide} />
          {!c.canMerge ? <Text style={[styles.note, { color: colors.fg3 }]}>A draft cannot be merged. Mark it ready for review on GitHub.</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

/** `onAsk` is left out for a delegated thread's PR: Fix conflicts would ask this thread, not the one on the PR's branch. */
function MergeOutcomeNote({ outcome, onAsk }: { outcome: MergeOutcome; onAsk?: (prompt: string) => Promise<void> }) {
  const { colors } = useOmniTheme();
  if (outcome.kind === 'merged') return null;
  if (outcome.kind === 'refused') {
    const { failure } = outcome;
    return (
      <Callout message={failure.title}>
        <Text style={[styles.meta, { color: colors.fg2 }]}>{failure.detail}</Text>
        <Text style={[styles.meta, { color: colors.fg3 }]}>{MERGE_ADVICE[failure.kind]}</Text>
        {failure.kind === 'conflict' && onAsk ? <Button variant="secondary" label="Fix conflicts" onPress={() => void onAsk(FIX_CONFLICTS_PROMPT)} /> : null}
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
    fontWeight: weight.medium,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space.s4,
  },
  meta: {
    fontSize: fontSize.caption,
    lineHeight: Math.round(fontSize.caption * lineHeight.body),
  },
  branches: {
    fontFamily: mono,
    fontSize: fontSize.caption,
  },
  status: {
    fontSize: fontSize.body,
    fontWeight: weight.medium,
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
    gap: space.s1,
  },
  rowLabel: {
    fontSize: fontSize.body,
    fontWeight: weight.medium,
  },
  reviews: {
    padding: space.s8,
    gap: space.s2,
  },
  excerpt: {
    fontSize: fontSize.ui,
    lineHeight: Math.round(fontSize.ui * lineHeight.body),
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
    fontSize: fontSize.ui,
  },
  merge: {
    gap: space.s4,
    paddingHorizontal: space.s9,
    paddingTop: space.s4,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  note: {
    fontSize: fontSize.caption,
    lineHeight: Math.round(fontSize.caption * lineHeight.body),
    textAlign: 'center',
  },
  empty: {
    paddingHorizontal: space.s9,
    paddingTop: space.s11,
    gap: space.s6,
  },
  emptyTitle: {
    fontSize: fontSize.heading,
    fontWeight: weight.semibold,
  },
  emptyBody: {
    fontSize: fontSize.body,
  },
});
