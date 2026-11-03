import { createContext, useContext, type ComponentProps } from 'react';
import { Text as RNText, TextInput as RNTextInput } from 'react-native';

import { weight } from '../theme';

// React Native draws text at 400 unless a style says otherwise. These set the regular weight on the outermost Text only:
// a nested Text inherits its parent's style natively, so giving it a base weight would undo a bold parent.
const InsideText = createContext(false);

export function Text({ style, ...props }: ComponentProps<typeof RNText>) {
  const inside = useContext(InsideText);
  if (inside) return <RNText style={style} {...props} />;
  return (
    <InsideText.Provider value>
      <RNText style={[{ fontWeight: weight.regular }, style]} {...props} />
    </InsideText.Provider>
  );
}

export function TextInput({ style, ...props }: ComponentProps<typeof RNTextInput>) {
  return <RNTextInput style={[{ fontWeight: weight.regular }, style]} {...props} />;
}
