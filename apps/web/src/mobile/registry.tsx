// Each phone screen's component, by the key screens.ts gives its route, and the shell's sheets.
import type { ReactNode } from 'react';
import { Page } from '../pages/Page.tsx';
import { pageTitle, type Route } from '../router.ts';
import { useApp } from '../store.tsx';
import { ActionsScreen } from './ActionsScreen.tsx';
import { ActivityScreen } from './ActivityScreen.tsx';
import { ChannelScreen, ChannelsScreen } from './ChannelsScreen.tsx';
import { LibraryScreen } from './LibraryScreen.tsx';
import { NewSheet } from './NewSheet.tsx';
import { MoEmpty, MoHeader } from './parts.tsx';
import type { ScreenKey } from './screens.ts';
import { SearchSheet } from './SearchSheet.tsx';
import { SettingsScreen } from './SettingsScreen.tsx';
import { ThreadScreen } from './ThreadScreen.tsx';
import { BrowserScreen, ChangesScreen, DetailsScreen, PRScreen, StepsScreen, TerminalScreen, ViewerScreen } from './ThreadViews.tsx';
import { useShell, type ShellSheet } from './shell.tsx';

/** A desktop page the phone has no screen of its own for, under a back bar. Those pages already fit a phone. */
function PageScreen({ route }: { route: Route }) {
  const shell = useShell();
  const { channel } = useApp();
  return (
    <>
      <MoHeader onBack={shell.back} title={pageTitle(route, (id) => channel(id)?.name)} />
      <div className="relative min-h-0 flex-1 overflow-hidden" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <Page route={route} />
      </div>
    </>
  );
}

function NotFound({ path }: { path: string }) {
  const shell = useShell();
  return (
    <>
      <MoHeader onBack={shell.back} title="Not found" />
      <MoEmpty>Nothing lives at {path}.</MoEmpty>
    </>
  );
}

export const RENDER: Record<ScreenKey, (r: Route) => ReactNode> = {
  activity: () => <ActivityScreen />,
  channels: () => <ChannelsScreen />,
  library: () => <LibraryScreen />,
  channel: (r) => r.name === 'channel' && <ChannelScreen key={r.id} id={r.id} />,
  'channel-pr': (r) => <PageScreen route={r} />,
  thread: () => <ThreadScreen />,
  steps: (r) => <StepsScreen turn={r.name === 'thread' ? r.turn : undefined} />,
  changes: () => <ChangesScreen />,
  pr: () => <PRScreen />,
  browser: () => <BrowserScreen />,
  terminal: () => <TerminalScreen />,
  actions: () => <ActionsScreen />,
  details: () => <DetailsScreen />,
  viewer: (r) => <ViewerScreen route={r} />,
  settings: () => <SettingsScreen />,
  search: (r) => <PageScreen route={r} />,
  page: (r) => <PageScreen route={r} />,
  notfound: (r) => <NotFound path={r.name === 'notfound' ? r.path : ''} />,
};

export function SheetView({ sheet }: { sheet: ShellSheet }) {
  switch (sheet.name) {
    case 'new':
      return <NewSheet channel={sheet.channel} />;
    case 'search':
      return <SearchSheet />;
  }
}
