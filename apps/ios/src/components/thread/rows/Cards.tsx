import { cloudStatus, prNumber } from '@omni/shared/cloud-agent.ts';
import { handoverNote, switchText } from '@omni/shared/run-switch.ts';
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../../../ui/Text';

import { AttachmentRow } from '../../../attachments/AttachmentRow';
import { showsBubble } from '../../../context/labels';
import { duration, plural } from '../../../thread/format';
import { outcomeText, type ThreadRow } from '../../../thread/rows';
import { fontSize, minTarget, radius, space, useOmniTheme, weight } from '../../../theme';
import { ContextChips } from '../../ContextChips';
import { type DotTone, StatusDot } from '../../StatusDot';
import { Markdown } from '../Markdown';
import { QuestionCard } from '../QuestionCard';
import { useRowActions } from './actions';

type Of<K extends ThreadRow['kind']> = { row: Extract<ThreadRow, { kind: K }> };

const MONO = 'Menlo';

const statusTone = (status: string): DotTone => (status === 'failed' ? 'warn' : status === 'running' || status === 'queued' ? 'ok' : 'muted');

function LoadWhole({ label, onPress }: { label: string; onPress: () => void }) {
  const { colors } = useOmniTheme();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} hitSlop={8} style={styles.loadWhole}>
      <Text style={[styles.small, { color: colors.fg }]}>{label}</Text>
    </Pressable>
  );
}

export function PromptRow({ row }: Of<'prompt'>) {
  const { colors } = useOmniTheme();
  const { loadWhole, threadId } = useRowActions();
  const { p, caption } = row;
  return (
    <View style={styles.end}>
      <ContextChips records={p.context} />
      {showsBubble(p) ? (
        <View style={[styles.bubble, { backgroundColor: colors.surface2 }, p.dropped && styles.dim]}>
          {p.attachments?.length ? <AttachmentRow threadId={threadId} items={p.attachments} /> : null}
          {p.text ? (
            <Text selectable style={[styles.bubbleText, { color: colors.fg }]}>
              {p.text}
            </Text>
          ) : null}
          {p.items?.length ? (
            <View style={styles.wake}>
              {p.items.map((it, i) => (
                <Text key={i} numberOfLines={2} style={[styles.small, { color: colors.fg2 }]}>
                  {[it.label, it.kind, it.excerpt].filter(Boolean).join(' · ')}
                </Text>
              ))}
              {p.more ? <Text style={[styles.small, { color: colors.fg3 }]}>{`${p.more} more`}</Text> : null}
            </View>
          ) : null}
        </View>
      ) : null}
      {caption ? <Text style={[styles.caption, { color: colors.fg3 }]}>{caption}</Text> : null}
      {p.clipped ? <LoadWhole label="Load whole message" onPress={() => loadWhole(p.key)} /> : null}
    </View>
  );
}

export function ReportRow({ row }: Of<'report'>) {
  const { colors } = useOmniTheme();
  const { openThread } = useRowActions();
  const { r } = row;
  return (
    <View style={[styles.card, { backgroundColor: colors.surface }, r.dropped && styles.dim]}>
      <Pressable accessibilityRole="button" onPress={() => openThread(r.thread_id)} style={styles.line}>
        <Text style={[styles.cardTitle, { color: colors.fg }]}>{`Report from ${r.role || 'the crew'}`}</Text>
        {r.dropped ? <Text style={[styles.caption, { color: colors.fg3 }]}>{r.undelivered ? `Not delivered · ${r.undelivered}` : 'Not delivered'}</Text> : null}
        <View style={styles.grow} />
        {r.task_id ? <Text style={[styles.caption, { color: colors.fg3, fontFamily: MONO }]}>{r.task_id}</Text> : null}
      </Pressable>
      <MarkdownIn text={r.text} />
    </View>
  );
}

function MarkdownIn({ text }: { text: string }) {
  const { openThread } = useRowActions();
  return <Markdown text={text} onOpenThread={openThread} />;
}

export function QuestionRow({ row }: Of<'question'>) {
  const { answer } = useRowActions();
  return <QuestionCard q={row.q} send={answer} />;
}

export function OutcomeRow({ row }: Of<'outcome'>) {
  const { colors } = useOmniTheme();
  return (
    <View style={styles.line}>
      <StatusDot tone={statusTone(row.status)} />
      <Text style={[styles.meta, { color: colors.fg3 }]}>{outcomeText(row, duration(row.tookMs))}</Text>
    </View>
  );
}

export function ConductorRow() {
  const { colors } = useOmniTheme();
  return (
    <View style={styles.line}>
      <StatusDot tone="ok" />
      <Text style={[styles.meta, { color: colors.fg3 }]}>Conductor</Text>
    </View>
  );
}

