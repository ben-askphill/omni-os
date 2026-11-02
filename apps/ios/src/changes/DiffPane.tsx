import type { ChangeGroupView } from '@omni/shared/changes-view.ts';
import { heldPick, holdPress, noPick, pickedLines, type HeldPick } from '@omni/shared/diff-pick.ts';
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { fontSize, lineHeight, space, useOmniTheme } from '../theme';
import { FileHeader, GroupHeader, LineRow, MoreRow, NoteRow } from './DiffRows';
import { changeRows, FRESH_ROWS, pickedRange, showAll, toggleFile, type ChangeRow } from './rows';
import { SelectionDock, type PickSource } from './SelectionDock';

export interface PaneEmpty {
  title: string;
  body: string;
}

interface DiffPaneProps {
  threadId: string;
  /** What is on screen: 'base', or a turn's id. Another scope has no pick. */
  scope: string;
  groups: readonly ChangeGroupView[];
  total: number;
  header: ReactNode;
  empty: PaneEmpty;
  /** Where the diff came from, for the lines sent to the agent. Null when it cannot be sent. */
  source: PickSource | null;
  refreshing: boolean;
  onRefresh: () => void;
  /** The lines are on the thread's next message. */
  onAdded: () => void;
  headerOffset: number;
}

const keyOf = (row: ChangeRow) => row.id;

export function DiffPane({ threadId, scope, groups, total, header, empty, source, refreshing, onRefresh, onAdded, headerOffset }: DiffPaneProps) {
  const { colors } = useOmniTheme();
  const [rowsState, setRowsState] = useState(FRESH_ROWS);
  const [held, setHeld] = useState<HeldPick>(() => noPick(scope));

  const files = useMemo(() => new Map(groups.flatMap((g) => g.files).map((f) => [f.key, f] as const)), [groups]);
  const filesRef = useRef(files);
  filesRef.current = files;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;

  const pick = heldPick(held, scope);
  const picked = useMemo(() => pickedLines(pick, held.diff, groups), [pick, held.diff, groups]);
  const liveRange = useMemo(() => {
    const f = picked && pick ? files.get(pick.file) : undefined;
    return f && pick ? { file: pick.file, ...pickedRange(pick, pick.file, f.diff.lines)! } : null;
  }, [picked, pick, files]);

  const rows = useMemo(() => changeRows(groups, total, rowsState), [groups, total, rowsState]);

  const press = useCallback((fileKey: string, index: number) => {
    const f = filesRef.current.get(fileKey);
    if (f) setHeld((h) => holdPress(h, scopeRef.current, f, index, true));
  }, []);
  const toggle = useCallback((fileKey: string) => {
    const f = filesRef.current.get(fileKey);
    if (f) setRowsState((s) => toggleFile(s, f, total));
  }, [total]);
  const more = useCallback((fileKey: string) => setRowsState((s) => showAll(s, fileKey)), []);
  const clear = useCallback(() => setHeld(noPick(scopeRef.current)), []);
  const added = useCallback(() => {
    clear();
    onAdded();
  }, [clear, onAdded]);

  const renderItem = useCallback(
    ({ item }: { item: ChangeRow }) => {
      switch (item.type) {
        case 'group':
          return <GroupHeader title={item.title} count={item.count} />;
        case 'file':
          return <FileHeader row={item} onToggle={toggle} />;
        case 'line': {
          const on = liveRange !== null && liveRange.file === item.fileKey && item.index >= liveRange.from && item.index <= liveRange.to;
          return <LineRow fileKey={item.fileKey} index={item.index} line={item.line} width={item.width} picked={on} onPress={press} />;
        }
        case 'note':
          return <NoteRow text={item.text} />;
        case 'more':
          return <MoreRow fileKey={item.fileKey} hidden={item.hidden} onShow={more} />;
        case 'truncated':
          return <NoteRow text="More files changed than are listed here." />;
      }
    },
    [liveRange, press, toggle, more],
  );

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={headerOffset} style={styles.pane}>
      <FlatList
        data={rows}
        keyExtractor={keyOf}
        renderItem={renderItem}
        extraData={liveRange}
        initialNumToRender={30}
        maxToRenderPerBatch={40}
        windowSize={7}
        ListHeaderComponent={<>{header}</>}
        ListEmptyComponent={<Empty {...empty} />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.fg3} />}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.list}
      />
      {picked && source ? <SelectionDock threadId={threadId} picked={picked} source={source} onClear={clear} onAdded={added} /> : null}
    </KeyboardAvoidingView>
  );
}

function Empty({ title, body }: PaneEmpty) {
  const { colors } = useOmniTheme();
  return (
    <View style={styles.empty}>
      <Text style={[styles.emptyTitle, { color: colors.fg }]}>{title}</Text>
      <Text style={[styles.emptyBody, { color: colors.fg3 }]}>{body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pane: {
    flex: 1,
  },
  list: {
    paddingBottom: space.s10,
  },
  empty: {
    paddingHorizontal: space.s9,
    paddingTop: space.s10,
    gap: space.s4,
  },
  emptyTitle: {
    fontSize: fontSize.heading,
    fontWeight: '600',
  },
  emptyBody: {
    fontSize: fontSize.body,
    lineHeight: Math.round(fontSize.body * lineHeight.body),
  },
});
