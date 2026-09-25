import { NewThreadComposer } from '../components/Composer.tsx';
import { ThreadGroups, useLiveThreads } from '../components/ThreadList.tsx';
import { Empty } from '../components/ui.tsx';

const acceptAll = () => true;

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Late one' : h < 12 ? 'Morning, Ben' : h < 18 ? 'Afternoon, Ben' : 'Evening, Ben';
}

export function HomePage() {
  const recent = useLiveThreads('/recent?limit=60', acceptAll, 60);
  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 pt-6 pb-16 md:px-8 md:pt-10">
        <h1 className="mb-3 text-[22px] font-semibold tracking-[-0.035em] md:text-[26px]">{greeting()}</h1>
        <NewThreadComposer big />
        <div className="mt-8">
          <h2 className="mb-2 px-3 text-[13px] font-semibold text-fg-2">Recent across channels</h2>
          <ThreadGroups
            threads={recent.data}
            loading={recent.loading}
            error={recent.error}
            onRetry={recent.reload}
            showChannel
            empty={
              <Empty icon="message" title="Nothing here yet">
                Start a thread above. Every task gets its own thread in a channel, so it stays findable.
              </Empty>
            }
          />
        </div>
      </div>
    </div>
  );
}
