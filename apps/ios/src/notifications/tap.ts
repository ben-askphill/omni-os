import type { OmniAlert } from './alert';
import type { PushServer } from './registration';

export type ThreadProbe = 'found' | 'missing' | 'error';

export interface TapRoute {
  name: 'Channels' | 'Channel' | 'Thread';
  params?: { id: string };
}

/** Channels, the thread's channel when the alert names one, then the thread: Back from it lands where the alert came from. */
export function routesFor(alert: Pick<OmniAlert, 'threadId' | 'channelId'>): TapRoute[] {
  return [
    { name: 'Channels' },
    ...(alert.channelId ? [{ name: 'Channel', params: { id: alert.channelId } } as const] : []),
    { name: 'Thread', params: { id: alert.threadId } },
  ];
}

/**
 * An alert does not say which server sent it, and one phone can be paired with several. With one server there is
 * nothing to choose. With more, the first (active first) that has the thread wins. When none has it, or none can be
 * reached, the active server gets it, and its thread screen says what is wrong.
 */
export async function pickServer(
  threadId: string,
  servers: readonly PushServer[],
  probe: (server: PushServer, threadId: string) => Promise<ThreadProbe>,
): Promise<PushServer | null> {
  const [active] = servers;
  if (!active) return null;
  if (servers.length === 1) return active;
  for (const server of servers) {
    if ((await probe(server, threadId).catch((): ThreadProbe => 'error')) === 'found') return server;
  }
  return active;
}

export interface WaitOptions {
  timeoutMs?: number;
  stepMs?: number;
}

/** Polls `ready` until it is true or `timeoutMs` passes. A tap that wakes a cold app waits here for the app to load. */
export async function waitUntil(ready: () => boolean, { timeoutMs = 15_000, stepMs = 50 }: WaitOptions = {}): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!ready()) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
  return true;
}

export interface TapDeps {
  /** The paired servers, active first, read from the vault. */
  servers(): Promise<PushServer[]>;
  probe(server: PushServer, threadId: string): Promise<ThreadProbe>;
  /** The app has loaded its servers, has a session, and its navigator can take a route. */
  ready(): boolean;
  /** Id of the server the app is showing now. */
  activeServerId(): string | null;
  select(serverId: string): Promise<void>;
  /** The thread on screen now, if any. */
  threadOnScreen(): string | null;
  open(routes: TapRoute[]): void;
  wait?: WaitOptions;
}

export interface TapRouter {
  /** `id` is the notification's identifier, so one tap that arrives twice opens once. A newer tap replaces an older one. */
  handle(id: string, alert: OmniAlert): Promise<void>;
}

export function createTapRouter(deps: TapDeps): TapRouter {
  const handled = new Set<string>();
  let latest = 0;

  return {
    async handle(id, alert) {
      if (handled.has(id)) return;
      handled.add(id);
      const mine = ++latest;
      const superseded = () => mine !== latest;

      // Choosing the active server writes the server index, so wait for the provider's own first load to finish.
      if (!(await waitUntil(deps.ready, deps.wait)) || superseded()) return;
      const server = await pickServer(alert.threadId, await deps.servers(), deps.probe);
      if (!server || superseded()) return;

      if (deps.activeServerId() !== server.id) {
        await deps.select(server.id);
        const switched = await waitUntil(() => deps.ready() && deps.activeServerId() === server.id, deps.wait);
        if (!switched) return;
      }
      if (superseded() || deps.threadOnScreen() === alert.threadId) return;
      deps.open(routesFor(alert));
    },
  };
}
