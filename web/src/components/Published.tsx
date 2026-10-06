import { useState } from 'react';
import type { Published } from '../../../shared/published.ts';
import { api, errorText, type Artifact } from '../api.ts';
import { href } from '../router.ts';
import { Button, Icon, IconButton, LinkButton } from './ui.tsx';

/** Asks the thread that published a page to act on its comments. The ask is queued after the thread's turn. */
export function useCheckComments(threadId: string, url: string) {
  const [state, setState] = useState<{ busy: boolean; sent: boolean; error: string | null }>({ busy: false, sent: false, error: null });
  const run = async () => {
    setState({ busy: true, sent: false, error: null });
    try {
      await api.post(`/threads/${encodeURIComponent(threadId)}/published/comments`, { url });
      setState({ busy: false, sent: true, error: null });
    } catch (e) {
      setState({ busy: false, sent: false, error: errorText(e) });
    }
  };
  return { ...state, run };
}

/** The viewer's header controls for a published file: the claude.ai page, and its comments. */
export function PublishedActions({ a }: { a: Artifact }) {
  const check = useCheckComments(a.thread_id, a.url ?? '');
  if (!a.url) return null;
  return (
    <>
      <IconButton
        icon={check.sent ? 'check' : 'message'}
        label={check.error ?? (check.sent ? 'Asked the thread to check comments' : 'Check comments on claude.ai')}
        onClick={check.run}
        disabled={check.busy || check.sent}
        size={15}
      />
      <a
        href={a.url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Open on claude.ai"
        title="Open on claude.ai"
        className="hov press inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-fg-3 transition-colors hover:text-fg"
      >
        <Icon name="globe" size={15} />
      </a>
    </>
  );
}

/** A page the thread published to claude.ai, shown once, after the last call that published it. */
export function PublishedCard({ p, threadId, artifact }: { p: Published; threadId: string; artifact?: Artifact }) {
  const check = useCheckComments(threadId, p.url);
  return (
    <div className="rounded-[22px] bg-surface px-4 py-3">
      <div className="flex min-w-0 items-start gap-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-bg text-fg-3">
          <Icon name="globe" size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="min-w-0 truncate text-[13.5px] font-medium text-fg">{p.title}</span>
            <span className="shrink-0 text-[11.5px] text-fg-4">{p.update ? 'Republished' : 'Published'} on claude.ai</span>
          </div>
          {p.description && <div className="mt-0.5 line-clamp-2 text-[12.5px] leading-snug text-fg-3">{p.description}</div>}
        </div>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5 pl-11">
        <LinkButton href={p.url} target="_blank" icon="external" size="sm" variant="primary">
          Open
        </LinkButton>
        {artifact && (
          <LinkButton href={href.thread(threadId, artifact.id)} icon="layers" size="sm">
            Preview
          </LinkButton>
        )}
        <Button size="sm" variant="ghost" icon={check.sent ? 'check' : 'message'} busy={check.busy} disabled={check.sent} onClick={check.run}>
          {check.sent ? 'Asked, runs after this turn' : 'Check comments'}
        </Button>
        {check.error && <span className="text-[11.5px] text-fg-2">{check.error}</span>}
      </div>
    </div>
  );
}
