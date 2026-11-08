import type { OmniApi, ServerOption } from '@omni/client-core';
import type { ReactNode } from 'react';
import { ActivityIndicator, RefreshControl, StyleSheet, Switch, View, type KeyboardTypeOptions } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';

import { ListHeading } from '../components/ListHeading';
import { StatusDot, type Glyph } from '../components/StatusDot';
import { usePullRefresh } from '../live/react';
import { useRemote } from '../live/use-remote';
import { fontSize, lineHeight, minTarget, mono, space, useOmniTheme, weight } from '../theme';
import { Button } from '../ui/Button';
import { Callout } from '../ui/Callout';
import { GroupedList, ListRow } from '../ui/GroupedList';
import { Icon } from '../ui/Icon';
import { Text, TextInput } from '../ui/Text';

// The pieces every Settings screen on the phone is made of: a scrolling page that keeps a focused field above the
// keyboard, a titled group of rows, a switch row, a text field row, a note under a group, a save row, and the .env
// options the server reads at start, shown as they are.

export function SettingsPage({ children, onRefresh }: { children: ReactNode; onRefresh?: () => Promise<unknown> }) {
  const { colors } = useOmniTheme();
  const pull = usePullRefresh(onRefresh ? () => onRefresh() : undefined);
  return (
    <KeyboardAwareScrollView
      style={{ backgroundColor: colors.bg }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.page}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      bottomOffset={space.s10}
      refreshControl={onRefresh ? <RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={colors.fg3} /> : undefined}
    >
      {children}
    </KeyboardAwareScrollView>
  );
}

/** A titled group of rows with an optional note under it. */
export function Group({ title, footer, children }: { title?: string; footer?: string | null; children: ReactNode }) {
  return (
    <View style={styles.group}>
      {title ? <ListHeading inset>{title}</ListHeading> : null}
      <GroupedList>{children}</GroupedList>
      {footer ? <Footnote>{footer}</Footnote> : null}
    </View>
  );
}

export function Footnote({ children }: { children: ReactNode }) {
  const { colors } = useOmniTheme();
  return <Text style={[styles.footnote, { color: colors.fg3 }]}>{children}</Text>;
}

/** A row with a switch. The whole row is the switch's label. */
export function SwitchRow({
  title,
  detail,
  value,
  onValueChange,
  disabled,
  first,
}: {
  title: string;
  detail?: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
  disabled?: boolean;
  first?: boolean;
}) {
  const { colors } = useOmniTheme();
  return (
    <View style={[styles.row, !first && { borderTopColor: colors.line, borderTopWidth: StyleSheet.hairlineWidth }]}>
      <View style={styles.grow}>
        <Text style={[styles.title, { color: colors.fg, opacity: disabled ? 0.5 : 1 }]}>{title}</Text>
        {detail ? <Text style={[styles.detail, { color: colors.fg3 }]}>{detail}</Text> : null}
      </View>
      <Switch accessibilityLabel={title} value={value} disabled={disabled} onValueChange={onValueChange} />
    </View>
  );
}

export interface InputRowProps {
  label: string;
  value: string;
  onChangeText?: (text: string) => void;
  placeholder?: string;
  hint?: string | null;
  multiline?: boolean;
  /** Paths, ids and commands: monospaced, no autocorrect or capitals. */
  code?: boolean;
  keyboardType?: KeyboardTypeOptions;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  /** Shown, not edited: the value as text in the field's place. */
  readOnly?: boolean;
  secure?: boolean;
  first?: boolean;
  /** Beside the label: where the value comes from. */
  origin?: string;
}

/** A labelled text field inside a group, its label above the value as iOS forms with long values draw them. */
export function InputRow({ label, value, onChangeText, placeholder, hint, multiline, code, keyboardType, autoCapitalize, readOnly, secure, first, origin }: InputRowProps) {
  const { colors } = useOmniTheme();
  const font = code ? { fontFamily: mono, fontSize: fontSize.body, fontWeight: '400' as const } : null;
  // A path or id shown, not edited, reads smaller with room between wrapped lines.
  const shownCode = code ? { fontFamily: mono, fontSize: fontSize.caption, lineHeight: Math.round(fontSize.caption * 1.4), fontWeight: '400' as const } : null;
  return (
    <View style={[styles.field, !first && { borderTopColor: colors.line, borderTopWidth: StyleSheet.hairlineWidth }]}>
      <View style={styles.labelRow}>
        <Text style={[styles.label, { color: colors.fg3 }]}>{label}</Text>
        {origin ? <Text style={[styles.origin, { color: colors.fg4 }]}>{origin}</Text> : null}
      </View>
      {readOnly ? (
        <Text selectable style={[styles.input, shownCode, { color: value ? colors.fg2 : colors.fg4 }]}>
          {value || placeholder || 'Not set'}
        </Text>
      ) : (
        <TextInput
          accessibilityLabel={label}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.fg4}
          multiline={multiline}
          keyboardType={keyboardType}
          autoCapitalize={code ? 'none' : autoCapitalize}
          autoCorrect={code ? false : undefined}
          spellCheck={code ? false : undefined}
          secureTextEntry={secure}
          style={[styles.input, multiline && styles.multiline, font, { color: colors.fg }]}
        />
      )}
      {hint ? <Text style={[styles.detail, { color: colors.fg3 }]}>{hint}</Text> : null}
    </View>
  );
}

