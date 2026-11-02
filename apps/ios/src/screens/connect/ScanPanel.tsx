import { CameraView, useCameraPermissions } from 'expo-camera';
import { useEffect, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';

import { describePairingError } from '../../pairing/messages';
import { parsePairingQr } from '../../pairing/pairingInput';
import { Button } from '../../ui/Button';
import { Callout } from '../../ui/Callout';
import { Field } from '../../ui/Field';
import { fontSize, lineHeight, radius, space, useOmniTheme } from '../../theme';

type Scan =
  | { kind: 'idle' }
  | { kind: 'confirm'; origin: string; code: string }
  | { kind: 'rejected'; message: string };

interface ScanPanelProps {
  deviceName: string;
  onDeviceNameChange: (name: string) => void;
  busy: boolean;
  onPair: (origin: string, code: string) => void;
  onUseCode: () => void;
}

export function ScanPanel({ deviceName, onDeviceNameChange, busy, onPair, onUseCode }: ScanPanelProps) {
  const { colors } = useOmniTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [cameraAvailable, setCameraAvailable] = useState<boolean | null>(null);
  const [scan, setScan] = useState<Scan>({ kind: 'idle' });

  useEffect(() => {
    CameraView.isAvailableAsync().then(setCameraAvailable, () => setCameraAvailable(false));
  }, []);

  if (scan.kind === 'confirm') {
    return (
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <Text accessibilityRole="header" style={[styles.confirmTitle, { color: colors.fg }]}>
          Pair with {scan.origin}?
        </Text>
        <Text style={[styles.body, { color: colors.fg3 }]}>
          Only continue if this is the address of your own Omni server.
        </Text>
        <Field label="Device name" value={deviceName} onChangeText={onDeviceNameChange} />
        <Button label="Pair" busy={busy} onPress={() => onPair(scan.origin, scan.code)} />
        <Button
          label="Scan again"
          variant="secondary"
          disabled={busy}
          onPress={() => setScan({ kind: 'idle' })}
        />
      </View>
    );
  }

  if (cameraAvailable === null || permission === null) return null;

  if (!cameraAvailable) {
    return (
      <View style={styles.stack}>
        <Callout message="This device has no camera. The iOS Simulator has none. Enter the code instead." />
        <Button label="Enter code" onPress={onUseCode} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.stack}>
        <Text style={[styles.body, { color: colors.fg3 }]}>
          {permission.canAskAgain
            ? 'Omni OS needs the camera to scan the pairing code shown on your computer.'
            : 'Camera access is off for Omni OS. Turn it on in Settings, or enter the code instead.'}
        </Text>
        {permission.canAskAgain ? (
          <Button label="Allow camera" onPress={() => void requestPermission()} />
        ) : (
          <Button label="Open Settings" onPress={() => void Linking.openSettings()} />
        )}
        <Button label="Enter code" variant="secondary" onPress={onUseCode} />
      </View>
    );
  }

  return (
    <View style={styles.stack}>
      {scan.kind === 'rejected' ? (
        <>
          <Callout message={scan.message} />
          <Button label="Scan again" onPress={() => setScan({ kind: 'idle' })} />
        </>
      ) : (
        <>
          <View style={[styles.camera, { backgroundColor: colors.surface3 }]}>
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={({ data }) => {
                try {
                  setScan({ kind: 'confirm', ...parsePairingQr(data) });
                } catch (error) {
                  setScan({ kind: 'rejected', message: describePairingError(error) });
                }
              }}
            />
          </View>
          <Text style={[styles.body, { color: colors.fg3 }]}>
            Point the camera at the pairing QR code shown on your computer.
          </Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: space.s8,
  },
  card: {
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.s9,
    gap: space.s8,
  },
  confirmTitle: {
    fontSize: fontSize.heading,
    lineHeight: Math.round(fontSize.heading * lineHeight.heading),
    fontWeight: '600',
  },
  body: {
    fontSize: fontSize.body,
    lineHeight: Math.round(fontSize.body * lineHeight.body),
  },
  camera: {
    aspectRatio: 1,
    borderRadius: radius.xl,
    overflow: 'hidden',
  },
});