export function ErrorRow({ row }: Of<'error'>) {
  const { colors } = useOmniTheme();
  const [open, setOpen] = useState(false);
  return (
    <Pressable accessibilityRole="button" onPress={() => setOpen((o) => !o)}>
      <Text numberOfLines={open ? undefined : 4} style={[styles.mono, { color: colors.fg2 }]}>
        {row.text}
      </Text>
    </Pressable>
  );
}

export function CloudRow({ row }: Of<'cloud'>) {
  const { colors } = useOmniTheme();
  const { p } = row;
  const st = cloudStatus(p.status);
  const pr = prNumber(p.pr_url);
  const detail = [p.repo, p.branch ?? p.ref].filter(Boolean).join(' · ');
  return (
    <View style={[styles.card, { backgroundColor: colors.surface }]}>
      <View style={styles.line}>
        <StatusDot tone={statusTone(st.status)} />
        <Text style={[styles.cardTitle, { color: colors.fg }]}>{p.name || 'Cursor cloud agent'}</Text>
        <View style={styles.grow} />
        <Text style={[styles.caption, { color: colors.fg3 }]}>{st.label}</Text>
      </View>
      {detail ? (
        <Text numberOfLines={1} style={[styles.small, { color: colors.fg3, fontFamily: MONO }]}>
          {detail}
        </Text>
      ) : null}
      <View style={styles.links}>
        <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(p.url)} hitSlop={8}>
          <Text style={[styles.link, { color: colors.fg }]}>Open on cursor.com</Text>
        </Pressable>
        {p.pr_url ? (
          <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(p.pr_url!)} hitSlop={8}>
            <Text style={[styles.link, { color: colors.fg }]}>{`Pull request ${pr ?? ''}`.trim()}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export function ProseRow({ row }: Of<'prose'>) {
  const { loadWhole } = useRowActions();
  return (
    <View>
      <MarkdownIn text={row.text} />
      {row.clipped !== null ? <LoadWhole label="Load whole answer" onPress={() => loadWhole(row.clipped!)} /> : null}
    </View>
  );
}

export function DelegationRow({ row }: Of<'delegation'>) {
  const { colors } = useOmniTheme();
  const { openThread } = useRowActions();
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, paddingHorizontal: space.s4 }]}>
      <Text style={[styles.cardTitle, { color: colors.fg, paddingHorizontal: space.s4 }]}>{`Delegated ${plural(row.kids.length, 'task')}`}</Text>
      {row.kids.map((k) => (
        <Pressable
          key={k.id}
          accessibilityRole="button"
          accessibilityLabel={`${k.title || 'Untitled'}, ${k.status}`}
          onPress={() => openThread(k.id)}
          style={({ pressed }) => [styles.kid, { backgroundColor: pressed ? colors.surface3 : colors.bg }]}
        >
          <StatusDot tone={statusTone(k.status)} />
          <View style={styles.grow}>
            <Text numberOfLines={1} style={[styles.kidTitle, { color: colors.fg }]}>
              {k.title || 'Untitled'}
            </Text>
            <Text numberOfLines={1} style={[styles.caption, { color: colors.fg3 }]}>
              {[k.role, k.task_id, k.status].filter(Boolean).join(' · ')}
            </Text>
          </View>
        </Pressable>
      ))}
    </View>
  );
}

export function ArtifactRow({ row }: Of<'artifact'>) {
  const { colors } = useOmniTheme();
  const { openArtifact } = useRowActions();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`File ${row.a.name}`}
      onPress={() => openArtifact(row.a)}
      style={({ pressed }) => [styles.card, styles.line, { backgroundColor: pressed ? colors.surface3 : colors.surface }]}
    >
      <View style={[styles.fileIcon, { backgroundColor: colors.surface3 }]}>
        <Text style={[styles.caption, { color: colors.fg2, fontFamily: MONO }]}>{row.a.name.split('.').pop()?.slice(0, 4) ?? ''}</Text>
      </View>
      <View style={styles.grow}>
        <Text numberOfLines={1} style={[styles.kidTitle, { color: colors.fg, fontFamily: MONO }]}>
          {row.a.name}
        </Text>
        <Text style={[styles.caption, { color: colors.fg3 }]}>{row.a.kind}</Text>
      </View>
    </Pressable>
  );
}

