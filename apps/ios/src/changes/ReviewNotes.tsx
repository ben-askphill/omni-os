// Review notes on the iOS Changes screen (packages/shared/review-notes.ts), as the Web UI's Changes panel shows them
// (apps/web/src/components/thread/panel/ReviewNotes.tsx): each open or sent note under its lines, outdated ones and the
// resolved history over the diff, and Send open notes, to this thread, one of its delegates or a new delegate.
import type { ReviewNote, ReviewNoteTarget, ReviewNotesSent } from '@omni/client-core';
import type { DiffSelection } from '@omni/shared/message-context-diff.ts';
import { NOTE_BODY_MAX, noteLabel, notePick, noteSendBody, noteSendLabel, noteState, noteTargetRows, type NotePlace, type NoteTargetPick } from '@omni/shared/review-notes.ts';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { useLiveHub } from '../live/react';
import { describeFailure } from '../review/failure';
import { useFetched } from '../review/useFetched';
import { fontSize, lineHeight, minTarget, mono, radius, space, useOmniTheme, weight } from '../theme';
import { Button } from '../ui/Button';
import { Chip } from '../ui/Chip';
import { Icon } from '../ui/Icon';
import { OptionGroup, OptionRow } from '../ui/OptionRow';
import { Sheet } from '../ui/Sheet';
import { Text, TextInput } from '../ui/Text';

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

export interface NoteActions {
  add(anchor: DiffSelection, body: string): Promise<void>;
  update(id: string, change: { body?: string; resolved?: boolean }): Promise<void>;
  remove(id: string): Promise<void>;
  /** Every open note to the picked thread. What it answers says where they went and whether it made a delegate. */
  send(pick: NoteTargetPick): Promise<ReviewNotesSent>;
}

/** Where Send open notes sends, from useReviewNotes. */
export interface NoteTarget {
  delegates: readonly ReviewNoteTarget[];
  pick: NoteTargetPick;
  setPick(pick: NoteTargetPick): void;
}

/**
 * The thread's notes, refetched when the feed says they changed here or on another Mac, what changes them, and where
 * Send open notes sends: this thread unless Ben picks a delegate or a new one. The delegates refetch when one changes.
 */
export function useReviewNotes(threadId: string) {
  const hub = useLiveHub();
  const fetched = useFetched(`review-notes:${threadId}`, (api) => api.reviewNotes(threadId));
  const targets = useFetched(`review-note-targets:${threadId}`, (api) => api.reviewNoteTargets(threadId));
  const { reload } = fetched;
  const reloadTargets = targets.reload;
  const [picked, setPick] = useState<NoteTargetPick>('self');
  useEffect(
    () =>
      hub.watchFeed((m) => {
        const msg = m as { type?: unknown; thread_id?: unknown; thread?: { parent_id?: unknown } };
        if (msg.type === 'review_notes' && msg.thread_id === threadId) reload();
        if (msg.type === 'thread' && msg.thread?.parent_id === threadId) reloadTargets();
      }),
    [hub, threadId, reload, reloadTargets],
  );
  const delegates = useMemo(() => targets.data?.targets ?? [], [targets.data]);
  const actions = useMemo<NoteActions>(
    () => ({
      add: async (anchor, body) => void (await hub.request((api) => api.addReviewNote(threadId, anchor, body)), reload()),
      update: async (id, change) => void (await hub.request((api) => api.updateReviewNote(threadId, id, change)), reload()),
      remove: async (id) => void (await hub.request((api) => api.deleteReviewNote(threadId, id)), reload()),
      send: async (pick) => {
        const sent = await hub.request((api) => api.sendReviewNotes(threadId, noteSendBody(pick)));
        reload();
        if (sent.created) reloadTargets();
        return sent;
      },
    }),
    [hub, threadId, reload, reloadTargets],
  );
  const target: NoteTarget = { delegates, pick: notePick(picked, delegates), setPick };
  return { notes: fetched.data?.notes ?? null, reload, actions, target };
}

