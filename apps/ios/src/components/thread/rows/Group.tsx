// The rows a group thread adds (ADR 0019, ADR 0020): who wrote a reply, a lane per tab for a message several agents
// answered, the files a lane changed, collision flags, join and leave lines, and the lock line under a remote agent's
// reply. The rows come from thread/rows.ts; phone web draws the same (apps/web/src/mobile/ThreadTurn.tsx).
import { clock, toDate } from '@omni/shared/format.ts';
import { remoteLockLine } from '@omni/shared/remote-agent.ts';
import { glyphFor, markOf } from '@omni/shared/status.ts';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { useAgents, useTechnical } from '../../../live/react';
import { harnessLabel } from '../../../thread/format';
import type { ThreadRow } from '../../../thread/rows';
import { fontSize, minTarget, mono, radius, space, useOmniTheme, weight } from '../../../theme';
import { HarnessLogo } from '../../../ui/Brand';
import { Icon } from '../../../ui/Icon';
import { Text } from '../../../ui/Text';
import { avatarInk } from '@omni/shared/avatar-color.ts';
import { mentionPieces } from '@omni/shared/message-context-machine.ts';
import type { Collision } from '@omni/shared/collisions.ts';
import { eyesFor } from '@omni/shared/crew-eyes.ts';
import { agentColor, agentName } from '../../agent-face';
import { AgentAvatar } from '../../AgentAvatar';
import { ChannelAvatar } from '../../ChannelAvatar';
import { useRowActions } from './actions';

type Of<K extends ThreadRow['kind']> = { row: Extract<ThreadRow, { kind: K }> };

/** The avatar's gutter and its gap: how far a reply's rows sit in from the author line (web: REPLY_INDENT). */
export const AVATAR = 24;
export const REPLY_INSET = AVATAR + space.s6;

const list = (names: readonly string[]) => (names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);

/** Who wrote a reply: the avatar in the gutter, the name and the time, and the run with Show technical details on. */
export function AuthorRow({ row }: Of<'author'>) {
  const { colors } = useOmniTheme();
  const agents = useAgents();
  const technical = useTechnical();
  const name = agentName(row.agent, agents);
  return (
    <View style={styles.author} accessibilityRole="header" accessibilityLabel={[name, row.at ? clock(toDate(row.at)) : null].filter(Boolean).join(', ')}>
      {/* The Conductor's channel look when it wears one (rows.ts), else the agent's avatar; the reply being written shows live eyes. */}
      {row.look ? (
        <ChannelAvatar name={row.look.name} icon={row.look.icon} avatarBg={row.look.avatar_bg} conductor size={AVATAR} />
      ) : (
        <AgentAvatar agent={row.agent} size={AVATAR} shows={row.shows ?? undefined} placement={row.shows ? 'focus' : 'still'} />
      )}
      <Text numberOfLines={1} style={[styles.name, { color: colors.fg }]}>
        {name}
      </Text>
      {technical ? (
        <View style={styles.run}>
          <HarnessLogo harness={row.run.harness} size={11} />
          <Text numberOfLines={1} style={[styles.meta, styles.shrink, { color: colors.fg3 }]}>
            {[harnessLabel(row.run.harness), row.run.model].filter(Boolean).join(' · ')}
          </Text>
        </View>
      ) : null}
      {row.at ? <Text style={[styles.meta, { color: colors.fg3 }]}>{clock(toDate(row.at))}</Text> : null}
    </View>
  );
}

const LANE_WORD: Record<string, string> = { running: 'working', queued: 'waiting', done: 'done', failed: 'failed', stopped: 'stopped' };

/**
 * A message several agents answered: a tab per agent, one lane at a time as on phone web. Each tab's avatar shows its
 * lane's state in its eyes (a photo or icon in a ring), and one that edited a collided file a warning mark. While a
 * lane still runs the tabs are in focus and their characters move (ADR 0021, D10); once all ended they hold still.
 */
