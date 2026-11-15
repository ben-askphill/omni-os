// The thread tree under a job's row on Activity: the threads it delegated, its team's members and what runs under
// them, one line each on a rule from the row's avatar, as phone web draws it (apps/web/src/components/ThreadTree.tsx,
// variant "phone"). Which rows show, and in what state, is @omni/shared/thread-tree.ts.
import { treeRows, type Tally } from '@omni/shared/thread-tree.ts';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { shortAgo } from '../../live/channel-model';
import { tallyLabel, tallyOf, TALLY_ORDER, type JobTree, type StubNode } from '../../live/thread-tree';
import { harnessLabel } from '../../needs/limit';
import { fontSize, space, useOmniTheme } from '../../theme';
import { HarnessLogo } from '../../ui/Brand';
import { Icon } from '../../ui/Icon';
import { Text } from '../../ui/Text';
import { statusLabel } from '../glyph';
import { StatusDot } from '../StatusDot';

/** A tree row's height, and where the rule's last elbow meets it (web: h-9, --tree-mid 18px). */
const ROW = 36;
const MID = ROW / 2;
/** How far a level's rows sit in from its rule, and how far a nested level sits in from its parent's rule. */
const PAD = space.s6;
const NEST = space.s9;

const GLYPH: Record<keyof Tally, 'needs' | 'failed' | 'running' | 'done'> = { needs: 'needs', failed: 'failed', running: 'running', done: 'done' };

/** How many threads under a job are in each state: needs you, failed, running, done. */
export function TreeTally({ tally }: { tally: Tally }) {
  const { colors } = useOmniTheme();
  return (
    <View style={styles.tally}>
      {TALLY_ORDER.filter((x) => tally[x.key]).map((x) => (
        <View key={x.key} style={styles.tallyPart}>
          <StatusDot glyph={GLYPH[x.key]} size={6} />
          <Text style={[styles.tallyCount, { color: colors.fg3 }]}>{tally[x.key]}</Text>
        </View>
      ))}
    </View>
  );
}

function ToggleFace({ tree, open }: { tree: JobTree; open: boolean }) {
  const { colors } = useOmniTheme();
  return (
    <>
      <TreeTally tally={tree.tally} />
      <Icon name={open ? 'chevronDown' : 'chevronRight'} size={11} color={colors.fg3} />
    </>
  );
}

/** The job's tally with a chevron: a button that opens and closes its tree. It sits over the row, a sibling of its button. */
export function TreeToggle({ tree, open, title, onToggle }: { tree: JobTree; open: boolean; title: string; onToggle: () => void }) {
  const { colors } = useOmniTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${open ? 'Close' : 'Open'} the threads under ${title}: ${tallyLabel(tree.tally)}`}
      accessibilityState={{ expanded: open }}
      hitSlop={8}
      onPress={onToggle}
      style={({ pressed }) => [styles.toggle, { backgroundColor: pressed ? colors.wash : 'transparent' }]}
    >
      <ToggleFace tree={tree} open={open} />
    </Pressable>
  );
}

/** The toggle's size without the button, to hold its place on the row's line it is laid over. */
export function TreeToggleSpace({ tree, open }: { tree: JobTree; open: boolean }) {
  return (
    <View accessible={false} importantForAccessibility="no-hide-descendants" style={[styles.toggle, styles.hidden]}>
      <ToggleFace tree={tree} open={open} />
    </View>
  );
}

export interface TreeRowsProps {
  tree: JobTree;
  open: boolean;
  onToggle: () => void;
  /** Running sub-agents by thread, for a row on the Working shelf; null elsewhere. */
  agents: ReadonlyMap<string, number> | null;
  /** The channel names, for a tree whose threads sit in more than one channel. */
  channelName: (id: string) => string;
  now: number;
  onOpen: (threadId: string) => void;
}

/** The rows under a job. */
export function TreeRows(props: TreeRowsProps) {
  return (
    <View accessibilityRole="list" accessibilityLabel="Threads under this one">
      <Level nodes={props.tree.nodes} spans={props.tree.spans} {...props} />
    </View>
  );
}

function Level({ nodes, spans, ...props }: TreeRowsProps & { nodes: StubNode[]; spans: boolean }) {
  const { colors } = useOmniTheme();
  const [all, setAll] = useState(false);
  const { open, onToggle } = props;
  const { rows, more } = treeRows(nodes, open, all);
  // Closed with nothing that needs Ben, the toggle's tally says it all: no "n more" row on its own.
  if (!rows.length && (!open || !more.length)) return null;
  const label = open ? `${more.length} more done` : `${more.length} more`;
  return (
    <View>
      {rows.map((n, i) => (
        <Node key={n.thread.id} n={n} last={i === rows.length - 1 && !more.length} spans={spans} {...props} />
      ))}
      {more.length > 0 && (
        <View style={styles.node}>
          <Rule last />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${label}: ${tallyLabel(tallyOf(more))}`}
            onPress={() => (open ? setAll(true) : onToggle())}
            style={({ pressed }) => [styles.row, { backgroundColor: pressed ? colors.wash : 'transparent' }]}
          >
            <View style={styles.mark}>
              <Icon name="chevronRight" size={10} color={colors.fg3} />
            </View>
            <Text numberOfLines={1} style={[styles.more, { color: colors.fg3 }]}>
              {label}
            </Text>
            <TreeTally tally={tallyOf(more)} />
          </Pressable>
        </View>
      )}
    </View>
  );
}

