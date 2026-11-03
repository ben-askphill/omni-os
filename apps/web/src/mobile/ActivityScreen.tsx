import { useInbox } from '../app/useInbox.ts';
import { OmniMark } from '../components/brand.tsx';
import { UpdateNotice } from '../components/UpdateNotice.tsx';
import { href } from '../router.ts';
import { useNow } from '../store.tsx';
import { HeaderActions } from './HeaderActions.tsx';
import { MoDoneRow, MoInboxRow, MoShelf, MoShowMore } from './InboxRows.tsx';
import { MoEmpty, MoHeader, MoScroll, MoTitle } from './parts.tsx';
import { useShell } from './shell.tsx';

/**
 * Home on a phone: the sidebar's Inbox as a list. Pinned threads, then the threads waiting on Ben, the latest back
 * first; Working and Done fold away below them.
 */
export function ActivityScreen() {
  const shell = useShell();
  const now = useNow(60_000);
  const { pinned, inbox, working, done, loaded, status, delegates } = useInbox();
  const waiting = [...pinned, ...inbox];
  const mark = waiting.some((t) => status(t)?.glyph === 'needs') ? 'attention' : working.count ? 'delegating' : 'idle';
  const date = new Date(now).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <>
      <MoHeader
        left={
          <button type="button" onClick={() => shell.open(href.channel('conductor'))} aria-label="Open the Conductor" className="mo-press flex h-10 items-center gap-2 px-1.5">
            <OmniMark size={30} state={mark} />
            <span className="text-[14px] leading-none font-medium">Conductor</span>
          </button>
        }
        right={<HeaderActions />}
      />
      <MoScroll tabBar>
        <div>
          <MoTitle title="Activity" sub={`${date} · ${waiting.length} waiting · ${working.count} working`} />
          <UpdateNotice className="mx-4 mb-3" />
        </div>
        <div className="flex flex-col px-4">
          {waiting.map((t, i) => (
            <MoInboxRow key={t.id} t={t} status={status(t)} delegated={delegates.get(t.id)} pinned={i < pinned.length} last={i === waiting.length - 1} />
          ))}
          {loaded && !waiting.length && <MoEmpty>Nothing is waiting on you.</MoEmpty>}
        </div>
        <div className="flex flex-col px-4">
          {working.count > 0 && (
            <>
              <MoShelf label="Working" shelf={working} />
              {working.rows.map((t, i) => (
                <MoInboxRow key={t.id} t={t} status={status(t)} delegated={delegates.get(t.id)} last={i === working.rows.length - 1} />
              ))}
            </>
          )}
          <MoShelf label="Done" shelf={done} />
          {done.rows.map((t, i) => (
            <MoDoneRow key={t.id} t={t} last={i === done.rows.length - 1} />
          ))}
          {done.more > 0 && <MoShowMore count={done.more} onClick={done.showMore} />}
        </div>
      </MoScroll>
    </>
  );
}
