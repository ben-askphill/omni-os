import { createContext, useContext, type ComponentProps } from 'react';
import { StyleSheet, Text as RNText, TextInput as RNTextInput, type StyleProp, type TextStyle } from 'react-native';

import { tracking, weight } from '../theme';

// React Native draws text at 400 unless a style says otherwise. These set the regular weight on the outermost Text only:
// a nested Text inherits its parent's style natively, so giving it a base weight would undo a bold parent.
const InsideText = createContext(false);

/** React Native draws text at 14pt unless a style says otherwise. */
const DEFAULT_SIZE = 14;

/**
 * The design system's -0.03em tracking, in points for this style's size. React Native takes letterSpacing in points,
 * not em, so it follows the font size: set on the outermost Text, and again on a nested Text that changes the size
 * (otherwise it inherits its parent's points). A style that sets its own letterSpacing keeps it.
 */
function trackingFor(style: StyleProp<TextStyle>, outermost: boolean): TextStyle | null {
  const flat = StyleSheet.flatten(style) ?? {};
  if (flat.letterSpacing !== undefined) return null;
  if (flat.fontSize === undefined && !outermost) return null;
  return { letterSpacing: tracking(flat.fontSize ?? DEFAULT_SIZE) };
}

export function Text({ style, ...props }: ComponentProps<typeof RNText>) {
  const inside = useContext(InsideText);
  if (inside) return <RNText style={[trackingFor(style, false), style]} {...props} />;
  return (
    <InsideText.Provider value>
      <RNText style={[{ fontWeight: weight.regular }, trackingFor(style, true), style]} {...props} />
    </InsideText.Provider>
  );
}

export function TextInput({ style, ...props }: ComponentProps<typeof RNTextInput>) {
  return <RNTextInput style={[{ fontWeight: weight.regular }, trackingFor(style, true), style]} {...props} />;
}
