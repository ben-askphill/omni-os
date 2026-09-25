import { useCallback, useState } from 'react';
import { api, errorText, useApi, type ChannelWithRunning, type Thread } from '../api.ts';
import { NewThreadComposer } from '../components/Composer.tsx';
import { ThreadGroups, useLiveThreads } from '../components/ThreadList.tsx';
import { Button, Chip, Empty, Icon, LinkButton, Loading, Tabs } from '../components/ui.tsx';
import { href, type ChannelTab } from '../router.ts';
import { useApp } from '../store.tsx';
import { ChannelSettingsForm } from './ChannelSettings.tsx';
import { PRDetail, PRList } from './PRs.tsx';

function ThreadsTab({ id, isConductor }: { id: string; isConductor: boolean }) {
  const accept = useCallback((t: Thread) => t.channel_id === id, [id]);
  const list = useLiveThreads(`/channels/${encodeURIComponent(id)}/threads`, accept);
  return (
    <div className="mx-auto max-w-3xl px-4 pt-5 pb-16 md:px-8">
      <NewThreadComposer channelId={id} placeholder={isConductor ? 'Ask the Conductor. It delegates to the crew.' : undefined} />
      <div className="mt-6">
        <ThreadGroups
          threads={list.data}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          empty={
            <Empty icon="message" title="No threads in this channel yet">
              Start one above. Crew threads delegated by the Conductor land here too.
            </Empty>
          }
        />
      </div>
    </div>
  );
}

/** Not in the active list: either archived (offer unarchive) or a bad id. */
function MissingChannel({ id }: { id: string }) {
  const { reloadChannels } = useApp();
  const res = useApi<ChannelWithRunning>(`/channels/${encodeURIComponent(id)}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unarchive = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/channels/${encodeURIComponent(id)}`, { archived: 0 });
      await reloadChannels();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  if (res.loading) return <div className="px-8"><Loading /></div>;
  const ch = res.data;
  if (!ch) {
    return (
      <div className="h-full overflow-y-auto">
        <Empty icon="hash" title={`#${id} not found`} action={<LinkButton href={href.home()}>Go home</LinkButton>}>
          The id is wrong, or the channel was deleted.
        </Empty>
      </div>
    );
  }
  return (
    <div className="h-full overflow-y-auto">
      <Empty
        icon="archive"
        title={`#${ch.name} is archived`}
        action={
          <div className="flex gap-2">
            <Button variant="primary" icon="archive" busy={busy} onClick={unarchive}>Unarchive</Button>
            <LinkButton href={href.home()}>Go home</LinkButton>
          </div>
        }
      >
        Its threads are kept. Unarchive to see them in the sidebar and start new ones.
        {error && <div className="mt-2 text-bad">{error}</div>}
      </Empty>
    </div>
  );
}

const KIND_LABEL: Record<string, string> = { client: 'Client', internal: 'Internal', personal: 'Personal', system: 'System' };

export function ChannelPage({ id, tab, pr }: { id: string; tab: ChannelTab; pr?: number }) {
  const { channel, channelsLoaded } = useApp();
  const ch = channel(id);

  if (!ch) {
    if (!channelsLoaded) return <div className="px-8"><Loading /></div>;
    return <MissingChannel id={id} />;
  }

  const isConductor = ch.id === 'conductor';
  const tabs = [
    { id: 'threads' as const, label: 'Threads', href: href.channel(id) },
    ...(isConductor ? [] : [{ id: 'prs' as const, label: 'PRs', href: href.prs(id) }]),
    { id: 'settings' as const, label: 'Settings', href: href.settings(id) },
  ];

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="border-b border-line px-4 pt-5 md:px-8">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="flex min-w-0 items-center gap-1.5 text-[20px] font-semibold tracking-[-0.03em]">
            {isConductor ? <Icon name="target" size={18} className="text-fg-3" /> : <span className="text-fg-4">#</span>}
            <span className="truncate">{ch.name}</span>
          </h1>
          <Chip>{KIND_LABEL[ch.kind] ?? ch.kind}</Chip>
          {ch.running > 0 && (
            <span className="flex items-center gap-1 text-[12px] font-medium text-info">
              <span className="pulse inline-block h-1.5 w-1.5 rounded-full bg-[var(--info-dot)]" /> {ch.running} running
            </span>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-fg-3">
          {ch.store_domain && (
            <a href={`https://${ch.store_domain}/admin`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-fg">
              <Icon name="globe" size={13} /> {ch.store_domain}
            </a>
          )}
          {ch.github_repo && (
            <a href={`https://github.com/${ch.github_repo}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-fg">
              <Icon name="branch" size={13} /> {ch.github_repo}
            </a>
          )}
          {ch.repo_path && <span className="truncate font-mono text-[11.5px]" title={ch.repo_path}>{ch.repo_path}</span>}
          {ch.notes && isConductor && <span className="truncate">{ch.notes}</span>}
        </div>
        <Tabs className="mt-3 -mb-px pb-2" tabs={tabs} value={tab} />
      </div>

      {tab === 'threads' && <ThreadsTab id={id} isConductor={isConductor} />}
      {tab === 'prs' && (pr ? <PRDetail channel={ch} n={pr} /> : <PRList channel={ch} />)}
      {tab === 'settings' && (
        <div className="mx-auto max-w-2xl px-4 pt-5 pb-16 md:px-8">
          <ChannelSettingsForm existing={ch} />
        </div>
      )}
    </div>
  );
}
