import { OmniHttpError, type OmniApi } from '@omni/client-core';
import { accountTitle, HARNESS_ROWS, planWindows, slotSummary, usageRows, waitingTitle } from '@omni/shared/account-usage.ts';
import { resetSentence } from '@omni/shared/usage-reset.ts';
import { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useLink, useLiveHub } from '../../live/react';
import { useMinuteClock } from '../../live/use-minute-clock';
import { useRemote } from '../../live/use-remote';
import { fontSize, minTarget, radius, space, useOmniTheme, weight } from '../../theme';
import { HarnessLogo } from '../../ui/Brand';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { Text } from '../../ui/Text';

const harnessIds = HARNESS_ROWS.map(({ id }) => id);
const names: Record<string, string> = Object.fromEntries(HARNESS_ROWS.map(({ id, name }) => [id, name]));

const loadUsage = async (api: OmniApi) => {
  const [status, accounts] = await Promise.all([
    api.status(),
    api.accounts().catch((err: unknown) => {
      // Older servers only report harness-level usage in status.
      if (err instanceof OmniHttpError && err.failure.kind === 'http' && err.failure.status === 404) return null;
      throw err;
    }),
  ]);
  return { rows: usageRows(harnessIds, accounts, accounts?.usage ?? [], status.usage), slots: slotSummary(status.slots) };
};

export function ActivityUsage({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const { colors } = useOmniTheme();
  return (
    <View style={[styles.card, { backgroundColor: colors.surface }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={onToggle}
        style={({ pressed }) => [styles.trigger, pressed && { backgroundColor: colors.wash }]}
      >
        <Text style={[styles.title, { color: colors.fg }]}>Usage</Text>
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={16} color={colors.fg3} />
      </Pressable>
      {open && <UsageDetails />}
    </View>
  );
}

function UsageDetails() {
  const { colors } = useOmniTheme();
  const hub = useLiveHub();
  const { kind: link } = useLink();
  const previousLink = useRef(link);
  const now = useMinuteClock();
  const { data, error, reload } = useRemote(loadUsage);
  useEffect(() => {
    if (link === 'live' && previousLink.current !== 'live') void reload();
    previousLink.current = link;
  }, [link, reload]);
  useEffect(() => hub.watchFeed((message) => {
    if (!message || typeof message !== 'object' || !('type' in message)) return;
    if (message.type === 'account_usage' || message.type === 'accounts' || message.type === 'usage') void reload();
  }), [hub, reload]);

  return (
    <View style={styles.details}>
      {error ? (
        <View>
          <Text style={{ color: colors.fg3 }}>{data ? 'Could not refresh usage.' : 'Could not load usage.'}</Text>
          <Button label="Retry" size="small" variant="ghost" onPress={reload} />
        </View>
      ) : !data && <Text style={{ color: colors.fg3 }}>Loading usage…</Text>}
      {data?.rows.length === 0 && <Text style={{ color: colors.fg3 }}>No usage data.</Text>}
      {data?.rows.map((row) => {
        const name = names[row.harness] ?? row.harness;
        const windows = planWindows(row.usage);
        return (
          <View key={row.key} style={[styles.account, { borderColor: colors.line }]}>
            <View style={styles.accountTitle}>
              <HarnessLogo harness={row.harness} />
              <Text accessibilityRole="header" style={[styles.title, { color: colors.fg }]}>{name}</Text>
            </View>
            {row.account && <Text style={{ color: colors.fg2 }}>{accountTitle(row.account)}</Text>}
            {windows.map(({ label, fraction, resetsAt, detail }) => {
              const reset = resetSentence(resetsAt, now);
              const pct = Math.round(fraction * 100);
              const filled = pct > 0 ? Math.max(1, Math.round(fraction * 24)) : 0;
              return (
                <View key={label} style={styles.window}>
                  <View style={styles.windowTitle}>
                    <Text style={{ color: colors.fg }}>{label}</Text>
                    <Text style={{ color: colors.fg, fontVariant: ['tabular-nums'] }}>{pct}% used</Text>
                  </View>
                  <View aria-hidden style={styles.ticks}>
                    {Array.from({ length: 24 }, (_, i) => (
                      <View key={i} style={[styles.tick, { backgroundColor: i < filled ? (fraction >= 0.9 ? colors.needs : colors.fg) : colors.surface3 }]} />
                    ))}
                  </View>
                  {detail ? <Text style={{ color: colors.fg3 }}>{detail}</Text> : null}
                  {reset && <Text style={{ color: colors.fg3 }}>{reset}</Text>}
                </View>
              );
            })}
            {!windows.length && <Text style={{ color: colors.fg3 }}>{row.waiting && row.account ? waitingTitle(row.harness, name, row.account) : 'No data'}</Text>}
          </View>
        );
      })}
      {data?.slots ? <Text style={[styles.slots, { borderColor: colors.line, color: colors.fg3 }]}>{data.slots}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.xl, overflow: 'hidden' },
  trigger: { minHeight: minTarget, paddingHorizontal: space.s6, paddingVertical: space.s4, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: fontSize.body, fontWeight: weight.medium },
  details: { paddingHorizontal: space.s6, paddingBottom: space.s6 },
  account: { borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: space.s5, gap: space.s2 },
  accountTitle: { flexDirection: 'row', alignItems: 'center', gap: space.s4 },
  window: { marginTop: space.s1, gap: space.s1 },
  windowTitle: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', columnGap: space.s4 },
  ticks: { flexDirection: 'row', height: 12, gap: space.s1 },
  tick: { flex: 1, borderRadius: 1 },
  slots: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: space.s4, fontSize: fontSize.caption, fontVariant: ['tabular-nums'] },
});
