import { useState } from 'react';
import type { Artifact } from '../../../api.ts';
import { LiveBrowser } from '../../LiveBrowser.tsx';
import { Button, Empty, IconButton, Modal } from '../../ui.tsx';
import { plural } from '../../../format.ts';
import { Screenshots } from './Screenshots.tsx';

/**
 * The channel's browser, live: the same Chrome the agent drives, which Ben can click and type in.
 * The screenshots the agent saved sit one click away.
 */
export function BrowserTab({ channelId, shots }: { channelId: string; shots: Artifact[] }) {
  const [view, setView] = useState<'live' | 'shots'>('live');
  const [expanded, setExpanded] = useState(false);
  const extra = (
    <>
      <span className="relative">
        <IconButton icon="image" label={`Screenshots${shots.length ? ` (${shots.length})` : ''}`} size={15} active={view === 'shots'} onClick={() => setView((v) => (v === 'shots' ? 'live' : 'shots'))} />
        {shots.length > 0 && <span className="pointer-events-none absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-fg-3" />}
      </span>
      {view === 'live' && <IconButton icon="maximize" label="Expand" size={15} onClick={() => setExpanded(true)} />}
    </>
  );
  return (
    <div className="flex h-full min-h-0 flex-col">
      {view === 'shots' ? (
        <>
          <div className="flex items-center gap-1 px-2 pb-2">
            <Button size="sm" variant="ghost" icon="chevronLeft" onClick={() => setView('live')}>
              Live browser
            </Button>
            <span className="flex-1" />
            <span className="px-2 font-num text-[11px] text-fg-4">{plural(shots.length, 'screenshot')}</span>
          </div>
          <div className="min-h-0 flex-1">
            <Screenshots shots={shots} />
          </div>
        </>
      ) : expanded ? (
        <Empty icon="browser" title="Open in the expanded view">
          <Button size="sm" onClick={() => setExpanded(false)}>
            Bring it back here
          </Button>
        </Empty>
      ) : (
        <LiveBrowser channelId={channelId} extra={extra} />
      )}
      <Modal open={expanded} onClose={() => setExpanded(false)} wide title="Browser">
        <div className="h-[78vh] pb-3">
          <LiveBrowser channelId={channelId} />
        </div>
      </Modal>
    </div>
  );
}
