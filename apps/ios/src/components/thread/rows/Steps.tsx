import { toolLabel, toolSummary, type ToolCall } from '@omni/shared/transcript-fold.ts';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { callDetail } from '../../../thread/call-detail';
import type { ThreadRow } from '../../../thread/rows';
import { fontSize, minTarget, radius, space, useOmniTheme } from '../../../theme';
import { type DotTone, StatusDot } from '../../StatusDot';
import { Markdown } from '../Markdown';
import { useRowActions } from './actions';

type Of<K extends ThreadRow['kind']> = { row: Extract<ThreadRow, { kind: K }> };

const MONO = 'Menlo';
const SHOWN_LINES = 40;

type CallState = 'running' | 'stopped' | 'failed' | 'done';

function stateOf(call: ToolCall, running: boolean): CallState {
  if (!call.result) return running ? 'running' : 'stopped';
  return call.result.is_error ? 'failed' : 'done';
}

const TONE: Record<CallState, DotTone> = { running: 'ok', stopped: 'muted', failed: 'warn', done: 'muted' };
const WORD: Record<CallState, string | null> = { running: 'Running', stopped: 'Stopped', failed: 'Failed', done: null };

const peek = (call: ToolCall): string => (call.result && (call.result.is_error || call.name === 'Bash') ? call.result.text.trim().split('\n').slice(0, 3).join('\n').slice(0, 240) : '');

