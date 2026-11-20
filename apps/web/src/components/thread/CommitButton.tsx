import { useState } from 'react';
import { commitSubject } from '@omni/shared/remote-agent.ts';
import { api, errorText, type Thread } from '../../api.ts';
import { Button, ErrorNote, Label, Modal, ModalFooter } from '../ui.tsx';

/**
 * Commit, in a thread a remote agent leads (ADR 0020, Q64): the lead talks only and only the lead commits, so Ben
 * commits the local members' edits himself. It opens a sheet with the message, the thread's title to start with. The
 * desktop composer and the phone's composer chips both open it.
 */
export function CommitSheet({ thread, files, open, onClose, onDone }: { thread: Thread; files: number; open: boolean; onClose: () => void; onDone: (r: { sha: string; files: number }) => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Commit the changes">
      {open && <CommitForm thread={thread} files={files} onClose={onClose} onDone={onDone} />}
    </Modal>
  );
}

function CommitForm({ thread, files, onClose, onDone }: { thread: Thread; files: number; onClose: () => void; onDone: (r: { sha: string; files: number }) => void }) {
  const [message, setMessage] = useState(() => commitSubject(thread.title));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const commit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ sha: string; files: number }>(`/threads/${encodeURIComponent(thread.id)}/commit`, { message });
      onDone(r);
      onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="space-y-3 px-6 pb-5">
        <p className="text-[13px] text-fg-2">
          {files} changed {files === 1 ? 'file' : 'files'} in this thread's worktree, from the local agents seated here. The remote agent that leads it talks only, so you commit.
        </p>
        <div>
          <Label htmlFor="commit-message">Message</Label>
          <textarea id="commit-message" className="field min-h-[72px] w-full resize-y" value={message} maxLength={2000} onChange={(e) => setMessage(e.target.value)} />
        </div>
        {error && <ErrorNote>{error}</ErrorNote>}
      </div>
      <ModalFooter>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" icon="check" busy={busy} disabled={busy || !message.trim()} onClick={() => void commit()}>
          Commit
        </Button>
      </ModalFooter>
    </>
  );
}

/** The composer's Commit button: shown while a remote-led thread's worktree has changes no one committed. */
export function CommitButton({ thread, files, onDone }: { thread: Thread; files: number; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="primary" icon="check" title={`Commit ${files} changed ${files === 1 ? 'file' : 'files'}`} onClick={() => setOpen(true)}>
        Commit
      </Button>
      <CommitSheet thread={thread} files={files} open={open} onClose={() => setOpen(false)} onDone={onDone} />
    </>
  );
}