/** One choice of a group, checked when picked, as iOS Settings lists choices. */
export function ChoiceRow({ title, detail, selected, disabled, first, onPress }: { title: string; detail?: string; selected: boolean; disabled?: boolean; first?: boolean; onPress: () => void }) {
  const { colors } = useOmniTheme();
  return (
    <ListRow
      first={first}
      title={title}
      detail={detail}
      disabled={disabled}
      onPress={onPress}
      trailing={selected ? <Icon name="check" size={16} color={colors.fg} /> : <View style={styles.check} />}
      accessibilityHint={selected ? 'Selected' : undefined}
    />
  );
}

/** A row's trailing status: the dot, then its words. */
export function StatusValue({ glyph, text }: { glyph: Glyph; text: string }) {
  const { colors } = useOmniTheme();
  return (
    <View style={styles.status}>
      <StatusDot glyph={glyph} size={7} />
      <Text numberOfLines={2} style={[styles.statusText, { color: colors.fg3 }]}>
        {text}
      </Text>
    </View>
  );
}

/** Save under a form, with what happened: Saved, or the server's refusal. */
export function SaveRow({ label = 'Save', busy, disabled, error, saved, onPress }: { label?: string; busy: boolean; disabled: boolean; error: string | null; saved: boolean; onPress: () => void }) {
  const { colors } = useOmniTheme();
  return (
    <View style={styles.save}>
      {error ? <Callout message={error} /> : null}
      <Button label={label} busy={busy} disabled={disabled} onPress={onPress} />
      {saved && !error ? <Text style={[styles.footnote, styles.center, { color: colors.fg3 }]}>Saved</Text> : null}
    </View>
  );
}

const loadServerOptions = (api: OmniApi) => api.serverOptions();

/**
 * The server's .env options for one section, read-only: the server reads them when it starts, so they change in .env on
 * that machine and take a restart. The same list the Web UI folds under Server options.
 */
export function ServerOptionsGroup({ section, title = 'Server options' }: { section: ServerOption['section']; title?: string }) {
  const { colors } = useOmniTheme();
  const remote = useRemote(loadServerOptions);
  const rows = remote.data?.options.filter((o) => o.section === section) ?? [];
  if (remote.error && !remote.data) return <Footnote>{`Couldn't load the server options: ${remote.error}`}</Footnote>;
  if (!remote.data) return <ActivityIndicator color={colors.fg3} />;
  if (rows.length === 0) return null;
  return (
    <Group title={title} footer="Read from .env when the server starts. Change one in .env on that machine and restart the server.">
      {rows.map((o, i) => (
        <View key={o.env} style={[styles.row, i > 0 && { borderTopColor: colors.line, borderTopWidth: StyleSheet.hairlineWidth }]}>
          <View style={styles.grow}>
            <Text style={[styles.title, { color: colors.fg }]}>{o.label}</Text>
            <Text style={[styles.detail, { color: colors.fg3 }]}>{o.hint}</Text>
            <Text style={[styles.code, { color: colors.fg4 }]}>{o.env}</Text>
          </View>
          <View style={styles.trailing}>
            <Text style={[styles.value, { color: colors.fg2 }]}>{o.value}</Text>
            <Text style={[styles.origin, { color: colors.fg4 }]}>{o.source === 'env' ? 'Set in .env' : 'Default'}</Text>
          </View>
        </View>
      ))}
    </Group>
  );
}

const styles = StyleSheet.create({
  page: {
    paddingHorizontal: space.s8,
    paddingTop: space.s4,
    paddingBottom: space.s11,
    gap: space.s6,
  },
  group: {
    gap: space.s2,
  },
  footnote: {
    fontSize: fontSize.small,
    lineHeight: Math.round(fontSize.small * lineHeight.body),
    paddingHorizontal: space.s2,
    paddingTop: space.s2,
  },
  center: {
    textAlign: 'center',
  },
  row: {
    minHeight: minTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s7,
    paddingHorizontal: space.s8,
    paddingVertical: space.s6,
  },
  grow: {
    flex: 1,
    gap: space.s1,
  },
  title: {
    fontSize: fontSize.subhead,
  },
  detail: {
    fontSize: fontSize.small,
    lineHeight: Math.round(fontSize.small * lineHeight.body),
  },
  code: {
    fontFamily: mono,
    fontSize: fontSize.meta,
    fontWeight: '400',
  },
  check: {
    width: 16,
  },
  trailing: {
    alignItems: 'flex-end',
    gap: space.s1,
    maxWidth: '40%',
  },
  value: {
    fontSize: fontSize.body,
    fontWeight: weight.medium,
  },
  field: {
    paddingHorizontal: space.s8,
    paddingVertical: space.s5,
    gap: space.s2,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s4,
  },
  label: {
    flex: 1,
    fontSize: fontSize.meta,
    fontWeight: weight.medium,
  },
  origin: {
    fontSize: fontSize.meta,
  },
  input: {
    fontSize: fontSize.input,
    minHeight: 28,
    padding: 0,
  },
  multiline: {
    minHeight: 84,
    textAlignVertical: 'top',
  },
  save: {
    gap: space.s4,
  },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s3,
    flexShrink: 1,
    maxWidth: '60%',
  },
  statusText: {
    fontSize: fontSize.body,
    flexShrink: 1,
  },
});
