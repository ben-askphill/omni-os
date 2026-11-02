import { useNeedsYouCount } from '../live/react';
import { usePairing } from '../pairing/PairingProvider';
import { ActivityScreen } from '../screens/ActivityScreen';
import { ChannelsScreen } from '../screens/ChannelsScreen';
import { ConnectScreen } from '../screens/ConnectScreen';
import { LibraryScreen } from '../screens/LibraryScreen';
import { useHasSession } from '../session/ActiveSession';
import { useOmniTheme } from '../theme';
import { detailScreens, rootHeader, Stack, stackOptions } from './detail-screens';
import { createNativeTabsNavigator } from './native-tabs';
import { activityTabLabel, needsBadge } from './tabs-model';
import type { TabsParamList } from './types';

const Tab = createNativeTabsNavigator<TabsParamList>();

/** No session shows Connect alone. Any session opens the tabs on Activity, with Search and Settings one tap away on each tab's root. */
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
    <Tab.Navigator initialRouteName="ActivityTab">
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
        options={({ navigation }) => ({ title: 'Channels', ...rootHeader(navigation, { newThread: true }) })}
      />
      {detailScreens({ backTitle: 'Channels' })}
    </Stack.Navigator>
  );
}