/** Over the diff: the counts, Send open notes, notes whose lines are not on screen, and the resolved ones behind a toggle. */
export function NotesBar({
  notes,
  placed,
  actions,
  target,
  turn = false,
  onSent,
}: {
  notes: readonly ReviewNote[];
  placed: ReadonlyMap<string, NotePlace>;
  actions: NoteActions;
  target: NoteTarget;
  turn?: boolean;
  /** After a send to this thread: back to it, where the message now is. */
  onSent: () => void;
}) {
  const { colors } = useOmniTheme();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState(false);
  const [picking, setPicking] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const rows = useMemo(() => noteTargetRows(target.delegates), [target.delegates]);
  if (!notes.length) return null;
  const open = notes.filter((n) => noteState(n) === 'open').length;
  const sent = notes.filter((n) => noteState(n) === 'sent').length;
  const resolved = notes.filter((n) => n.resolved_at);
  const away = notes.filter((n) => !n.resolved_at && !placed.has(n.id));

  const current = rows.find((r) => r.value === target.pick) ?? rows[0]!;
  const send = async () => {
    setBusy(true);
    setError(null);
    setSentTo(null);
    try {
      const pick = target.pick;
      const sent = await actions.send(pick);
      if (pick === 'self') return onSent();
      // The notes went elsewhere, so the screen stays and says where.
      setSentTo(sent.created ? 'a new delegate' : current.label);
      if (sent.created) target.setPick(sent.target);
    } catch (e) {
      setError(describeFailure(e).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View accessibilityLabel="Review notes" style={[styles.bar, { backgroundColor: colors.surface }]}>
      <View style={styles.barTop}>
        <Icon name="pin" size={14} color={colors.live} />
        <Text numberOfLines={1} style={[styles.counts, { color: colors.fg3 }]}>
          <Text style={{ color: colors.fg, fontWeight: weight.semibold }}>{plural(open, 'open note')}</Text>
          {sent ? ` · ${sent} sent` : ''}
          {resolved.length ? ` · ${resolved.length} resolved` : ''}
        </Text>
        <Button size="compact" label={noteSendLabel(target.pick)} disabled={!open} busy={busy} onPress={send} />
      </View>
      {open > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Send notes to: ${current.label}`}
          accessibilityHint="Picks the thread the open notes go to"
          onPress={() => setPicking(true)}
          style={styles.toggle}
        >
          <Text style={[styles.small, { color: colors.fg3 }]}>Send to</Text>
          <Text numberOfLines={1} style={[styles.small, styles.pick, { color: colors.fg }]}>
            {current.label}
          </Text>
          <Icon name="chevronDown" size={10} color={colors.fg3} />
        </Pressable>
      ) : null}
      {sentTo ? <Text style={[styles.small, { color: colors.fg3 }]}>{`Notes sent to ${sentTo}.`}</Text> : null}
      {error ? <Text accessibilityRole="alert" style={[styles.small, { color: colors.needs }]}>{error}</Text> : null}
      {away.length > 0 ? (
        turn ? (
          <Text style={[styles.small, { color: colors.fg3 }]}>
            {`${plural(away.length, 'note')} ${away.length === 1 ? 'is' : 'are'} on lines this turn did not change. Since base shows ${away.length === 1 ? 'it' : 'them'}.`}
          </Text>
        ) : (
          away.map((n) => <NoteCard key={n.id} note={n} place={null} actions={actions} />)
        )
      ) : null}
      {resolved.length > 0 ? (
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: history }} onPress={() => setHistory((h) => !h)} style={styles.toggle}>
          <View style={{ transform: [{ rotate: history ? '90deg' : '0deg' }] }}>
            <Icon name="chevronRight" size={10} color={colors.fg3} />
          </View>
          <Text style={[styles.small, { color: colors.fg3, fontWeight: weight.semibold }]}>Resolved {resolved.length}</Text>
        </Pressable>
      ) : null}
      {history ? resolved.map((n) => <NoteCard key={n.id} note={n} place={placed.get(n.id) ?? null} actions={actions} />) : null}
      <Sheet visible={picking} title="Send notes to" onClose={() => setPicking(false)}>
        <ScrollView contentContainerStyle={styles.sheet}>
          <OptionGroup>
            {rows.map((r, i) => (
              <OptionRow
                key={r.value}
                label={r.label}
                sub={r.sub}
                selected={r.value === target.pick}
                onPress={() => {
                  target.setPick(r.value);
                  setPicking(false);
                }}
                last={i === rows.length - 1}
              />
            ))}
          </OptionGroup>
        </ScrollView>
      </Sheet>
    </View>
  );
}

/** One note. `inline` sits under its lines. Unresolved with no `place`: its lines are gone, so it quotes them as picked. */
export function NoteCard({ note, place, actions, inline = false }: { note: ReviewNote; place: NotePlace | null; actions: NoteActions; inline?: boolean }) {
  const { colors } = useOmniTheme();
  const state = noteState(note);
  const outdated = !place && state !== 'resolved';
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.body);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = noteLabel(note);
  const name = label.split('/').pop() ?? label;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      return true;
    } catch (e) {
      setError(describeFailure(e).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <View
      accessibilityLabel={`Note on ${label}`}
      style={[styles.card, inline ? [styles.inline, { backgroundColor: colors.elev, borderColor: colors.line }] : { backgroundColor: colors.bg, borderColor: colors.line }]}
    >
      <View style={styles.head}>
        <Icon name={state === 'resolved' ? 'check' : 'pin'} size={12} color={state === 'resolved' ? colors.fg3 : colors.live} />
        <Text numberOfLines={1} style={[styles.name, { color: colors.fg3 }]}>
          {name}
        </Text>
        {outdated ? <Chip label="Outdated" tone="outline" /> : place?.moved ? <Chip label="Moved" tone="outline" /> : null}
        {state === 'sent' ? <Chip label="Sent" /> : null}
        {state === 'resolved' ? <Chip label="Resolved" /> : null}
        <View style={styles.spacer} />
        {!editing ? (
          <>
            {state === 'resolved' ? (
              <IconPress icon="undo" label="Reopen note" disabled={busy} onPress={() => run(() => actions.update(note.id, { resolved: false }))} />
            ) : (
              <>
                <IconPress
                  icon="pencil"
                  label="Edit note"
                  disabled={busy}
                  onPress={() => {
                    setDraft(note.body);
                    setEditing(true);
                  }}
                />
                <IconPress icon="check" label="Resolve note" disabled={busy} onPress={() => run(() => actions.update(note.id, { resolved: true }))} />
              </>
            )}
            {confirmDelete ? (
              <Button size="compact" variant="secondary" label="Delete?" accessibilityLabel="Delete note" disabled={busy} onPress={() => run(() => actions.remove(note.id))} />
            ) : (
              <IconPress icon="trash" label="Delete note" disabled={busy} onPress={() => setConfirmDelete(true)} />
            )}
          </>
        ) : null}
      </View>
      {editing ? (
        <View style={styles.edit}>
          <TextInput
            accessibilityLabel="Note"
            multiline
            autoFocus
            maxLength={NOTE_BODY_MAX}
            value={draft}
            onChangeText={(t) => {
              setDraft(t);
              setError(null);
            }}
            style={[styles.input, { color: colors.fg, backgroundColor: colors.surface }]}
          />
          <View style={styles.actions}>
            <View style={styles.action}>
              <Button variant="secondary" size="small" label="Cancel" onPress={() => setEditing(false)} />
            </View>
            <View style={styles.action}>
              <Button
                size="small"
                label="Save"
                busy={busy}
                disabled={!draft.trim()}
                onPress={async () => {
                  if (await run(() => actions.update(note.id, { body: draft }))) setEditing(false);
                }}
              />
            </View>
          </View>
        </View>
      ) : (
        <Text style={[styles.body, { color: colors.fg }]}>{note.body}</Text>
      )}
      {outdated ? (
        <Text style={[styles.quote, { color: colors.fg3, backgroundColor: colors.surface }]}>
          {note.anchor.rows.map((r) => `${r.kind === 'add' ? '+' : r.kind === 'del' ? '-' : ' '}${r.text}`).join('\n')}
        </Text>
      ) : null}
      {error ? <Text accessibilityRole="alert" style={[styles.small, { color: colors.needs }]}>{error}</Text> : null}
    </View>
  );
}

function IconPress({ icon, label, onPress, disabled }: { icon: 'pencil' | 'check' | 'trash' | 'undo'; label: string; onPress: () => void; disabled?: boolean }) {
  const { colors } = useOmniTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} hitSlop={8} style={({ pressed }) => [styles.icon, { opacity: disabled ? 0.4 : pressed ? 0.6 : 1 }]}>
      <Icon name={icon} size={15} color={colors.fg3} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    marginHorizontal: space.s6,
    marginBottom: space.s6,
    borderRadius: radius.lg,
    padding: space.s6,
    gap: space.s4,
  },
  barTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s4,
  },
  counts: {
    flex: 1,
    fontSize: fontSize.small,
  },
  small: {
    fontSize: fontSize.caption,
    lineHeight: Math.round(fontSize.caption * lineHeight.body),
  },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s3,
    minHeight: minTarget,
  },
  pick: {
    flexShrink: 1,
    fontWeight: weight.semibold,
  },
  sheet: {
    paddingVertical: space.s6,
    paddingBottom: space.s11,
  },
  card: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.s5,
    paddingVertical: space.s4,
    gap: space.s3,
  },
  inline: {
    marginHorizontal: space.s4,
    marginVertical: space.s4,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s3,
  },
  name: {
    flexShrink: 1,
    fontFamily: mono,
    fontSize: fontSize.meta,
  },
  spacer: {
    flex: 1,
  },
  icon: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    fontSize: fontSize.body,
    lineHeight: Math.round(fontSize.body * lineHeight.body),
  },
  quote: {
    fontFamily: mono,
    fontSize: fontSize.meta,
    borderRadius: radius.sm,
    padding: space.s3,
  },
  edit: {
    gap: space.s4,
  },
  input: {
    minHeight: 72,
    borderRadius: radius.md,
    paddingHorizontal: space.s6,
    paddingTop: space.s4,
    paddingBottom: space.s4,
    fontSize: fontSize.input,
    textAlignVertical: 'top',
  },
  actions: {
    flexDirection: 'row',
    gap: space.s4,
  },
  action: {
    flex: 1,
  },
});
