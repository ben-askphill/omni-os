import { CommonActions } from '@react-navigation/native';

import { useNeedsYouCount } from '../live/react';
import { usePairing } from '../pairing/PairingProvider';
import { ActivityScreen } from '../screens/ActivityScreen';
import { ChannelsScreen } from '../screens/ChannelsScreen';
import { ConnectScreen } from '../screens/ConnectScreen';
import { LibraryScreen } from '../screens/LibraryScreen';
import { useHasSession } from '../session/ActiveSession';
import { useOmniTheme } from '../theme';
import { tap } from '../ui/haptics';
import { detailScreens, rootHeader, Stack, stackOptions } from './detail-screens';
import { createNativeTabsNavigator, type NativeTabAction } from './native-tabs';
import { navigationRef } from './ref';
import { activityTabLabel, needsBadge } from './tabs-model';
import type { TabsParamList } from './types';

const Tab = createNativeTabsNavigator<TabsParamList>();

/**
 * Phone web's + beside its tab bar, as the tab bar's last item. It opens New thread on the tab it was tapped from, with no
 * channel picked, so the Conductor is the first choice.
 */
const newThreadAction: NativeTabAction = {
  key: 'NewThreadAction',
  title: 'New',
  icon: 'plus',
  accessibilityLabel: 'New thread',
  onPress: (tab) => {
    tap();
    navigationRef.dispatch(CommonActions.navigate({ name: tab, params: { screen: 'NewThread' } }));
  },
};

/**
 * No session shows Connect alone. Any session opens the tabs on Activity, with Search and Settings one tap away on each
 * tab's root and New as the last item in the tab bar.
 */
export function RootNavigator() {
  const { colors } = useOmniTheme();
  const { ready } = usePairing();
  const hasSession = useHasSession();
  const needs = useNeedsYouCount();

  if (!ready) return null;

  if (!hasSession) {
    return (
      <Stack.Navigator screenOptions={stackOptions(colors)}>
        <Stack.Screen name="Connect" component={ConnectScreen} options={{ title: 'Connect to a server' }} />
      </Stack.Navigator>
    );
  }

  return (
    <Tab.Navigator initialRouteName="ActivityTab" action={newThreadAction}>
      <Tab.Screen
        name="ActivityTab"
        component={ActivityStack}
        options={{
          title: 'Activity',
          icon: 'tray',
          selectedIcon: 'tray.fill',
          tabBadge: needsBadge(needs),
          tabAccessibilityLabel: activityTabLabel(needs),
        }}
      />
      <Tab.Screen name="ChannelsTab" component={ChannelsStack} options={{ title: 'Channels', icon: 'number' }} />
      <Tab.Screen name="LibraryTab" component={LibraryStack} options={{ title: 'Library', icon: 'square.stack.3d.up', selectedIcon: 'square.stack.3d.up.fill' }} />
    </Tab.Navigator>
  );
}

function ActivityStack() {
  const { colors } = useOmniTheme();
  return (
    <Stack.Navigator screenOptions={stackOptions(colors)}>
      <Stack.Screen
        name="Activity"
        component={ActivityScreen}
        options={({ navigation }) => ({ title: 'Activity', ...rootHeader(navigation) })}
      />
      {detailScreens({ backTitle: 'Activity' })}
    </Stack.Navigator>
  );
}

function LibraryStack() {
  const { colors } = useOmniTheme();
  return (
    <Stack.Navigator screenOptions={stackOptions(colors)}>
      <Stack.Screen
        name="Library"
        component={LibraryScreen}
        options={({ navigation }) => ({ title: 'Library', ...rootHeader(navigation) })}
      />
      {detailScreens({ backTitle: 'Library' })}
    </Stack.Navigator>
  );
}

function ChannelsStack() {
  const { colors } = useOmniTheme();
  return (
    <Stack.Navigator screenOptions={stackOptions(colors)}>
      <Stack.Screen
        name="Channels"
        component={ChannelsScreen}
        options={({ navigation }) => ({ title: 'Channels', ...rootHeader(navigation) })}
      />
      {detailScreens({ backTitle: 'Channels' })}
    </Stack.Navigator>
  );
}