export function NoteRow({ row }: Of<'note'>) {
  const { colors } = useOmniTheme();
  const { loadWhole, openThread } = useRowActions();
  return (
    <View style={[styles.note, { borderColor: colors.line }]}>
      <Markdown text={row.text} onOpenThread={openThread} />
      {row.clipped !== null ? (
        <Pressable accessibilityRole="button" onPress={() => loadWhole(row.clipped!)} hitSlop={8} style={styles.more}>
          <Text style={[styles.small, { color: colors.fg }]}>Load whole message</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function ModRow({ row }: Of<'mod'>) {
  const { colors } = useOmniTheme();
  return (
    <View style={styles.indent}>
      {row.lines.map((l) => (
        <Text key={l.key} numberOfLines={2} style={[styles.small, { color: colors.fg3 }]}>
          {`${l.plugin} · ${l.text}`}
        </Text>
      ))}
    </View>
  );
}

export function CallRow({ row }: Of<'call'>) {
  const { colors } = useOmniTheme();
  const { toggleCall, cwd } = useRowActions();
  const { call, depth, open } = row;
  const state = stateOf(call, row.running);
  const summary = toolSummary(call, cwd);
  const word = WORD[state];
  const preview = open ? '' : peek(call);
  return (
    <View style={[styles.call, { marginLeft: depth * space.s8 }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${toolLabel(call.name)} ${summary}`.trim()}
        onPress={() => toggleCall(call.id)}
        style={({ pressed }) => [styles.head, pressed && { backgroundColor: colors.surface2 }]}
      >
        <View style={styles.dot}>
          <StatusDot tone={TONE[state]} />
        </View>
        <View style={styles.grow}>
          <Text numberOfLines={1} style={[styles.name, { color: colors.fg2 }]}>
            {toolLabel(call.name)}
            {word ? <Text style={{ color: colors.fg3 }}>{`  ${word}`}</Text> : null}
          </Text>
          {summary ? (
            <Text numberOfLines={open ? 3 : 1} style={[styles.summary, { color: colors.fg3 }]}>
              {summary}
            </Text>
          ) : null}
        </View>
      </Pressable>
      {preview ? (
        <Text numberOfLines={3} style={[styles.preview, { color: colors.fg3, backgroundColor: colors.surface }]}>
          {preview}
        </Text>
      ) : null}
      {open ? <CallDetail call={call} /> : null}
    </View>
  );
}

function CallDetail({ call }: { call: ToolCall }) {
  const { colors } = useOmniTheme();
  const { loadWhole, loadOutput } = useRowActions();
  const detail = callDetail(call);
  const result = call.result;
  const [more, setMore] = useState<{ text: string; next: number | null; failed: boolean; busy: boolean } | null>(null);

  const stored = result?.output;
  const previewLength = result ? Array.from(result.text).length : 0;
  const hasMore = !!stored && stored.chars > previewLength && (more === null || more.next !== null);

  const fetchMore = async () => {
    if (!result) return;
    setMore((m) => ({ text: m?.text ?? '', next: m?.next ?? previewLength, failed: false, busy: true }));
    try {
      const chunk = await loadOutput(result.event, more?.next ?? previewLength);
      setMore((m) => ({ text: (m?.text ?? '') + chunk.text, next: chunk.next, failed: false, busy: false }));
    } catch {
      setMore((m) => ({ text: m?.text ?? '', next: m?.next ?? previewLength, failed: true, busy: false }));
    }
  };

  const text = result ? result.text + (more?.text ?? '') : '';
  const lines = text.trimEnd().split('\n');
  const cut = more === null && lines.length > SHOWN_LINES;

  return (
    <View style={[styles.detail, { backgroundColor: colors.surface, borderColor: colors.line }]}>
      {detail.length ? (
        <View>
          {detail.map((l, i) => (
            <Text key={i} style={[styles.code, { color: l.tone === 'del' ? colors.fg3 : colors.fg }, l.tone && { backgroundColor: colors.surface3 }]}>
              {`${l.tone === 'add' ? '+ ' : l.tone === 'del' ? '− ' : ''}${l.text}`}
            </Text>
          ))}
        </View>
      ) : null}
      {result && text.trim() ? (
        <Text selectable style={[styles.code, { color: result.is_error ? colors.fg : colors.fg2 }, detail.length > 0 && styles.sep]}>
          {(cut ? lines.slice(0, SHOWN_LINES) : lines).join('\n')}
          {cut ? `\n… ${lines.length - SHOWN_LINES} more lines` : ''}
        </Text>
      ) : null}
      {!result ? <Text style={[styles.small, { color: colors.fg3 }]}>No result yet.</Text> : null}
      {result?.clipped ? (
        <Pressable accessibilityRole="button" onPress={() => loadWhole(result.event)} hitSlop={8} style={styles.more}>
          <Text style={[styles.small, { color: colors.fg }]}>Load whole result</Text>
        </Pressable>
      ) : null}
      {hasMore ? (
        <Pressable accessibilityRole="button" disabled={more?.busy} onPress={() => void fetchMore()} hitSlop={8} style={styles.more}>
          <Text style={[styles.small, { color: colors.fg }]}>
            {more?.busy ? 'Loading…' : more?.failed ? 'Could not load. Try again' : `Load more output · ${stored.lines} lines in all`}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  note: { borderLeftWidth: 2, paddingLeft: space.s6 },
  more: { minHeight: 32, justifyContent: 'center' },
  small: { fontSize: 12.5, lineHeight: 18 },
  indent: { paddingLeft: space.s8, gap: 2 },
  call: { gap: space.s2 },
  head: { minHeight: minTarget - 8, flexDirection: 'row', alignItems: 'flex-start', gap: space.s6, paddingVertical: space.s2, borderRadius: radius.md - 4 },
  dot: { paddingTop: 6 },
  grow: { flex: 1, gap: 2 },
  name: { fontSize: fontSize.body - 0.5, fontWeight: '500' },
  summary: { fontSize: 12.5, lineHeight: 17, fontFamily: MONO },
  preview: { marginLeft: space.s8, borderRadius: 8, paddingHorizontal: space.s4, paddingVertical: space.s2, fontFamily: MONO, fontSize: 11.5, lineHeight: 16, overflow: 'hidden' },
  detail: { marginLeft: space.s8, borderRadius: radius.md - 4, borderWidth: StyleSheet.hairlineWidth, padding: space.s4, gap: space.s2 },
  code: { fontFamily: MONO, fontSize: 11.5, lineHeight: 16 },
  sep: { paddingTop: space.s4 },
});
