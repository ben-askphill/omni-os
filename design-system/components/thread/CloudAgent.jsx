import React from 'react';
import { Icon } from '../icons/Icon.jsx';
import { HarnessLogo } from '../icons/HarnessMark.jsx';
import { Status } from '../core/Status.jsx';

/* One Cursor cloud agent run in the transcript (web/src components/thread/CloudAgentCard.tsx, apps/mac
   CloudAgentCard.swift). A thread on the cursor-cloud harness gets one card per run, where the run started, showing
   its newest state: the status, the repo it cloned, the branch it pushed and the PR Cursor opened. */
const STATUS = {
  CREATING: { state: 'queued', label: 'Starting' },
  RUNNING: { state: 'running', label: 'Working' },
  FINISHED: { state: 'done', label: 'Finished' },
  ERROR: { state: 'failed', label: 'Error' },
  CANCELLED: { state: 'stopped', label: 'Stopped' },
  EXPIRED: { state: 'failed', label: 'Expired' },
};

const prNumber = (url) => {
  const m = String(url || '').match(/\/pull\/(\d+)(?:[/?#]|$)/);
  return m ? '#' + m[1] : null;
};

/* startingRef, not ref: React reserves ref. */
export function CloudAgentCard({ name, status = 'RUNNING', repo, startingRef, branch, prUrl, url = '#', mobile = false }) {
  const st = STATUS[status] || STATUS.RUNNING;
  const pr = prNumber(prUrl);
  return (
    <section className={'om-cloud' + (mobile ? ' om-cloud--phone' : '')} aria-label="Cursor cloud agent">
      <div className="om-cloud__head">
        <span className="om-cloud__mark"><HarnessLogo harness="cursor-cloud" size={15} /></span>
        <div className="om-cloud__body">
          <div className="om-cloud__title">
            <span className="om-cloud__name">{name || 'Cursor cloud agent'}</span>
            <Status state={st.state} label={st.label} />
          </div>
          <div className="om-cloud__meta">
            Cursor cloud agent{repo && <> · <span className="om-cloud__repo">{repo}</span>{startingRef && <> from {startingRef}</>}</>}
          </div>
        </div>
      </div>
      {(branch || prUrl) && (
        <div className="om-cloud__git">
          {branch && <span className="om-cloud__branch" title="The branch the agent pushed"><Icon name="branch" size={13} /><code>{branch}</code></span>}
          {prUrl && <a className="om-cloud__pr" href={prUrl} target="_blank" rel="noopener noreferrer"><Icon name="pr" size={13} />{pr ? 'PR ' + pr : 'Pull request'}</a>}
        </div>
      )}
      <div className="om-cloud__actions">
        <a className="om-btn om-btn--secondary om-btn--sm" href={url} target="_blank" rel="noopener noreferrer"><Icon name="external" size={14} /><span>Open in Cursor</span></a>
      </div>
    </section>
  );
}
