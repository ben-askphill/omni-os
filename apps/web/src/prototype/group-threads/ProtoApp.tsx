// PROTOTYPE, throwaway. "Seven screens of the group threads design (ADR 0019, ADR 0020), two or three variants each,
// switchable with ?s=<screen>&v=<variant> on one page, inside Omni's real channel rail and list panel."
// The desktop shell is the real ChannelRail and ListPanel on a fake /api (fake-api.ts). The phone layout below 768px
// draws each screen's phone version full height, as a pushed screen in the phone shell would be.
import { useEffect, useLayoutEffect } from 'react';
import { AppProvider, useApp, useIsMobile } from '../../store.tsx';
import { ToastProvider } from '../../components/Toaster.tsx';
import { FolderProvider } from '../../folders.tsx';
import { ChannelRail } from '../../components/rail/ChannelRail.tsx';
import { ListPanel } from '../../components/rail/ListPanel.tsx';
import { readDisplay, takeDisplay } from '../../display.ts';
import { Switcher } from './Switcher.tsx';
import { useParams } from './url-state.ts';
import { SCREENS } from './screens/index.ts';
import type { Screen } from './screens/types.ts';

function DesktopShell({ screen, children }: { screen: Screen; children: React.ReactNode }) {
  const p = screen.place;
  const selection = p.kind === 'settings' ? ({ kind: 'settings' } as const) : ({ kind: 'channel', id: p.channel } as const);
  return (
    <div className="desktop-shell rail-shell flex h-full min-h-0 flex-row bg-bg">
      <ChannelRail selection={selection} />
      {p.kind !== 'own-list' && <ListPanel mode={p.kind === 'settings' ? { kind: 'settings' } : { kind: 'channel', id: p.channel }} onSearch={() => {}} />}
      <main id="main" className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-bg">
        {children}
      </main>
    </div>
  );
}

function Prototype() {
  const q = useParams();
  const mobile = useIsMobile();
  const { channelsLoaded } = useApp();
  const screen = SCREENS.find((s) => String(s.id) === q.get('s')) ?? SCREENS[0];
  const vi = Math.max(0, screen.variants.findIndex((v) => v.key === (q.get('v') ?? screen.pick).toUpperCase()));
  const variant = screen.variants[vi];
  const tech = q.get('tech') === '1';
  const toggle = !!screen.toggle && q.get(screen.toggle.key) === '1';
  const theme = q.get('theme') ?? 'light';

  // The real list panel and rail read the hash for the open thread or Settings section.
  useLayoutEffect(() => {
    if (location.hash !== screen.place.hash) history.replaceState(history.state, '', `${location.pathname}${location.search}${screen.place.hash}`);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }, [screen]);
  useEffect(() => {
    if (readDisplay().technical !== tech) takeDisplay({ ...readDisplay(), technical: tech });
  }, [tech]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => {
    document.title = `${screen.id}${variant.key} ${screen.name} · ${variant.name} · Prototype`;
  }, [screen, variant]);

  if (!channelsLoaded) return null;
  const view = mobile ? variant.phone() : variant.desktop();
  return (
    <>
      {mobile ? <div className="h-full min-h-0">{view}</div> : <DesktopShell screen={screen}>{view}</DesktopShell>}
      {q.get('bar') !== '0' && <Switcher screens={SCREENS} screen={screen} variant={vi} tech={tech} toggle={toggle} theme={theme} />}
    </>
  );
}

export function ProtoApp() {
  return (
    <AppProvider>
      <ToastProvider>
        <FolderProvider>
          <Prototype />
        </FolderProvider>
      </ToastProvider>
    </AppProvider>
  );
}
