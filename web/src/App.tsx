import { useCallback, useEffect, useRef, useState } from 'react';
import { CommandPalette } from './components/CommandPalette.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import { ThreadNotifier, ToastProvider } from './components/Toaster.tsx';
import { Empty, Icon, IconButton, LinkButton, Thumb, useSlidingThumb, Wordmark, type IconName } from './components/ui.tsx';
import { AutomationsPage } from './pages/Automations.tsx';
import { ArtifactsPage } from './pages/Artifacts.tsx';
import { ChannelPage } from './pages/Channel.tsx';
import { HomePage } from './pages/Home.tsx';
import { NewChannelPage } from './pages/ChannelSettings.tsx';
import { SearchPage } from './pages/Search.tsx';
import { SecretsPage } from './pages/Secrets.tsx';
import { SyncPage } from './pages/Sync.tsx';
import { ThreadPage } from './pages/Thread.tsx';
import { href, navigate, requestComposerFocus, useHash, useRoute, type Route } from './router.ts';
import { AppProvider, useApp } from './store.tsx';
import { api } from './api.ts';
import { createSyncNudge } from './sync-nudge.ts';

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
    case 'sync':
      return <SyncPage />;
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
    case 'sync':
      return 'Sync';
    case 'artifacts':
      return 'Artifacts';
    case 'new-channel':
      return 'New channel';
    default:
      return 'Omni';
  }
}

const startThread = (route: Route) => {
  if (route.name === 'channel') {
    if (route.tab !== 'threads') navigate(`/c/${encodeURIComponent(route.id)}`);
  } else if (route.name !== 'home') navigate('/');
  requestComposerFocus();
};

/** Phone navigation: a floating icon bar with a sliding thumb (Bencho "gnav"). */
function MobileNav({ route, onMenu, onSearch }: { route: Route; onMenu: () => void; onSearch: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const active = route.name === 'home' ? 'home' : route.name === 'artifacts' ? 'artifacts' : route.name === 'search' ? 'search' : route.name === 'channel' ? 'channels' : null;
  const box = useSlidingThumb(ref, active);
  const item = (id: string, icon: IconName, label: string, onClick: () => void) => (
    <button key={id} type="button" aria-label={label} title={label} data-active={active === id} onClick={onClick} className={`press relative z-[1] grid h-11 w-11 place-items-center rounded-full transition-colors ${active === id ? 'text-fg' : 'text-fg-3'}`}>
      <Icon name={icon} size={19} />
    </button>
  );
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center pb-[calc(10px+env(safe-area-inset-bottom))] md:hidden">
      <div ref={ref} className="float pointer-events-auto relative flex items-center gap-1 rounded-full p-1.5">
        <Thumb box={box} />
        {item('home', 'home', 'Home', () => navigate('/'))}
        {item('channels', 'hash', 'Channels', onMenu)}
        <button type="button" aria-label="New thread" onClick={() => startThread(route)} className="press relative z-[1] mx-1 grid h-11 w-14 place-items-center rounded-full bg-fg text-on-ink">
          <Icon name="plus" size={20} strokeWidth={2} />
        </button>
        {item('search', 'search', 'Search', onSearch)}
        {item('artifacts', 'layers', 'Artifacts', () => navigate('/artifacts'))}
      </div>
    </div>
  );
}

function Shell() {
  const route = useRoute();
  const hash = useHash();
  const { channel } = useApp();
  const [drawer, setDrawer] = useState(false);
  const [palette, setPalette] = useState(false);
  const closePalette = useCallback(() => setPalette(false), []);
  const openPalette = useCallback(() => setPalette(true), []);

  useEffect(() => setDrawer(false), [hash]);

  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawer(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawer]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette((p) => !p);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Back on the tab: ask the server to sync, so the other Mac's work shows up now rather than on its timer.
  useEffect(() => {
    const sync = createSyncNudge({ post: () => api.post('/sync/now') });
    const onFocus = () => sync.nudge();
    const onVisible = () => document.visibilityState === 'visible' && sync.nudge();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
      sync.cancel();
    };
  }, []);

  useEffect(() => {
    const t = mobileTitle(route, (id) => channel(id)?.name);
    document.title = t === 'Home' ? 'Omni' : `${t} · Omni`;
  }, [route, channel]);

  // The thread view has its own composer pinned to the bottom, so the bar steps aside there.
  const showNav = route.name !== 'thread';

  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row md:py-2 md:pr-2">
      {/* Mobile top bar */}
      <header className="relative bg-bg z-20 flex h-[calc(52px+env(safe-area-inset-top))] shrink-0 items-center gap-1 border-b border-line px-2 pt-[env(safe-area-inset-top)] shadow-none md:hidden">
        <IconButton icon="menu" label="Open menu" onClick={() => setDrawer(true)} size={18} />
        <a href={href.home()} className="px-1" aria-label="Omni home">
          <Wordmark size={16} />
        </a>
        <span className="ml-1 min-w-0 flex-1 truncate text-[13px] text-fg-3">{mobileTitle(route, (id) => channel(id)?.name)}</span>
        <IconButton icon="search" label="Search or jump to" onClick={openPalette} size={17} />
      </header>

      {/* Desktop sidebar */}
      <aside className="hidden w-[252px] shrink-0 md:block">
        <Sidebar onSearch={openPalette} />
      </aside>

      {/* Mobile drawer */}
      {drawer && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="scrim absolute inset-0" onClick={() => setDrawer(false)} />
          <div className="drawer-in absolute inset-y-0 left-0 flex w-[86%] max-w-[300px] flex-col overflow-hidden rounded-r-[28px] shadow-[var(--shadow-menu)]">
            <div className="absolute top-3 right-2 z-10 pt-[env(safe-area-inset-top)]">
              <IconButton icon="x" label="Close menu" onClick={() => setDrawer(false)} />
            </div>
            <div className="h-full bg-sidebar pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
              <Sidebar onNavigate={() => setDrawer(false)} onSearch={openPalette} />
            </div>
          </div>
        </div>
      )}

      <main className={`relative min-h-0 min-w-0 flex-1 overflow-hidden bg-bg md:rounded-[22px] md:pb-0 md:shadow-[var(--shadow-card)] ${showNav ? 'pb-[calc(72px+env(safe-area-inset-bottom))]' : ''}`}>
        <Page route={route} />
      </main>

      {showNav && <MobileNav route={route} onMenu={() => setDrawer(true)} onSearch={openPalette} />}
      <CommandPalette open={palette} onClose={closePalette} />
      <ThreadNotifier />
    </div>
  );
}

export function App() {
  return (
    <AppProvider>
      <ToastProvider>
        <Shell />
      </ToastProvider>
    </AppProvider>
  );
}
