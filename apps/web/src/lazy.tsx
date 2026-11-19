// The pages and dialogs most visits never open, each in a chunk of its own, so the first paint waits only for the
// shell and the pages people live in (audit M26). Import them from here, never straight from their modules: one
// static import anywhere pulls the module back into the main chunk.
import { Component, lazy, Suspense, useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { Button, Empty, Loading } from './components/ui.tsx';
import { pageColumn } from './components/ui/feedback.tsx';
import { useApp } from './store.tsx';

/** A chunk that did not arrive, as opposed to an error inside a page that did. */
class ChunkError extends Error {}

/** One shared fetch per chunk, so the idle prefetch and the first render wait on the same request. A failure clears it. */
function chunk<M>(load: () => Promise<M>): () => Promise<M> {
  let pending: Promise<M> | undefined;
  return () =>
    (pending ??= load().catch((err: unknown) => {
      pending = undefined;
      throw new ChunkError('A part of Omni did not load', { cause: err });
    }));
}

const loadSettings = chunk(() => import('./pages/Settings.tsx'));
const loadAutomations = chunk(() => import('./pages/Automations.tsx'));
const loadChannelSettings = chunk(() => import('./pages/ChannelSettings.tsx'));
const loadOnboarding = chunk(() => import('./components/Onboarding.tsx'));

/**
 * What a page shows when its chunk did not arrive. The usual cause is an update: this window's index.html names the old
 * build's chunks, and the server only has the new ones. A reload fetches the new index.html. React keeps a failed
 * lazy() failed, so a retry without the reload could never succeed.
 */
class ChunkBoundary extends Component<{ children: ReactNode }, { error?: unknown }> {
  state: { error?: unknown } = {};
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  render() {
    const { error } = this.state;
    if (error === undefined) return this.props.children;
    // Any other error goes on up, as it did before the page moved to a chunk of its own.
    if (!(error instanceof ChunkError)) throw error;
    return (
      <Empty icon="alert" title="This page did not load" action={<Button onClick={() => location.reload()}>Reload</Button>}>
        Omni may have updated since this window opened. Reload to get the new version.
      </Empty>
    );
  }
}

/** Nothing at first, so a chunk that loads quickly never flashes a spinner, then a Loading line in the page column. */
function PageFallback() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 400);
    return () => clearTimeout(t);
  }, []);
  return <div className="h-full">{slow && <div className={`${pageColumn('measure')} pt-6`}><Loading /></div>}</div>;
}

/**
 * A component from a chunk of its own. Once the chunk is in, it renders straight away: a lazy() page still suspends
 * for a moment, and React then holds the fallback at least 300 ms, a blank page on every first open.
 */
function onDemand<P extends object>(load: () => Promise<ComponentType<P>>, fallback: ReactNode) {
  let loaded: ComponentType<P> | undefined;
  const fetchChunk = () => load().then((c) => (loaded = c));
  const Lazy = lazy(async () => ({ default: await fetchChunk() }));
  function OnDemand(props: P) {
    // Fixed for this mount: switching from Lazy to the loaded component would remount the page and drop its state.
    const [Ready] = useState(() => loaded);
    const Shown = Ready ?? Lazy;
    return (
      <ChunkBoundary>
        <Suspense fallback={fallback}>
          <Shown {...props} />
        </Suspense>
      </ChunkBoundary>
    );
  }
  return Object.assign(OnDemand, { prefetch: () => fetchChunk().then(noop, noop) });
}
const noop = () => {};

export const SettingsPage = onDemand(() => loadSettings().then((m) => m.SettingsPage), <PageFallback />);
export const AutomationsPage = onDemand(() => loadAutomations().then((m) => m.AutomationsPage), <PageFallback />);
export const NewChannelPage = onDemand(() => loadChannelSettings().then((m) => m.NewChannelPage), <PageFallback />);
export const ChannelSettingsTab = onDemand(() => loadChannelSettings().then((m) => m.ChannelSettingsTab), <PageFallback />);
const SetupWizard = onDemand(() => loadOnboarding().then((m) => m.SetupWizard), null);

/** The setup wizard, fetched the first time setup opens: a fresh install, or Settings' Run setup again. */
export function Onboarding() {
  const { setupOpen } = useApp();
  return setupOpen ? <SetupWizard /> : null;
}

/**
 * Fetches every chunk above once the first contentful paint is done and the page is next idle, so each opens at once
 * and none of their parsing holds that paint back. Safari has no requestIdleCallback (webstatus.dev, 2026-11-19), so a
 * timer stands in there. A browser without paint timing starts at once and still waits for idle.
 */
export function prefetchWhenIdle() {
  const run = () => {
    for (const c of [SettingsPage, ChannelSettingsTab, NewChannelPage, AutomationsPage, SetupWizard]) void c.prefetch();
  };
  const idle = () => ('requestIdleCallback' in window ? requestIdleCallback(run, { timeout: 5000 }) : setTimeout(run, 1000));
  const painted = () => performance.getEntriesByName('first-contentful-paint').length > 0;
  if (painted() || !PerformanceObserver.supportedEntryTypes?.includes('paint')) return void idle();
  const observer = new PerformanceObserver(() => {
    if (!painted()) return;
    observer.disconnect();
    idle();
  });
  observer.observe({ type: 'paint' });
}
