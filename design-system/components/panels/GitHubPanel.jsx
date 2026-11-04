import React from 'react';
import { Panel, PanelSection } from './Panel.jsx';
import { StatusGlyph } from '../core/Status.jsx';
import { Chip } from '../core/Monogram.jsx';
import { Button } from '../core/Button.jsx';
import { Icon } from '../icons/Icon.jsx';
import { Loader } from '../brand/Loader.jsx';
import { SlideToConfirm } from '../forms/SlideToConfirm.jsx';

function DiffBar({ add, del, cells = 24 }) {
  const tot = Math.max(1, add + del);
  const a = Math.round((add / tot) * cells), d = Math.min(cells - a, Math.round((del / tot) * cells));
  return (
    <div className="om-ticks" style={{ '--ticks-h': '12px', marginTop: 2 }} aria-hidden="true">
      {Array.from({ length: cells }).map((_, i) => <i key={i} data-on={i < a || undefined} style={i >= a && i < a + d ? { height: '100%', background: 'transparent', boxShadow: 'inset 0 0 0 1.5px var(--fg)' } : undefined} />)}
    </div>
  );
}

const PR_FLAG = { open: ['default', 'Open'], draft: ['outline', 'Draft'], merged: ['done', 'Merged'], blocked: ['needs', 'Blocked'] };

export function GitHubPanel({ pr, onClose, onMerge, width, resizable, onResize }) {
  const checks = pr.checks || [];
  const pass = checks.filter((c) => c.state === 'done' || c.state === 'settled').length;
  const running = checks.some((c) => c.state === 'running' || c.state === 'queued');
  const failed = checks.some((c) => c.state === 'needs');
  const [tone, label] = PR_FLAG[pr.state] || PR_FLAG.open;
  return (
    <Panel title={'PR #' + pr.number} icon="pr" meta={pr.repo} onClose={onClose} width={width} resizable={resizable} onResize={onResize}>
      <div style={{ padding: '2px 4px 8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}><Chip tone={tone}>{label}</Chip>{pr.taskId && <span className="om-tid">{pr.taskId}</span>}</div>
        <div className="om-display" style={{ fontSize: 17, lineHeight: 1.3, color: 'var(--fg)', textWrap: 'pretty' }}>{pr.title}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, minWidth: 0 }}>
          <span className="om-trow__branch" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{pr.branch}</span>
          <Icon name="arrowRight" size={12} style={{ color: 'var(--fg-4)' }} />
          <span className="om-trow__branch">{pr.base || 'main'}</span>
        </div>
      </div>
      <PanelSection label="Checks" meta={`${pass}/${checks.length}`}>
        {checks.map((c) => (
          <div className="om-check" key={c.name}>
            <span style={{ display: 'grid', placeItems: 'center' }}>{c.state === 'running' ? <Loader size={12} /> : c.state === 'done' || c.state === 'settled' ? <Icon name="check" size={13} style={{ color: 'var(--fg)' }} /> : <StatusGlyph state={c.state} />}</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: c.state === 'needs' ? 'var(--fg)' : undefined }}>{c.name}</span>
            <span className="om-check__dur">{c.duration}</span>
          </div>
        ))}
      </PanelSection>
      <PanelSection label="Changes" meta={`+${pr.additions} −${pr.deletions}`}>
        <DiffBar add={pr.additions} del={pr.deletions} />
        <div style={{ marginTop: 10 }}>{(pr.files || []).map((f) => <div className="om-file" key={f.path}><span title={f.path}>{f.path}</span><span>+{f.add} −{f.del}</span></div>)}</div>
      </PanelSection>
      <div style={{ display: 'grid', gap: 8, paddingTop: 4 }}>
        <SlideToConfirm label={pr.state === 'merged' ? 'Merged' : running ? 'Merge unlocks when checks pass' : 'Slide to merge into ' + (pr.base || 'main')} doneLabel="Merged" busyLabel="Merging" disabled={running || failed || pr.state === 'merged'} onConfirm={onMerge || (() => new Promise((r) => setTimeout(r, 900)))} />
        <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
          <Button variant="ghost" size="sm" icon="diff">View diff</Button>
          <Button variant="ghost" size="sm" icon="external">GitHub</Button>
        </div>
      </div>
    </Panel>
  );
}
