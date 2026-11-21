// A group thread's member list on the phone (ADR 0019): the header's avatars open it as a sheet, as on phone web
// (apps/web/src/mobile/MemberSheet.tsx). Each member with its state, Remove on every member but the lead, and Add an
// agent, which seats one with a joined line and no turn (Q8). The thread menu's Add an agent… opens it on that list.
import type { Thread } from '@omni/client-core';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';

import { useAgents, useLiveHub } from '../../live/react';
import { memberRows, threadAgents } from '../../thread/agents';
import { fontSize, minTarget, radius, space, useOmniTheme, weight } from '../../theme';
import { tap } from '../../ui/haptics';
import { Icon } from '../../ui/Icon';
import { Sheet } from '../../ui/Sheet';
import { Text } from '../../ui/Text';
import { AgentAvatar } from '../AgentAvatar';
import { StatusDot } from '../StatusDot';

export function MemberSheet({ thread, visible, onClose }: { thread: Thread; visible: boolean; onClose: () => void }) {
  const { colors } = useOmniTheme();
  const hub = useLiveHub();
  const roster = useAgents();
  const others = useMemo(() => threadAgents(thread, roster).others, [thread, roster]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const call = async (agent: string, fn: () => Promise<Thread>) => {
    setBusy(agent);
    setError(null);
    try {
      hub.applyThread(await fn());
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(null);
    }
  };
  const remove = (agent: string, name: string, working: boolean) =>
    Alert.alert(`Remove ${name}?`, `Its session closes${working ? ' once its turn finishes' : ''}. Its replies stay in the thread.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: `Remove ${name}`, style: 'destructive', onPress: () => void call(agent, () => hub.request((api) => api.removeMember(thread.id, agent))) },
    ]);
  const seat = (agent: string) => {
    tap();
    void call(agent, () => hub.request((api) => api.seatAgent(thread.id, agent)));
  };

  const rows = memberRows(thread);
  return (
    <Sheet visible={visible} title="Agents in this thread" onClose={onClose}>
      <View style={styles.body}>
        <View style={styles.heading}>
          <Text style={[styles.caption, { color: colors.fg3 }]}>IN THIS THREAD</Text>
          <Text style={[styles.meta, { color: colors.fg3 }]}>@ an agent to send it a message</Text>
        </View>
        <View style={[styles.group, { backgroundColor: colors.surface }]}>
          {rows.map((m, i) => (
            <View key={m.agent} style={[styles.row, i > 0 && { borderTopColor: colors.line, borderTopWidth: StyleSheet.hairlineWidth }]}>
              <AgentAvatar agent={m.agent} size={32} shows={{ member: m.member }} />
              <View style={styles.grow}>
                <View style={styles.nameLine}>
                  <Text numberOfLines={1} style={[styles.name, { color: colors.fg }]}>
                    {m.name}
                  </Text>
                  {m.lead ? (
                    <View style={[styles.tag, { backgroundColor: colors.surface2 }]}>
                      <Text style={[styles.tagText, { color: colors.fg3 }]}>Lead</Text>
                    </View>
                  ) : null}
                </View>
                <View style={styles.nameLine}>
                  <StatusDot glyph={m.glyph} size={7} />
                  <Text numberOfLines={1} style={[styles.meta, { color: colors.fg3 }]}>
                    {[m.state, m.run].filter(Boolean).join(' · ')}
                  </Text>
                </View>
              </View>
              {m.removable ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${m.name}`}
                  disabled={busy !== null}
                  hitSlop={space.s4}
                  onPress={() => remove(m.agent, m.name, m.member === 'working')}
                  style={styles.action}
                >
                  {busy === m.agent ? <ActivityIndicator color={colors.fg3} /> : <Text style={[styles.actionText, { color: colors.needs }]}>Remove</Text>}
                </Pressable>
              ) : null}
            </View>
          ))}
        </View>
        {others.length ? (
          <>
            <View style={styles.heading}>
              <Text style={[styles.caption, { color: colors.fg3 }]}>ADD AN AGENT</Text>
              <Text style={[styles.meta, { color: colors.fg3 }]}>It joins and stays until you remove it</Text>
            </View>
            <View style={[styles.group, { backgroundColor: colors.surface }]}>
              {others.map((a, i) => (
                <Pressable
                  key={a.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Add ${a.name}`}
                  disabled={busy !== null}
                  onPress={() => seat(a.id)}
                  style={({ pressed }) => [styles.row, i > 0 && { borderTopColor: colors.line, borderTopWidth: StyleSheet.hairlineWidth }, pressed && { backgroundColor: colors.surface2 }]}
                >
                  <AgentAvatar agent={a.id} size={28} />
                  <Text numberOfLines={1} style={[styles.name, styles.grow, { color: colors.fg }]}>
                    {a.name}
                  </Text>
                  {busy === a.id ? <ActivityIndicator color={colors.fg3} /> : <Icon name="plus" size={15} color={colors.fg3} />}
                </Pressable>
              ))}
            </View>
          </>
        ) : null}
        {error ? (
          <Text accessibilityRole="alert" style={[styles.meta, styles.error, { color: colors.needs }]}>
            {error}
          </Text>
        ) : null}
      </View>
    </Sheet>
  );
}

/**
 * The header's avatars in a group thread, in place of the Working label: up to two faces, the busy ones first, each
 * showing its state in its eyes (or a photo's or icon's ring), and how many agents sit in the thread. Opens the
 * member sheet.
 */
export function MemberButton({ thread, onOpen }: { thread: Thread; onOpen: () => void }) {
  const { colors } = useOmniTheme();
  const members = thread.members ?? [];
  if (!members.length) return null;
  const running = members.filter((m) => m.state === 'working').map((m) => m.name);
  const shown = [...members.filter((m) => m.state === 'working' || m.state === 'needs'), ...members.filter((m) => m.state !== 'working' && m.state !== 'needs')].slice(0, 2);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${members.length} agents in this thread${running.length ? `, ${running.join(' and ')} working` : ''}`}
      hitSlop={space.s2}
      onPress={onOpen}
      style={styles.facepile}
    >
      <View style={styles.faces}>
        {shown.map((m, i) => (
          <View key={m.agent} style={i > 0 && styles.overlap}>
            <AgentAvatar agent={m.agent} size={22} shows={{ member: m.state }} />
          </View>
        ))}
      </View>
      <Text style={[styles.count, { color: colors.fg2 }]}>{members.length}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: space.s8, paddingBottom: space.s11, gap: space.s4 },
  heading: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingHorizontal: space.s4, paddingTop: space.s6 },
  caption: { fontSize: fontSize.label, fontWeight: weight.semibold, letterSpacing: 0.4 },
  meta: { fontSize: fontSize.caption, flexShrink: 1 },
  group: { borderRadius: radius.lg, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.s6, minHeight: minTarget + 8, paddingHorizontal: space.s6, paddingVertical: space.s4 },
  grow: { flex: 1, minWidth: 0 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: space.s3 },
  name: { flexShrink: 1, fontSize: fontSize.body, fontWeight: weight.medium },
  tag: { borderRadius: radius.pill, paddingHorizontal: space.s3, paddingVertical: 1 },
  tagText: { fontSize: fontSize.label, fontWeight: weight.medium },
  action: { minHeight: minTarget, minWidth: 64, alignItems: 'flex-end', justifyContent: 'center' },
  actionText: { fontSize: fontSize.ui, fontWeight: weight.semibold },
  error: { paddingHorizontal: space.s4 },
  facepile: { flexDirection: 'row', alignItems: 'center', gap: space.s2, minHeight: minTarget, paddingHorizontal: space.s2 },
  faces: { flexDirection: 'row', alignItems: 'center' },
  overlap: { marginLeft: -6 },
  count: { fontSize: fontSize.caption, fontWeight: weight.medium },
});
