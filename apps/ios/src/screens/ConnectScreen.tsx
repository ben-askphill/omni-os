import { useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';

import type { RootScreenProps } from '../navigation/types';
import { describePairingError } from '../pairing/messages';
import { usePairing } from '../pairing/PairingProvider';
import { normalizePairingCode, normalizeServerOrigin } from '../pairing/pairingInput';
import { fontSize, lineHeight, space, useOmniTheme } from '../theme';
import { Button } from '../ui/Button';
import { Callout } from '../ui/Callout';
import { SegmentedControl } from '../ui/SegmentedControl';
import { CodeForm } from './connect/CodeForm';
import { ScanPanel } from './connect/ScanPanel';

const DEFAULT_DEVICE_NAME = 'iPhone';
const MAX_DEVICE_NAME_LENGTH = 100;

type Mode = 'scan' | 'code';

const MODES = [
  { value: 'scan', label: 'Scan QR' },
  { value: 'code', label: 'Enter code' },
] as const;

export function ConnectScreen({ navigation }: RootScreenProps<'Connect' | 'AddServer'>) {
  const { colors } = useOmniTheme();
  const { notice, clearNotice, pair, servers } = usePairing();
  const [mode, setMode] = useState<Mode>('scan');
  const [deviceName, setDeviceName] = useState(DEFAULT_DEVICE_NAME);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hadServers = servers.length > 0;

  async function submit(rawOrigin: string, rawCode: string) {
    setBusy(true);
    setError(null);
    try {
      await pair({
        origin: normalizeServerOrigin(rawOrigin),
        code: normalizePairingCode(rawCode),
        name: deviceName.trim().slice(0, MAX_DEVICE_NAME_LENGTH) || DEFAULT_DEVICE_NAME,
      });
      // With no servers before, this is the Connect route, which the navigator drops for Home by itself.
      if (hadServers) navigation.popToTop();
    } catch (caught) {
      setError(describePairingError(caught));
    } finally {
      setBusy(false);
    }
  }

  function changeMode(next: Mode) {
    setError(null);
    setMode(next);
  }

  return (
    <ScrollView
      className="flex-1"
      style={{ backgroundColor: colors.bg }}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.content}
    >
      {notice !== null && (
        <Callout message={notice}>
          <Button label="Dismiss" variant="secondary" onPress={clearNotice} />
        </Callout>
      )}

      <Text style={[styles.body, { color: colors.fg3 }]}>
        Pair this phone with your Omni server. Make a pairing code in Omni on your computer.
      </Text>

      <SegmentedControl options={MODES} value={mode} onChange={changeMode} />

      {mode === 'scan' ? (
        <ScanPanel
          deviceName={deviceName}
          onDeviceNameChange={setDeviceName}
          busy={busy}
          onPair={(origin, code) => void submit(origin, code)}
          onUseCode={() => changeMode('code')}
        />
      ) : (
        <CodeForm
          deviceName={deviceName}
          onDeviceNameChange={setDeviceName}
          busy={busy}
          onPair={(origin, code) => void submit(origin, code)}
        />
      )}

      {error !== null && <Callout message={error} />}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: space.s9,
    paddingTop: space.s9,
    paddingBottom: space.s11,
    gap: space.s8,
  },
  body: {
    fontSize: fontSize.body,
    lineHeight: Math.round(fontSize.body * lineHeight.body),
  },
});
