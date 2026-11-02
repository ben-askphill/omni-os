import { StyleSheet, View } from 'react-native';

import { createNativeStackNavigator, type NativeStackNavigationOptions, type NativeStackNavigationProp } from '@react-navigation/native-stack';

import { HeaderButton } from '../components/HeaderButton';
import { ActionsScreen } from '../screens/ActionsScreen';
import { ArtifactScreen } from '../screens/ArtifactScreen';
import { AutomationsScreen } from '../screens/AutomationsScreen';
import { ChangesScreen } from '../screens/ChangesScreen';
import { ChannelScreen } from '../screens/ChannelScreen';
import { ConnectScreen } from '../screens/ConnectScreen';
import { ContinueScreen } from '../screens/ContinueScreen';
import { NewThreadScreen } from '../screens/NewThreadScreen';
import { NotificationSettingsScreen } from '../screens/NotificationSettingsScreen';
import { NotificationsIntroScreen } from '../screens/NotificationsIntroScreen';
import { DevicesScreen } from '../screens/DevicesScreen';
import { PullRequestScreen } from '../screens/PullRequestScreen';
import { SearchScreen } from '../screens/SearchScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { ServersScreen } from '../screens/ServersScreen';
import { ThreadScreen } from '../screens/ThreadScreen';
import { space, type ColorTokens } from '../theme';
import type { RootStackParamList } from './types';

export const Stack = createNativeStackNavigator<RootStackParamList>();

export function stackOptions(colors: ColorTokens): NativeStackNavigationOptions {
  return {
    headerStyle: { backgroundColor: colors.bg },
    headerTintColor: colors.fg,
    headerTitleStyle: { color: colors.fg },
    headerShadowVisible: false,
    contentStyle: { backgroundColor: colors.bg },
  };
}

type Navigate = Pick<NativeStackNavigationProp<RootStackParamList>, 'navigate'>;

/**
 * Search on the left and Settings on the right of a tab's root screen. Neither tab root has a back button to take the
 * left. Servers sits inside Settings. Channels also carries New, so a thread can start from the list.
 */
export function rootHeader(navigation: Navigate, { newThread = false }: { newThread?: boolean } = {}) {
  return {
    headerLeft: () => <HeaderButton label="Search" onPress={() => navigation.navigate('Search')} />,
    headerRight: () => (
      <View style={styles.actions}>
        <HeaderButton label="Settings" onPress={() => navigation.navigate('Settings')} />
        {newThread ? <HeaderButton label="New" accessibilityLabel="New thread" onPress={() => navigation.navigate('NewThread')} /> : null}
      </View>
    ),
  };
}

/** The routes every tab can push, so `navigate('Thread', { id })` works from any tab and stays in it. */
export function detailScreens({ backTitle }: { backTitle: string }) {
  return (
    <>
      <Stack.Screen
        name="Channel"
        component={ChannelScreen}
        options={({ navigation, route }) => ({
          title: 'Channel',
          headerBackTitle: backTitle,
          headerRight: () => <HeaderButton label="New" accessibilityLabel="New thread" onPress={() => navigation.navigate('NewThread', { channel: route.params.id })} />,
        })}
      />
      <Stack.Screen name="NewThread" component={NewThreadScreen} options={{ title: 'New thread', presentation: 'modal' }} />
      <Stack.Screen name="Thread" component={ThreadScreen} options={{ title: 'Thread', headerBackTitle: 'Back' }} />
      <Stack.Screen name="Continue" component={ContinueScreen} options={{ title: 'Continue with another harness', presentation: 'modal' }} />
      <Stack.Screen name="Artifact" component={ArtifactScreen} options={{ title: 'Artifact', headerBackTitle: 'Back' }} />
      <Stack.Screen name="Search" component={SearchScreen} options={{ title: 'Search', headerBackTitle: backTitle }} />
      <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings', headerBackTitle: backTitle }} />
      <Stack.Screen name="Devices" component={DevicesScreen} options={{ title: 'Devices', headerBackTitle: 'Settings' }} />
      <Stack.Screen name="Automations" component={AutomationsScreen} options={{ title: 'Automations', headerBackTitle: 'Settings' }} />
      <Stack.Screen name="Changes" component={ChangesScreen} options={{ title: 'Changes', headerBackTitle: 'Thread' }} />
      <Stack.Screen name="PullRequest" component={PullRequestScreen} options={{ title: 'Pull request', headerBackTitle: 'Thread', gestureEnabled: false }} />
      <Stack.Screen name="Actions" component={ActionsScreen} options={{ title: 'Actions', headerBackTitle: 'Thread' }} />
      <Stack.Screen name="Servers" component={ServersScreen} options={{ title: 'Servers', headerBackTitle: 'Settings' }} />
      <Stack.Screen name="AddServer" component={ConnectScreen} options={{ title: 'Add server', headerBackTitle: 'Back' }} />
      <Stack.Screen name="NotificationSettings" component={NotificationSettingsScreen} options={{ title: 'Notifications', headerBackTitle: 'Back' }} />
      <Stack.Screen name="NotificationsIntro" component={NotificationsIntroScreen} options={{ title: 'Notifications', presentation: 'modal' }} />
    </>
  );
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s8,
  },
});
