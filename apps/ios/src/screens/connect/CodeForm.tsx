import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '../../ui/Button';
import { Field } from '../../ui/Field';
import { space } from '../../theme';

interface CodeFormProps {
  deviceName: string;
  onDeviceNameChange: (name: string) => void;
  busy: boolean;
  onPair: (origin: string, code: string) => void;
}

export function CodeForm({ deviceName, onDeviceNameChange, busy, onPair }: CodeFormProps) {
  const [address, setAddress] = useState('');
  const [code, setCode] = useState('');

  return (
    <View style={styles.form}>
      <Field
        label="Server address"
        placeholder="https://"
        value={address}
        onChangeText={setAddress}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        editable={!busy}
      />
      <Field
        label="Pairing code"
        value={code}
        onChangeText={setCode}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!busy}
      />
      <Field label="Device name" value={deviceName} onChangeText={onDeviceNameChange} editable={!busy} />
      <Button label="Pair" busy={busy} onPress={() => onPair(address, code)} />
    </View>
  );
}

const styles = StyleSheet.create({
  form: {
    gap: space.s8,
  },
});
