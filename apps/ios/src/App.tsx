import { DarkTheme, DefaultTheme, NavigationContainer, type Theme } from '@react-navigation/native';
import { StatusBar } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { navigationRef } from './navigation/ref';
import { RootNavigator } from './navigation/RootNavigator';
import { NotificationsProvider } from './notifications/NotificationsProvider';
import { PairingProvider } from './pairing/PairingProvider';
import { ActiveSessionProvider } from './session/ActiveSession';
import { useOmniTheme } from './theme';

export default function App() {
  const { scheme, colors } = useOmniTheme();
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  const navTheme: Theme = {
    ...base,
    colors: {
      ...base.colors,
      primary: colors.fg,
      background: colors.bg,
      card: colors.bg,
      text: colors.fg,
      border: colors.line,
    },
  };

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <KeyboardProvider>
          <StatusBar barStyle={scheme === 'dark' ? 'light-content' : 'dark-content'} />
          <PairingProvider>
            <NotificationsProvider>
              <NavigationContainer ref={navigationRef} theme={navTheme}>
                <ActiveSessionProvider>
                  <RootNavigator />
                </ActiveSessionProvider>
              </NavigationContainer>
            </NotificationsProvider>
          </PairingProvider>
        </KeyboardProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
