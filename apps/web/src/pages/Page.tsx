import { Empty, LinkButton } from '../components/ui.tsx';
import { AutomationsPage, NewChannelPage, SettingsPage } from '../lazy.tsx';
import { href, type Route } from '../router.ts';
import { AllPRsPage } from './AllPRs.tsx';
import { ArtifactsPage } from './Artifacts.tsx';
import { ChannelPage } from './Channel.tsx';
import { HomePage } from './Home.tsx';
import { SearchPage } from './Search.tsx';
import { ThreadPage } from './Thread.tsx';

/** The desktop page for a route. The phone shows the ones it has no screen of its own for. */
export function Page({ route }: { route: Route }) {
  switch (route.name) {
    case 'home':
    case 'channels':
    case 'inbox':
      // The rail's Inbox disc: the Inbox list sits in the panel beside it, so the page is the dashboard.
      return <HomePage />;
    case 'channel':
      return <ChannelPage key={route.id} id={route.id} tab={route.tab} pr={route.pr} />;
    case 'thread':
      return <ThreadPage key={route.id} id={route.id} artifact={route.artifact} at={route.at} view={route.view} />;
    case 'search':
      return <SearchPage q={route.q} />;
    case 'automations':
      return <AutomationsPage />;
    case 'settings':
      return <SettingsPage section={route.section} focus={route.focus} agent={route.agent} />;
    case 'artifacts':
      return <ArtifactsPage source={route.source} />;
    case 'prs':
      return <AllPRsPage />;
    case 'new-channel':
      return <NewChannelPage />;
    case 'quick-prompt':
      // The desktop app's panel only (App.tsx). Anywhere else it is no page.
      return <Page route={{ name: 'notfound', path: '/quick-prompt' }} />;
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
