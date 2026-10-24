import type { CloudAgentP } from '../../transcript/fold.ts';
import { cloudStatus, prNumber } from '../../cloud-agent.ts';
import { HarnessLogo } from '../brand.tsx';
import { Icon, LinkButton, StatusPill } from '../ui.tsx';

/**
 * One Cursor cloud agent run: where it stands, the repo it cloned, the branch it pushed and the PR Cursor opened.
 * The same card on desktop and in the phone's turn.
 */
export function CloudAgentCard({ p }: { p: CloudAgentP }) {
  const st = cloudStatus(p.status);
  const pr = prNumber(p.pr_url);
  return (
    <section aria-label="Cursor cloud agent" className="rounded-[22px] bg-surface px-4 py-3">
      <div className="flex min-w-0 items-start gap-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-bg text-fg">
          <HarnessLogo harness="cursor-cloud" size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 truncate text-[13.5px] font-medium text-fg">{p.name || 'Cursor cloud agent'}</span>
            <span className="ml-auto shrink-0">
              <StatusPill status={st.status} label={st.label} />
            </span>
          </div>
          <div className="mt-0.5 truncate text-[12.5px] text-fg-3">
            Cursor cloud agent
            {p.repo && (
              <>
                {' · '}
                <span className="text-fg-2">{p.repo}</span>
                {p.ref && <> from {p.ref}</>}
              </>
            )}
          </div>
        </div>
      </div>
      {(p.branch || p.pr_url) && (
        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 pl-11 text-[12.5px] text-fg-2">
          {p.branch && (
            <span className="inline-flex min-w-0 items-center gap-1.5" title="The branch the agent pushed">
              <Icon name="branch" size={13} className="shrink-0 text-fg-3" />
              <span className="truncate font-mono text-[12px]">{p.branch}</span>
            </span>
          )}
          {p.pr_url && (
            <a href={p.pr_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 font-medium text-fg hover:underline">
              <Icon name="pr" size={13} className="text-fg-3" />
              {pr ? `PR ${pr}` : 'Pull request'}
            </a>
          )}
        </div>
      )}
      <div className="mt-2.5 pl-11">
        <LinkButton href={p.url} target="_blank" icon="external" size="sm">
          Open in Cursor
        </LinkButton>
      </div>
    </section>
  );
}
