import { useEffect, useState } from 'react';
import { Sidebar } from './components/Sidebar.tsx';
import { Empty, IconButton, LinkButton } from './components/ui.tsx';
import { AutomationsPage } from './pages/Automations.tsx';
import { ArtifactsPage } from './pages/Artifacts.tsx';
import { ChannelPage } from './pages/Channel.tsx';
import { HomePage } from './pages/Home.tsx';
import { NewChannelPage } from './pages/ChannelSettings.tsx';
import { SearchPage } from './pages/Search.tsx';
import { SecretsPage } from './pages/Secrets.tsx';
import { ThreadPage } from './pages/Thread.tsx';
import { href, requestComposerFocus, useHash, useRoute, type Route } from './router.ts';
import { AppProvider, useApp } from './store.tsx';

function Page({ route }: { route: Route }) {
  switch (route.name) {
    case 'home':
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

function mobileTitle(route: Route, channelName: (id: string) => string | undefined) {
  switch (route.name) {
    case 'home':
      return 'Home';
    case 'channel':
      return `#${channelName(route.id) ?? route.id}`;
    case 'thread':
      return 'Thread';
    case 'search':
      return 'Search';
    case 'automations':
      return 'Automations';
    case 'secrets':
      return 'Secrets';
    case 'artifacts':
      return 'Artifacts';
    case 'new-channel':
      return 'New channel';
    default:
      return 'Omni';
  }
}

function Shell() {
  const route = useRoute();
  const hash = useHash();
  const { channel } = useApp();
  const [drawer, setDrawer] = useState(false);

  useEffect(() => setDrawer(false), [hash]);

  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawer(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawer]);

  useEffect(() => {
    const t = mobileTitle(route, (id) => channel(id)?.name);
    document.title = t === 'Home' ? 'Omni' : `${t} · Omni`;
  }, [route, channel]);

  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      {/* Mobile top bar */}
      <header className="flex h-12 shrink-0 items-center gap-1 border-b border-line bg-sidebar px-2 pt-[env(safe-area-inset-top)] md:hidden">
        <IconButton icon="menu" label="Open menu" onClick={() => setDrawer(true)} size={18} />
        <a href={href.home()} className="flex items-center gap-1 text-[15px] font-bold tracking-[-0.045em]">
          Omni
          <span className="inline-block h-1 w-1 translate-y-[-4px] rounded-full bg-accent" />
        </a>
        <span className="ml-1 min-w-0 flex-1 truncate text-[13px] text-fg-3">{mobileTitle(route, (id) => channel(id)?.name)}</span>
        <IconButton
          icon="plus"
          label="New thread"
          size={18}
          onClick={() => {
            if (route.name !== 'home' && !(route.name === 'channel' && route.tab === 'threads')) window.location.hash = '#/';
            requestComposerFocus();
          }}
        />
      </header>

      {/* Desktop sidebar */}
      <aside className="hidden w-[244px] shrink-0 border-r border-line md:block">
        <Sidebar />
      </aside>

      {/* Mobile drawer */}
      {drawer && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDrawer(false)} />
          <div className="fade-in absolute inset-y-0 left-0 flex w-[86%] max-w-[300px] flex-col border-r border-line shadow-[var(--shadow-menu)]">
            <div className="absolute top-3 right-2 z-10 pt-[env(safe-area-inset-top)]">
              <IconButton icon="x" label="Close menu" onClick={() => setDrawer(false)} />
            </div>
            <div className="h-full pt-[env(safe-area-inset-top)]">
              <Sidebar onNavigate={() => setDrawer(false)} />
            </div>
          </div>
        </div>
      )}

      <main className="relative min-h-0 min-w-0 flex-1">
        <Page route={route} />
      </main>
    </div>
  );
}

export function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}