export function StepsRow({ row }: Of<'steps'>) {
  const { colors } = useOmniTheme();
  const { toggleTurn } = useRowActions();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: row.open }}
      onPress={() => toggleTurn(row.turn)}
      style={({ pressed }) => [styles.pill, { backgroundColor: pressed ? colors.surface3 : colors.surface }]}
    >
      <Text style={[styles.pillText, { color: colors.fg2 }]}>
        {row.live ? `${plural(row.steps, 'step')} so far` : plural(row.steps, 'step')}
        {row.failed > 0 ? <Text style={{ color: colors.fg3 }}>{`  ·  ${row.failed} failed`}</Text> : null}
      </Text>
      <Text style={[styles.chevron, { color: colors.fg4 }]}>{row.open ? '⌄' : '›'}</Text>
    </Pressable>
  );
}

export function NowRow({ row }: Of<'now'>) {
  const { colors } = useOmniTheme();
  return (
    <View style={[styles.card, styles.line, { backgroundColor: colors.surface }]}>
      <StatusDot tone="ok" />
      <Text numberOfLines={1} style={[styles.nowText, { color: colors.fg }]}>
        {row.now.verb}
        {row.now.target ? <Text style={{ fontFamily: MONO, fontSize: 13 }}>{` ${row.now.target}`}</Text> : null}
      </Text>
      {row.meta ? <Text style={[styles.caption, { color: colors.fg3 }]}>{row.meta}</Text> : null}
    </View>
  );
}

export function PlanRow({ row }: Of<'plan'>) {
  const { colors } = useOmniTheme();
  const { plan } = row;
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, gap: 9 }]}>
      <View style={styles.line}>
        <Text style={[styles.cardTitle, { color: colors.fg }]}>Plan</Text>
        <View style={styles.grow} />
        <Text style={[styles.caption, { color: colors.fg3 }]}>{`${plan.done}/${plan.todos.length}`}</Text>
      </View>
      {plan.todos.map((t, i) => {
        const running = t.status === 'in_progress';
        const done = t.status === 'completed';
        return (
          <View key={i} style={styles.line}>
            <StatusDot tone={running ? 'ok' : 'muted'} />
            <Text style={[styles.todo, { color: running ? colors.fg : colors.fg3 }, done && styles.struck]}>{(running && t.activeForm) || t.content}</Text>
          </View>
        );
      })}
    </View>
  );
}

export function SwitchRow({ row }: Of<'switch'>) {
  const { colors } = useOmniTheme();
  const note = handoverNote(row.it.p, row.it.done, row.it.superseded);
  return (
    <View style={styles.switch}>
      <View style={[styles.rule, { backgroundColor: colors.line }]} />
      <Text style={[styles.caption, { color: colors.fg3, textAlign: 'center' }]}>{switchText(row.it.p)}</Text>
      {note ? <Text style={[styles.caption, { color: colors.fg4, textAlign: 'center' }]}>{note}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  end: { alignItems: 'flex-end', gap: space.s2 },
  bubble: { maxWidth: '86%', borderRadius: radius.xl, paddingHorizontal: space.s8, paddingVertical: space.s6, gap: space.s4 },
  bubbleText: { fontSize: 15, lineHeight: 22 },
  dim: { opacity: 0.6 },
  wake: { gap: space.s2 },
  caption: { fontSize: fontSize.meta },
  small: { fontSize: 12.5, lineHeight: 18 },
  meta: { fontSize: 12.5 },
  card: { borderRadius: radius.xl, paddingHorizontal: space.s6, paddingVertical: space.s6, gap: space.s4 },
  cardTitle: { fontSize: 13, fontWeight: weight.semibold },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.s4 },
  grow: { flex: 1 },
  loadWhole: { minHeight: 32, justifyContent: 'center' },
  mono: { fontFamily: MONO, fontSize: 12.5, lineHeight: 19 },
  links: { flexDirection: 'row', gap: space.s8 },
  link: { fontSize: 13, fontWeight: weight.semibold },
  kid: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s6,
    minHeight: minTarget,
    paddingHorizontal: space.s6,
    paddingVertical: space.s4,
    borderRadius: radius.md,
  },
  kidTitle: { fontSize: 14 },
  fileIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  pill: { minHeight: minTarget, flexDirection: 'row', alignItems: 'center', borderRadius: radius.pill, paddingHorizontal: 14 },
  pillText: { flex: 1, fontSize: 13.5 },
  chevron: { fontSize: 18 },
  nowText: { flex: 1, fontSize: 14 },
  todo: { flex: 1, fontSize: 14, lineHeight: 19 },
  struck: { textDecorationLine: 'line-through' },
  switch: { alignItems: 'center', gap: space.s2, paddingVertical: space.s2 },
  rule: { height: StyleSheet.hairlineWidth, alignSelf: 'stretch', marginBottom: space.s2 },
});
