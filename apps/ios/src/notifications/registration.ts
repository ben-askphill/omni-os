import type { AppPushTokenRequest } from '@omni/shared/app-pairing.ts';

import type { PushEnvironment } from './environment';

export interface PushServer {
  id: string;
  origin: string;
}

export type ServerRegistration = 'registered' | 'failed';

export type SyncReport =
  /** Notifications are not allowed, so there is no token to send. */
  | { kind: 'no-permission' }
  /** APNs gave no token: a simulator without push, a missing entitlement or no network. */
  | { kind: 'no-token' }
  | { kind: 'synced'; byServer: Record<string, ServerRegistration> };

export interface RegistrarDeps {
  /** True once the person has allowed notifications. Never asks. */
  permitted(): Promise<boolean>;
  /** The native APNs device token as hex. Throws when APNs gives none. */
  deviceToken(): Promise<string>;
  environment: PushEnvironment;
  bundleId: string;
  /** Every paired server now, read fresh on each sync. */
  servers(): Promise<PushServer[]>;
  /** One PUT /auth/push-token. Throws on any failure. */
  register(server: PushServer, body: AppPushTokenRequest): Promise<void>;
  onReport?(report: SyncReport): void;
}

export interface PushRegistrar {
  /**
   * Puts the device token on every paired server. Registering again replaces the old one, so running it on each
   * launch, return to the front, new server and new token is safe, and it repairs a registration the server dropped.
   * `observedToken` is a token APNs just announced, which `deviceToken()` may not return yet.
   */
  sync(observedToken?: string): Promise<SyncReport>;
}

export function createPushRegistrar(deps: RegistrarDeps): PushRegistrar {
  let running: Promise<SyncReport> | null = null;
  let rerun = false;
  let observed: string | null = null;

  async function once(): Promise<SyncReport> {
    if (!(await deps.permitted().catch(() => false))) return { kind: 'no-permission' };

    let token: string;
    try {
      token = observed ?? (await deps.deviceToken());
    } catch {
      return { kind: 'no-token' };
    }

    const servers = await deps.servers().catch(() => []);
    const body: AppPushTokenRequest = { token, platform: 'ios', environment: deps.environment, bundleId: deps.bundleId };
    const results = await Promise.all(
      servers.map(async (server): Promise<[string, ServerRegistration]> => {
        try {
          await deps.register(server, body);
          return [server.id, 'registered'];
        } catch {
          return [server.id, 'failed'];
        }
      }),
    );
    return { kind: 'synced', byServer: Object.fromEntries(results) };
  }

  async function loop(): Promise<SyncReport> {
    let report: SyncReport;
    do {
      rerun = false;
      report = await once();
      deps.onReport?.(report);
    } while (rerun);
    return report;
  }

  return {
    sync(observedToken) {
      if (observedToken) observed = observedToken;
      if (running) {
        rerun = true;
        return running;
      }
      running = loop().finally(() => {
        running = null;
      });
      return running;
    },
  };
}
