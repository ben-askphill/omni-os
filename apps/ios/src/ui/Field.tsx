import { StyleSheet, View, type TextInputProps } from 'react-native';
import { Text, TextInput } from './Text';

import { fontSize, radius, space, useOmniTheme, weight } from '../theme';

interface FieldProps extends Pick<
  TextInputProps,
  'value' | 'onChangeText' | 'placeholder' | 'autoCapitalize' | 'autoCorrect' | 'keyboardType' | 'editable'
> {
  label: string;
}

export function Field({ label, ...input }: FieldProps) {
  const { colors } = useOmniTheme();

  return (
    <View style={[styles.field, { backgroundColor: colors.surface, borderColor: colors.line }]}>
      <Text style={[styles.label, { color: colors.fg3 }]}>{label}</Text>
      <TextInput
        {...input}
        accessibilityLabel={label}
        placeholderTextColor={colors.fg4}
        style={[styles.input, { color: colors.fg }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.s8,
    paddingVertical: space.s6,
    gap: space.s2,
  },
  label: {
    fontSize: fontSize.meta,
    fontWeight: weight.medium,
  },
  input: {
    fontSize: fontSize.input,
    minHeight: 28,
    padding: 0,
  },
});
