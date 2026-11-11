import { useEffect, useState } from 'react';
import type { DesktopBridge, DesktopUpdateView } from '@omni/shared/desktop-bridge.ts';
import { api, errorText, useApi, type UpdateView } from '../api.ts';
import { appUpdateNotice, appUpdateWords } from '../app-update-notice.ts';
import { desktop } from '../desktop.ts';
import { useApp, useFeed } from '../store.tsx';
import { clearUpdateMark, markUpdateStarted, reloadAfterUpdate, updateNotice } from '../update-notice.ts';
import { Loader } from './brand.tsx';
import { Button, Icon, IconButton } from './ui.tsx';

const DISMISSED_KEY = 'omni.update.dismissed';

/** The app update notice Ben dismissed, by its key. Per browser, and only a convenience: it shows again for the next state. */
function useDismissed(): [string | null, (key: string) => void] {
  const [dismissed, setDismissed] = useState<string | null>(() => {
    try {
      return localStorage.getItem(DISMISSED_KEY);
    } catch {
      return null;
    }
  });
  const dismiss = (key: string) => {
    setDismissed(key);
    try {
      localStorage.setItem(DISMISSED_KEY, key);
    } catch {
      // Private mode: dismissed for this page only.
    }
  };
  return [dismissed, dismiss];
}

/** GET /api/update, fresh on every update and reconnect message. Reloads the page once an Update it started lands. */
export function useUpdate() {
  const res = useApi<UpdateView>('/update');
  const { data, reload, setData } = res;
  useFeed((e) => {
    if (e.type === 'update' || e.type === 'reconnect') reload();
  });
  useEffect(() => {
    if (data && reloadAfterUpdate(sessionStorage, data)) window.location.reload();
  }, [data]);
  return { data, reload, setData };
}

/**
 * Shown in the desktop sidebar and on the phone's Activity screen: the server's checkout, and in the packaged desktop
 * app also the app's own update, which brings a new server with it. A bundled server has no checkout and says
 * nothing; a checkout server the app attached to keeps its notice.
 */
export function UpdateNotice({ className = '' }: { className?: string }) {
  if (!desktop?.packaged) return <ServerUpdateNotice className={className} />;
  return (
    <>
      <AppUpdateNotice bridge={desktop} className={className} />
      <ServerUpdateNotice className={className} />
    </>
  );
}

/** The desktop app's updater (desktop.updates): one to download, a download under way, one ready for Relaunch, or a failure. */
function AppUpdateNotice({ bridge, className }: { bridge: DesktopBridge; className: string }) {
  const [{ view, afterDownload }, setShown] = useState<{ view: DesktopUpdateView | null; afterDownload: boolean }>({ view: null, afterDownload: false });
  const [retrying, setRetrying] = useState(false);
  const [dismissed, dismiss] = useDismissed();
  const running = useApp().status?.running ?? 0;
  useEffect(() => {
    let live = true;
    const show = (next: DesktopUpdateView) =>
      live &&
      setShown((cur) => ({ view: next, afterDownload: next.state === 'downloading' || (next.state === 'error' && cur.afterDownload) }));
    void bridge.updates.get().then(show);
    const off = bridge.onEvent((event) => {
      if (event.type === 'update') show(event.update);
    });
    return () => {
      live = false;
      off();
    };
  }, [bridge]);

  const notice = appUpdateNotice(view, afterDownload);
  if (!notice || (notice.key && notice.key === dismissed)) return null;
  const { action } = notice;
  const run = () => {
    if (!action) return;
    if (action.kind === 'install') bridge.updates.install();
    // The answer comes back as update events: the download's progress, then ready.
    else if (action.kind === 'fetch') void bridge.updates.download();
    // The app opens a page outside Omni in the default browser.
    else if (action.kind === 'download') window.open(action.url, '_blank', 'noopener,noreferrer');
    else {
      setRetrying(true);
      // The answer comes back as an update event too.
      void bridge.updates.check().finally(() => setRetrying(false));
    }
  };
  return (
    <div className={`rounded-[20px] bg-bg/70 px-3 py-2.5 shadow-[var(--shadow-card)] ${className}`} role="status">
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-fg-3">{notice.busy ? <Loader size={14} /> : <Icon name={notice.failed ? 'alert' : 'download'} size={14} />}</span>
        <span className="min-w-0 flex-1 text-[12px] leading-[1.35] text-fg" title={notice.detail}>
          {notice.text}
        </span>
        {notice.key && <IconButton icon="x" label="Dismiss" size={13} className="-my-1 -mr-1.5" onClick={() => dismiss(notice.key!)} />}
      </div>
      {action?.kind === 'install' && running > 0 && <p className="mt-1 pl-[22px] text-[11.5px] leading-[1.35] text-fg-3">{appUpdateWords.running(running)}</p>}
      {/* Its own row: the sidebar is too narrow for the text and "Relaunch to update" side by side. */}
      {action && (
        <Button size="sm" variant={action.kind === 'install' || action.kind === 'fetch' ? 'primary' : 'ghost'} busy={action.kind === 'retry' && retrying} onClick={run} className="mt-2 w-full">
          {action.label}
        </Button>
      )}
    </div>
  );
}

/**
 * New commits on main, and the one Update button: it waits for running turns, updates the checkout, rebuilds and
 * restarts the server. Nothing when level.
 */
function ServerUpdateNotice({ className }: { className: string }) {
  const { data, setData } = useUpdate();
  const [error, setError] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const notice = updateNotice(data);
  if (!notice) return null;

  const act = async () => {
    if (!data || !notice.action) return;
    setError(null);
    setPosting(true);
    try {
      if (notice.action === 'update') {
        markUpdateStarted(sessionStorage, data.current);
        setData(await api.post<UpdateView>('/update'));
      } else if (notice.action === 'cancel') {
        clearUpdateMark(sessionStorage);
        await api.post('/update/cancel');
      } else {
        setData(await api.post<UpdateView>('/update/dismiss'));
      }
    } catch (e) {
      if (notice.action === 'update') clearUpdateMark(sessionStorage);
      setError(errorText(e));
    } finally {
      setPosting(false);
    }
  };

  const label = notice.action === 'update' ? 'Update' : notice.action === 'cancel' ? 'Cancel' : 'Dismiss';
  return (
    <div className={`rounded-[20px] bg-bg/70 px-3 py-2.5 shadow-[var(--shadow-card)] ${className}`} role="status">
      <div className="flex items-center gap-2">
        <span className={`shrink-0 text-fg-3`}>
          {notice.busy ? <Loader size={14} /> : <Icon name={notice.failed ? 'alert' : 'download'} size={14} />}
        </span>
        <span className="min-w-0 flex-1 text-[12px] leading-[1.35] text-fg" title={notice.detail ?? undefined}>
          {notice.text}
        </span>
        {notice.action && (
          <Button size="sm" variant={notice.action === 'update' ? 'primary' : 'ghost'} busy={posting} onClick={() => void act()}>
            {label}
          </Button>
        )}
      </div>
      {notice.detail && notice.action === 'update' && (
        <details className="mt-1.5 text-[11px] text-fg-3">
          <summary className="cursor-pointer select-none">What is new</summary>
          <ul className="mt-1 space-y-0.5 pl-1">
            {notice.detail.split('\n').map((line, i) => (
              <li key={i} className="truncate" title={line}>
                {line}
              </li>
            ))}
          </ul>
        </details>
      )}
      {error && <div className="mt-1.5 text-[11px] text-fg-2">{error}</div>}
    </div>
  );
}