/** The rule a row hangs off: straight down past it, or for the last row an elbow into its middle. */
function Rule({ last }: { last: boolean }) {
  const { colors } = useOmniTheme();
  return <View pointerEvents="none" style={[last ? styles.elbow : styles.line, { borderColor: colors.lineStrong }]} />;
}

function Node({ n, last, spans, ...props }: TreeRowsProps & { n: StubNode; last: boolean; spans: boolean }) {
  const { colors } = useOmniTheme();
  const t = n.thread;
  const title = t.title || 'Untitled';
  const channel = t.channel_id === 'conductor' ? 'Conductor' : props.channelName(t.channel_id);
  const agents = props.agents?.get(t.id) ?? 0;
  const state = n.state === 'needs' ? 'Needs you' : t.done_at ? 'Marked done' : statusLabel(n.state);
  return (
    <View style={styles.node}>
      <Rule last={last} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={[title, t.harness ? harnessLabel(t.harness) : null, t.model, `#${channel}`, state].filter(Boolean).join(', ')}
        onPress={() => props.onOpen(t.id)}
        style={({ pressed }) => [styles.row, { backgroundColor: pressed ? colors.wash : 'transparent' }]}
      >
        <View style={styles.mark}>{t.done_at ? <Icon name="check" size={10} color={colors.fg3} /> : <StatusDot glyph={n.state} size={7} />}</View>
        {t.harness ? <HarnessLogo harness={t.harness} size={13} /> : null}
        <Text numberOfLines={1} style={[styles.title, { color: colors.fg2 }]}>
          {title}
        </Text>
        {spans ? (
          <Text numberOfLines={1} style={[styles.channel, { color: colors.fg3 }]}>
            {`#${channel}`}
          </Text>
        ) : (
          <Text style={[styles.time, { color: colors.fg3 }]}>{shortAgo(t.updated_at ?? t.created_at, props.now)}</Text>
        )}
      </Pressable>
      {n.children.length > 0 && (
        <View style={styles.nested}>
          <Level nodes={n.children} spans={false} {...props} />
        </View>
      )}
      {agents > 0 && (
        <View style={styles.nested}>
          <AgentsRow count={agents} onPress={() => props.onOpen(t.id)} />
        </View>
      )}
    </View>
  );
}

/** A thread's running sub-agents, as one row on the rule: "2 agents running". */
export function AgentsRow({ count, onPress }: { count: number; onPress: () => void }) {
  const { colors } = useOmniTheme();
  const label = `${count} ${count === 1 ? 'agent' : 'agents'} running`;
  return (
    <View style={styles.node}>
      <Rule last />
      <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.row, { backgroundColor: pressed ? colors.wash : 'transparent' }]}>
        <View style={styles.mark}>
          <StatusDot glyph="running" size={6} />
        </View>
        <Icon name="layers" size={13} color={colors.fg3} />
        <Text numberOfLines={1} style={[styles.agents, { color: colors.fg3 }]}>
          {label}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  tally: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  tallyPart: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  tallyCount: {
    fontSize: fontSize.meta,
    fontVariant: ['tabular-nums'],
  },
  toggle: {
    height: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s4,
    paddingHorizontal: space.s2,
    borderRadius: 14,
  },
  /** Only its width counts: the line it holds a place on keeps its own height. */
  hidden: {
    height: 16,
    opacity: 0,
  },
  node: {
    position: 'relative',
  },
  line: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    borderLeftWidth: 1,
  },
  elbow: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 8,
    height: MID,
    borderLeftWidth: 1,
    borderBottomWidth: 1,
    borderBottomLeftRadius: 6,
  },
  row: {
    height: ROW,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s3,
    paddingLeft: PAD,
    paddingRight: space.s4,
    borderRadius: 6,
  },
  mark: {
    width: 12,
    alignItems: 'center',
    marginRight: space.s1,
  },
  title: {
    flex: 1,
    fontSize: fontSize.body,
  },
  channel: {
    maxWidth: '40%',
    fontSize: fontSize.meta,
  },
  time: {
    fontSize: fontSize.caption,
    fontVariant: ['tabular-nums'],
  },
  more: {
    flex: 1,
    fontSize: fontSize.small - 1,
  },
  agents: {
    flex: 1,
    fontSize: fontSize.ui,
  },
  nested: {
    marginLeft: NEST,
  },
});
