import * as Notifications from 'expo-notifications';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, Linking } from 'react-native';

import { navigationRef, openOnChannelsTab, sessionNavigatorReady, threadOnScreen } from '../navigation/ref';
import { usePairing } from '../pairing/PairingProvider';
import { pairingVault } from '../pairing/runtime';
import { alertOf } from './alert';
import { createPushServerApi, type PushServerApi } from './api';
import { BUNDLE_ID, pushEnvironment } from './environment';
import { foregroundBehavior } from './foreground';
import { permissionOf, shouldShowPrimer, type PermissionState } from './permission';
import { primerStore } from './primerStore';
import { createPushRegistrar, type ServerRegistration } from './registration';
import { createTapRouter, waitUntil } from './tap';

interface NotificationsContextValue {
  /** Null until iOS has been asked what it allows. */
  permission: PermissionState | null;
  /** Per server: how the last attempt to put this phone's token on it ended. Absent before the first attempt. */
  registration: Record<string, ServerRegistration>;
  /** Shows iOS's own prompt. Resolves with the answer. Does nothing once iOS has answered. */
  requestPermission(): Promise<PermissionState>;
  /** Opens this app's page in iOS Settings, where a denied permission can be changed. */
  openSystemSettings(): Promise<void>;
  api: PushServerApi;
}

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

export function useNotifications(): NotificationsContextValue {
  const value = useContext(NotificationsContext);
  if (!value) throw new Error('useNotifications needs a NotificationsProvider');
  return value;
}

async function readPermission(): Promise<PermissionState> {
  return permissionOf(await Notifications.getPermissionsAsync());
}

/**
 * Owns everything between the phone and the server's alerts: iOS's permission, putting the device token on each paired
 * server, showing or hiding a banner that arrives while the app is open, and opening the thread a tap names. It sits
 * inside the pairing provider and around the navigation container.
 */
export function NotificationsProvider({ children }: { children: ReactNode }) {
  const pairing = usePairing();
  const [permission, setPermission] = useState<PermissionState | null>(null);
  const [registration, setRegistration] = useState<Record<string, ServerRegistration>>({});
  const [primerSeen, setPrimerSeen] = useState<boolean | null>(null);

  const api = useMemo(() => createPushServerApi({ getToken: (id) => pairingVault.getToken(id) }), []);

  // Callbacks that outlive a render read the latest pairing state here.
  const latest = useRef({ ready: false, activeId: null as string | null, select: pairing.select });
  latest.current = {
    ready: pairing.ready && pairing.servers.length > 0,
    activeId: pairing.activeServer?.id ?? null,
    select: pairing.select,
  };

  const registrar = useMemo(
    () =>
      createPushRegistrar({
        permitted: async () => (await readPermission()) === 'granted',
        deviceToken: async () => (await Notifications.getDevicePushTokenAsync()).data as string,
        environment: pushEnvironment(__DEV__, process.env.EXPO_PUBLIC_PUSH_ENVIRONMENT),
        bundleId: BUNDLE_ID,
        servers: async () => (await pairingVault.loadIndex()).servers.map(({ id, origin }) => ({ id, origin })),
        register: (server, body) => api.register(server, body),
        onReport: (report) => {
          if (report.kind === 'synced') setRegistration((current) => ({ ...current, ...report.byServer }));
        },
      }),
    [api],
  );

  const tapRouter = useMemo(
    () =>
      createTapRouter({
        servers: async () => {
          const { servers, activeId } = await pairingVault.loadIndex();
          return servers
            .map(({ id, origin }) => ({ id, origin }))
            .sort((a, b) => Number(b.id === activeId) - Number(a.id === activeId));
        },
        probe: (server, threadId) => api.probeThread(server, threadId),
        ready: () => latest.current.ready && sessionNavigatorReady(),
        activeServerId: () => latest.current.activeId,
        select: (id) => latest.current.select(id),
        threadOnScreen,
        open: openOnChannelsTab,
      }),
    [api],
  );

  useEffect(() => {
    void readPermission().then(setPermission, () => setPermission('denied'));
    void primerStore.seen().then(setPrimerSeen);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      void readPermission().then(setPermission, () => undefined);
      void registrar.sync();
    });
    return () => subscription.remove();
  }, [registrar]);

  // A new or re-paired server, or a permission just granted, gets this phone's token.
  const serverKey = pairing.servers.map((server) => `${server.id}:${server.sessionId}`).join(',');
  useEffect(() => {
    if (permission === 'granted' && serverKey !== '') void registrar.sync();
  }, [registrar, permission, serverKey]);

  useEffect(() => {
    const subscription = Notifications.addPushTokenListener((token) => void registrar.sync(token.data as string));
    return () => subscription.remove();
  }, [registrar]);

  useEffect(() => {
    Notifications.setNotificationHandler({
      handleNotification: async (notification) => foregroundBehavior(alertOf(notification), threadOnScreen()),
    });
    const handle = (response: Notifications.NotificationResponse) => {
      const alert = alertOf(response.notification);
      if (alert) void tapRouter.handle(response.notification.request.identifier, alert);
    };
    const subscription = Notifications.addNotificationResponseReceivedListener(handle);
    // The tap that launched the app arrived before this listener existed.
    void Notifications.getLastNotificationResponseAsync()
      .then(async (response) => {
        if (!response) return;
        handle(response);
        await Notifications.clearLastNotificationResponseAsync();
      })
      .catch(() => undefined);
    return () => {
      subscription.remove();
      Notifications.setNotificationHandler(null);
    };
  }, [tapRouter]);

  const showPrimer = shouldShowPrimer({ permission, pairedServers: pairing.servers.length, seen: primerSeen });
  useEffect(() => {
    if (!showPrimer) return;
    let cancelled = false;
    void waitUntil(() => latest.current.ready && sessionNavigatorReady()).then((ready) => {
      if (!ready || cancelled) return;
      setPrimerSeen(true);
      void primerStore.markSeen();
      navigationRef.navigate('NotificationsIntro');
    });
    return () => {
      cancelled = true;
    };
  }, [showPrimer]);

  const value: NotificationsContextValue = {
    permission,
    registration,
    api,
    async requestPermission() {
      const next = permissionOf(
        await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: false } }),
      );
      setPermission(next);
      return next;
    },
    openSystemSettings: () => Linking.openSettings(),
  };

  return <NotificationsContext value={value}>{children}</NotificationsContext>;
}