export function LanesRow({ row }: Of<'lanes'>) {
  const { colors } = useOmniTheme();
  const agents = useAgents();
  const { pickLane } = useRowActions();
  const live = row.tabs.some((t) => t.status === 'running' || t.status === 'queued');
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs} accessibilityRole="tablist" accessibilityLabel="Agents answering">
      {row.tabs.map((tab) => {
        const on = tab.agent === row.picked;
        const name = agentName(tab.agent, agents);
        return (
          <Pressable
            key={tab.agent}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`${name}, ${LANE_WORD[tab.status] ?? tab.status}${tab.hit ? ', edited a file another agent edited' : ''}`}
            onPress={() => pickLane(row.turn, tab.agent)}
            style={[styles.tab, { backgroundColor: on ? colors.surface2 : 'transparent', borderColor: on ? colors.line : 'transparent' }]}
          >
            {/* A lane's mark is not the open thread's: a running lane works, as in a row (D7), in focus too. */}
            <AgentAvatar agent={tab.agent} size={18} shows={{ eyes: eyesFor({ mark: markOf(glyphFor(tab.status)) }) }} placement={live ? 'focus' : 'still'} />
            <Text numberOfLines={1} style={[styles.tabLabel, { color: on ? colors.fg : colors.fg2 }]}>
              {name}
            </Text>
            {tab.hit ? <Icon name="alert" size={13} color={colors.warn} /> : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** The files one lane's agent changed, a flagged one marked while its collision flag is up. */
export function FilesRow({ row }: Of<'files'>) {
  const { colors } = useOmniTheme();
  return (
    <View accessibilityLabel="Files it changed" style={[styles.files, { backgroundColor: colors.surface }]}>
      {row.files.map((f) => (
        <View key={f.path} style={[styles.file, f.flagged && { backgroundColor: colors.mark }]} accessibilityLabel={f.flagged ? `${f.path}, another agent edited it too` : f.path}>
          <Icon name={f.flagged ? 'alert' : 'file'} size={13} color={f.flagged ? colors.warn : colors.fg3} />
          <Text numberOfLines={1} ellipsizeMode="head" style={[styles.path, { color: colors.fg2 }]}>
            {f.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** A file two agents both edited, flagged in the transcript where it was raised. */
export function CollisionRow({ row }: Of<'collision'>) {
  const { dismissCollision } = useRowActions();
  return <CollisionFlag c={row.c} onDismiss={dismissCollision} />;
}

/**
 * A collision flag: the file with its folder, the full path under it, and who was told. It is up until the lead's
 * next commit, or until the user dismisses it (Q23). The transcript and Changes draw it.
 */
export function CollisionFlag({ c, onDismiss }: { c: Collision; onDismiss: (id: number) => Promise<void> }) {
  const { colors } = useOmniTheme();
  const agents = useAgents();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cleared = c.cleared === 'commit' ? 'Cleared at the commit' : c.cleared === 'dismiss' ? 'Dismissed' : null;
  const dismiss = async () => {
    setBusy(true);
    setError(null);
    try {
      await onDismiss(c.id);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'Could not dismiss it');
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={[styles.flag, { backgroundColor: cleared ? colors.surface : colors.mark }]}>
      <View style={styles.flagLine}>
        <Icon name="alert" size={15} color={cleared ? colors.fg3 : colors.warn} />
        <Text style={[styles.flagText, { color: colors.fg }]}>
          <Text style={{ fontWeight: weight.semibold }}>Both edited </Text>
          <Text style={[styles.path, { color: colors.fg }]}>{c.label}</Text>
          <Text style={{ color: colors.fg3 }}>{` · ${cleared ?? `${list(c.agents.map((a) => agentName(a, agents)))} were each told.`}`}</Text>
        </Text>
        {!cleared ? (
          <Pressable accessibilityRole="button" accessibilityLabel={`Dismiss the flag on ${c.path}`} accessibilityState={{ busy }} disabled={busy} hitSlop={space.s4} onPress={() => void dismiss()} style={styles.dismiss}>
            <Text style={[styles.dismissText, { color: colors.fg, opacity: busy ? 0.5 : 1 }]}>Dismiss</Text>
          </Pressable>
        ) : null}
      </View>
      {c.label !== c.path ? <Text style={[styles.meta, styles.fullPath, { color: colors.fg3 }]}>{c.path}</Text> : null}
      {error ? (
        <Text accessibilityRole="alert" style={[styles.meta, { color: colors.needs }]}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

/** "Designer joined", "Designer left", or the user's commit in a remote-led thread: one quiet centered line. */
export function MemberRow({ row }: Of<'member'>) {
  const { colors } = useOmniTheme();
  return (
    <Text style={[styles.meta, styles.memberLine, { color: colors.fg3 }]} accessibilityRole="text">
      {row.text}
    </Text>
  );
}

/** A remote agent could not read the thread's files: the channel decides, so the line opens its settings. */
export function LockRow({ row }: Of<'lock'>) {
  const { colors } = useOmniTheme();
  const { openChannelSettings } = useRowActions();
  return (
    <Pressable accessibilityRole="link" onPress={openChannelSettings} hitSlop={space.s4} style={styles.lock}>
      <Icon name="lock" size={12} color={colors.fg3} />
      <Text numberOfLines={1} style={[styles.meta, styles.shrink, { color: colors.fg3 }]}>
        {remoteLockLine(row.channel)}
      </Text>
    </Pressable>
  );
}

/**
 * Who a message went to where its text does not name them (`sentContext`): "To", then each agent's avatar and name,
 * on the line over the bubble.
 */
export function SentTo({ agents: to }: { agents: readonly { agent: string; name: string }[] }) {
  const { colors } = useOmniTheme();
  const agents = useAgents();
  if (!to.length) return null;
  return (
    <View style={styles.sentTo} accessibilityLabel={`To ${list(to.map((m) => agents.find((a) => a.id === m.agent)?.name ?? m.name))}`}>
      <Text style={[styles.meta, { color: colors.fg3 }]}>To</Text>
      {to.map((m) => (
        <View key={m.agent} style={styles.sentAgent}>
          <AgentAvatar agent={m.agent} size={16} />
          <Text numberOfLines={1} style={[styles.meta, { color: colors.fg2, fontWeight: weight.medium }]}>
            {agents.find((a) => a.id === m.agent)?.name ?? m.name}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** A message's text with each agent or machine it mentions as a pill: an agent's in its own color, a machine's in the live blue. */
export function MentionText({ text, records, style }: { text: string; records: unknown; style: object }) {
  const { colors } = useOmniTheme();
  const agents = useAgents();
  const pieces = mentionPieces(text, records);
  return (
    <Text selectable style={style}>
      {pieces.map((piece, i) => {
        const span = piece.span;
        if (!span) return piece.text;
        const bg = span.kind === 'agent' ? agentColor(span.agent.agent, agents) : colors.live;
        return (
          <Text key={i} style={[styles.pill, { backgroundColor: bg, color: span.kind === 'agent' ? avatarInk(bg) : colors.onInk }]}>
            {piece.text}
          </Text>
        );
      })}
    </Text>
  );
}

const styles = StyleSheet.create({
  sentTo: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.s3 },
  sentAgent: { flexDirection: 'row', alignItems: 'center', gap: space.s2, maxWidth: 160 },
  pill: { fontWeight: weight.semibold, borderRadius: radius.xs },
  author: { flexDirection: 'row', alignItems: 'center', gap: space.s6, minHeight: AVATAR },
  name: { flexShrink: 0, fontSize: 13.5, fontWeight: weight.semibold },
  run: { flexDirection: 'row', alignItems: 'center', gap: space.s2, flexShrink: 1 },
  meta: { fontSize: fontSize.meta },
  shrink: { flexShrink: 1 },
  tabs: { gap: space.s2 },
  tab: { flexDirection: 'row', alignItems: 'center', gap: space.s3, minHeight: minTarget - 8, paddingHorizontal: space.s5, borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth },
  tabLabel: { fontSize: fontSize.ui, fontWeight: weight.medium, maxWidth: 140 },
  files: { borderRadius: radius.lg, paddingHorizontal: space.s2, paddingVertical: space.s3 },
  file: { flexDirection: 'row', alignItems: 'center', gap: space.s4, paddingHorizontal: space.s4, paddingVertical: space.s2, borderRadius: radius.item },
  path: { flexShrink: 1, fontFamily: mono, fontSize: 12 },
  flag: { borderRadius: radius.lg, paddingHorizontal: space.s7, paddingVertical: space.s5, gap: space.s2 },
  flagLine: { flexDirection: 'row', alignItems: 'center', gap: space.s5 },
  flagText: { flex: 1, fontSize: fontSize.ui, lineHeight: 19 },
  fullPath: { fontFamily: mono, paddingLeft: 15 + space.s5 },
  dismiss: { minHeight: 32, justifyContent: 'center', paddingHorizontal: space.s2 },
  dismissText: { fontSize: fontSize.ui, fontWeight: weight.semibold },
  memberLine: { textAlign: 'center', paddingVertical: space.s1 },
  lock: { flexDirection: 'row', alignItems: 'center', gap: space.s3, minHeight: 28 },
});
