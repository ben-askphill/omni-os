import { useState } from 'react';
import { relTime } from '@omni/shared/format.ts';
import { artifactUrl, type ArtifactWithThread } from '../api.ts';
import { kindIcon } from '../components/ArtifactViewer.tsx';
import { MoGroup, MoListRow, MoSection } from './parts.tsx';

const FOLDED = 8;

/**
 * The files and screenshots of the threads this one delegated to, newest first, each naming its thread. A row opens it
 * full screen. The newest FOLDED show until Show all.
 */
export function CrewFileList({ files, shots, onOpen }: { files: ArtifactWithThread[]; shots: ArtifactWithThread[]; onOpen: (a: ArtifactWithThread) => void }) {
  const [all, setAll] = useState(false);
  const list = [...files, ...shots].sort((a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : b.id - a.id));
  if (!list.length) return null;
  const shown = all ? list : list.slice(0, FOLDED);
  const more = list.length - shown.length;
  return (
    <MoSection title="From delegated threads" count={list.length} pad={false}>
      <MoGroup>
        {shown.map((a, i) => (
          <MoListRow
            key={a.id}
            icon={a.kind === 'screenshot' ? <img src={artifactUrl(a)} alt="" loading="lazy" className="size-[18px] rounded-[4px] object-cover object-top ring-1 ring-line" /> : kindIcon(a.kind)}
            label={<span className="font-mono text-[13.5px]">{a.name}</span>}
            sub={a.thread_title || 'Untitled'}
            right={relTime(a.updated_at)}
            onClick={() => onOpen(a)}
            last={!more && i === shown.length - 1}
          />
        ))}
        {more > 0 && <MoListRow icon="chevronDown" label={`Show all ${list.length}`} chevron={false} onClick={() => setAll(true)} last />}
      </MoGroup>
    </MoSection>
  );
}
