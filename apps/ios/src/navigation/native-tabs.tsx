import {
  createNavigatorFactory,
  TabActions,
  TabRouter,
  useNavigationBuilder,
  type DefaultNavigatorOptions,
  type NavigationProp,
  type NavigatorTypeBagBase,
  type ParamListBase,
  type StaticConfig,
  type TabActionHelpers,
  type TabNavigationState,
  type TabRouterOptions,
  type TypedNavigator,
} from '@react-navigation/native';
import { useState } from 'react';
import { Tabs, type TabsScreenAppearanceIOS } from 'react-native-screens';

import { useOmniTheme } from '../theme';
import { tabBarHidden } from './tabs-model';

export interface NativeTabOptions {
  title: string;
  /** SF Symbol names. */
  icon: string;
  selectedIcon?: string;
  /** Hidden when undefined. */
  tabBadge?: string;
  /** Read in place of the title, as when the badge needs saying. */
  tabAccessibilityLabel?: string;
}

/** `origin: 'native'` tells a nested native stack that UIKit already popped it to its root. */
export type NativeTabsEventMap = {
  tabPress: { data: { origin?: 'native' }; canPreventDefault: false };
};

type NativeTabsProps = DefaultNavigatorOptions<
  ParamListBase,
  string | undefined,
  TabNavigationState<ParamListBase>,
  NativeTabOptions,
  NativeTabsEventMap,
  NativeTabsNavigationProp<ParamListBase>
> &
  TabRouterOptions;

export type NativeTabsNavigationProp<
  ParamList extends ParamListBase,
  RouteName extends keyof ParamList = keyof ParamList,
  NavigatorID extends string | undefined = undefined,
> = NavigationProp<ParamList, RouteName, NavigatorID, TabNavigationState<ParamList>, NativeTabOptions, NativeTabsEventMap> &
  TabActionHelpers<ParamList>;

/**
 * UIKit's tab bar driven by React Navigation's tab router. Native owns the selection: JS asks for a tab through
 * `navStateRequest`, quoting the last provenance native confirmed, and follows a tap by jumping its own state there.
 */
function NativeTabsNavigator({ id, initialRouteName, backBehavior, children, layout, screenListeners, screenOptions, screenLayout, UNSTABLE_router }: NativeTabsProps) {
  const { state, descriptors, navigation, NavigationContent } = useNavigationBuilder<
    TabNavigationState<ParamListBase>,
    TabRouterOptions,
    TabActionHelpers<ParamListBase>,
    NativeTabOptions,
    NativeTabsEventMap
  >(TabRouter, { id, initialRouteName, backBehavior, children, layout, screenListeners, screenOptions, screenLayout, UNSTABLE_router });
  const { scheme, colors } = useOmniTheme();
  const [provenance, setProvenance] = useState(0);
  const focused = state.routes[state.index]!;

  const item = (color: string) => ({ tabBarItemTitleFontColor: color, tabBarItemIconColor: color });
  const appearance: TabsScreenAppearanceIOS = {
    tabBarBackgroundColor: colors.bg,
    tabBarShadowColor: colors.line,
    stacked: { normal: item(colors.fg3), selected: item(colors.fg) },
    inline: { normal: item(colors.fg3), selected: item(colors.fg) },
  };

  return (
    <NavigationContent>
      <Tabs.Host
        navStateRequest={{ selectedScreenKey: focused.name, baseProvenance: provenance }}
        tabBarHidden={tabBarHidden(state)}
        colorScheme={scheme}
        nativeContainerStyle={{ backgroundColor: colors.bg }}
        ios={{ tabBarTintColor: colors.fg, tabBarControllerMode: 'tabBar', tabBarMinimizeBehavior: 'never' }}
        onTabSelectionRejected={({ nativeEvent }) => setProvenance(nativeEvent.provenance)}
        onTabSelected={({ nativeEvent }) => {
          setProvenance(nativeEvent.provenance);
          if (nativeEvent.actionOrigin === 'programmatic-js') return;
          const route = state.routes.find((r) => r.name === nativeEvent.selectedScreenKey);
          if (!route) return;
          navigation.emit({
            type: 'tabPress',
            target: route.key,
            data: nativeEvent.hasTriggeredSpecialEffect ? { origin: 'native' } : {},
          });
          if (route.key !== focused.key) navigation.dispatch({ ...TabActions.jumpTo(route.name), target: state.key });
        }}
      >
        {state.routes.map((route) => {
          const { options, render } = descriptors[route.key]!;
          return (
            <Tabs.Screen
              key={route.key}
              screenKey={route.name}
              title={options.title}
              badgeValue={options.tabBadge}
              tabBarItemAccessibilityLabel={options.tabAccessibilityLabel ?? options.title}
              specialEffects={{ repeatedTabSelection: { popToRoot: true, scrollToTop: true } }}
              style={{ backgroundColor: colors.bg }}
              ios={{
                icon: { type: 'sfSymbol', name: options.icon },
                selectedIcon: { type: 'sfSymbol', name: options.selectedIcon ?? options.icon },
                standardAppearance: appearance,
                scrollEdgeAppearance: appearance,
              }}
            >
              {render()}
            </Tabs.Screen>
          );
        })}
      </Tabs.Host>
    </NavigationContent>
  );
}

export type NativeTabsTypeBag<ParamList extends ParamListBase = ParamListBase, NavigatorID extends string | undefined = string | undefined> = {
  ParamList: ParamList;
  NavigatorID: NavigatorID;
  State: TabNavigationState<ParamList>;
  ScreenOptions: NativeTabOptions;
  EventMap: NativeTabsEventMap;
  NavigationList: { [RouteName in keyof ParamList]: NativeTabsNavigationProp<ParamList, RouteName, NavigatorID> };
  Navigator: typeof NativeTabsNavigator;
};

export function createNativeTabsNavigator<
  const ParamList extends ParamListBase,
  const NavigatorID extends string | undefined = string | undefined,
  const TypeBag extends NavigatorTypeBagBase = NativeTabsTypeBag<ParamList, NavigatorID>,
  const Config extends StaticConfig<TypeBag> = StaticConfig<TypeBag>,
>(config?: Config): TypedNavigator<TypeBag, Config> {
  return createNavigatorFactory(NativeTabsNavigator)(config);
}
