import { Empty, LinkButton } from '../components/ui.tsx';
import { href, type Route } from '../router.ts';
import { ArtifactsPage } from './Artifacts.tsx';
import { AutomationsPage } from './Automations.tsx';
import { ChannelPage } from './Channel.tsx';
import { NewChannelPage } from './ChannelSettings.tsx';
import { HomePage } from './Home.tsx';
import { SearchPage } from './Search.tsx';
import { SecretsPage } from './Secrets.tsx';
import { SettingsPage } from './Settings.tsx';
import { StoragePage } from './Storage.tsx';
import { SyncPage } from './Sync.tsx';
import { ThreadPage } from './Thread.tsx';

/** The desktop page for a route. The phone shows the ones it has no screen of its own for. */
export function Page({ route }: { route: Route }) {
  switch (route.name) {
    case 'home':
    case 'channels':
      return <HomePage />;
    case 'channel':
      return <ChannelPage key={route.id} id={route.id} tab={route.tab} pr={route.pr} />;
    case 'thread':
      return <ThreadPage key={route.id} id={route.id} artifact={route.artifact} />;
    case 'search':
      return <SearchPage q={route.q} />;
    case 'automations':
      return <AutomationsPage />;
    case 'secrets':
      return <SecretsPage />;
    case 'sync':
      return <SyncPage />;
    case 'storage':
      return <StoragePage />;
    case 'settings':
      return <SettingsPage />;
    case 'artifacts':
      return <ArtifactsPage />;
    case 'new-channel':
      return <NewChannelPage />;
    default:
      return (
        <div className="h-full overflow-y-auto">
          <Empty icon="alert" title="Page not found" action={<LinkButton href={href.home()}>Go home</LinkButton>}>
            Nothing lives at {route.path}.
          </Empty>
        </div>
      );
  }
}
