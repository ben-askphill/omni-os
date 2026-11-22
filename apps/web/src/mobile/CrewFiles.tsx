import { useState } from 'react';
import { relTime } from '@omni/shared/format.ts';
import { artifactUrl, type Artifact, type ArtifactWithThread } from '../api.ts';
import { kindIcon } from '../components/ArtifactViewer.tsx';
import { MoGroup, MoListRow, MoSection } from './parts.tsx';

const FOLDED = 8;

const newestFirst = (a: Artifact, b: Artifact) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : b.id - a.id);

/** The thread's own files and screenshots, newest first. A row opens it full screen. */
export function ThreadFileList({ files, shots, onOpen }: { files: Artifact[]; shots: Artifact[]; onOpen: (a: Artifact) => void }) {
  return <FileList title="Files" list={[...files, ...shots].sort(newestFirst)} onOpen={onOpen} />;
}

/**
 * The files and screenshots of the threads this one delegated to, newest first, each naming its thread. A row opens it
 * full screen.
 */
export function CrewFileList({ files, shots, onOpen }: { files: ArtifactWithThread[]; shots: ArtifactWithThread[]; onOpen: (a: ArtifactWithThread) => void }) {
  return <FileList title="From delegated threads" list={[...files, ...shots].sort(newestFirst)} sub={(a) => a.thread_title || 'Untitled'} onOpen={onOpen} />;
}

/** A section of files, the newest FOLDED until Show all. Nothing when the list is empty. */
function FileList<A extends Artifact>({ title, list, sub, onOpen }: { title: string; list: A[]; sub?: (a: A) => string; onOpen: (a: A) => void }) {
  const [all, setAll] = useState(false);
  if (!list.length) return null;
  const shown = all ? list : list.slice(0, FOLDED);
  const more = list.length - shown.length;
  return (
    <MoSection title={title} count={list.length} pad={false}>
      <MoGroup>
        {shown.map((a, i) => (
          <MoListRow
            key={a.id}
            icon={a.kind === 'screenshot' ? <img src={artifactUrl(a)} alt="" loading="lazy" className="size-[18px] rounded-[4px] object-cover object-top ring-1 ring-line" /> : kindIcon(a.kind)}
            label={<span className="font-mono text-[13.5px]">{a.name}</span>}
            sub={sub?.(a)}
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
