// Review notes in a thread's Changes panel (packages/shared/review-notes.ts): each open or sent one pinned under its
// lines in the diff, the ones whose lines are gone listed as outdated, resolved ones kept collapsed as history, and
// Send open notes, which puts every open one on one message.
import { useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { relTime } from '@omni/shared/format.ts';
import type { DiffSelection } from '@omni/shared/message-context-diff.ts';
import {
  NOTE_BODY_MAX,
  noteLabel,
  noteState,
  placeNotes,
  type NotePlace,
  type PlaceFile,
  type ReviewNote,
  type ReviewNotesList,
  type ReviewNotesSent,
} from '@omni/shared/review-notes.ts';
import type { ChangeGroupView } from '@omni/shared/changes-view.ts';
import { api, errorText, useApi } from '../../../api.ts';
import { plural } from '../../../format.ts';
import { ShellCtx } from '../../../mobile/shell.tsx';
import { useFeed } from '../../../store.tsx';
import type { LineNotes } from '../../DiffViewer.tsx';
import { Button, Chip, ErrorNote, Icon, IconButton } from '../../ui.tsx';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export type NoteActions = {
  add(anchor: DiffSelection, body: string): Promise<void>;
  update(id: string, change: { body?: string; resolved?: boolean }): Promise<void>;
  remove(id: string): Promise<void>;
  send(): Promise<void>;
};

/** The thread's notes, kept fresh by the feed (an edit here, on the phone or on the other Mac), and what changes them. */
export function useReviewNotes(threadId: string) {
  const path = `/threads/${encodeURIComponent(threadId)}/review-notes`;
  const { data, error, reload, setData } = useApi<ReviewNotesList>(path);
  useFeed((e) => {
    if (e.type === 'review_notes' && e.thread_id === threadId) reload();
  });
  const put = useCallback(
    (list: ReviewNote[]) =>
      setData((prev) => {
        const notes = [...(prev?.notes ?? [])];
        for (const n of list) {
          const i = notes.findIndex((x) => x.id === n.id);
          if (i >= 0) notes[i] = n;
          else notes.push(n);
        }
        return { notes };
      }),
    [setData],
  );
  const actions = useMemo<NoteActions>(
    () => ({
      add: async (anchor, body) => put([(await api.post<{ note: ReviewNote }>(path, { anchor, body })).note]),
      update: async (id, change) => put([(await api.patch<{ note: ReviewNote }>(`${path}/${encodeURIComponent(id)}`, change)).note]),
      remove: async (id) => {
        await api.del(`${path}/${encodeURIComponent(id)}`);
        setData((prev) => ({ notes: (prev?.notes ?? []).filter((n) => n.id !== id) }));
      },
      send: async () => put((await api.post<ReviewNotesSent>(`${path}/send`, {})).sent),
    }),
    [path, put, setData],
  );
  return { notes: data?.notes ?? null, error, reload, actions };
}

export type ReviewNotesState = ReturnType<typeof useReviewNotes>;

/** The files on screen, as placeNote reads them. */
export const placeFiles = (groups: readonly ChangeGroupView[] | undefined): PlaceFile[] =>
  (groups ?? []).flatMap((g) => g.files.map((f) => ({ key: f.key, path: f.diff.path, old_path: f.file.old_path, lines: f.diff.lines })));

/**
 * The unresolved notes placed on the groups on screen: by note, and per file the lines they mark and each card under
 * its last line. Resolved notes are history and stay off the diff.
 */
export function useNotePlaces(notes: readonly ReviewNote[] | null, groups: readonly ChangeGroupView[] | undefined, actions: NoteActions) {
  const live = useMemo(() => (notes ?? []).filter((n) => !n.resolved_at), [notes]);
  const placed = useMemo(() => placeNotes(live, placeFiles(groups)), [live, groups]);
  const byFile = useMemo(() => {
    const out = new Map<string, { marks: Set<number>; after: Map<number, ReactNode[]> }>();
    for (const n of live) {
      const p = placed.get(n.id);
      if (!p) continue;
      const f = out.get(p.file) ?? { marks: new Set<number>(), after: new Map<number, ReactNode[]>() };
      for (let i = p.from; i <= p.to; i++) f.marks.add(i);
      f.after.set(p.to, [...(f.after.get(p.to) ?? []), <NoteCard key={n.id} note={n} place={p} actions={actions} inline />]);
      out.set(p.file, f);
    }
    return new Map<string, LineNotes>([...out].map(([k, f]) => [k, { marks: f.marks, after: new Map([...f.after].map(([i, cards]) => [i, <div key={i}>{cards}</div>])) }]));
  }, [live, placed, actions]);
  return { placed, byFile };
}

/**
 * Over the diff when the thread has notes: how many are open, Send open notes, the unresolved ones whose lines are not
 * on screen and the resolved ones, collapsed. `turn`: This turn shows one turn, so a note off it is only counted.
 */
export function NotesBar({ notes, placed, actions, turn = false }: { notes: readonly ReviewNote[]; placed: ReadonlyMap<string, NotePlace>; actions: NoteActions; turn?: boolean }) {
  const shell = useContext(ShellCtx);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState(false);
  if (!notes.length) return null;
  const open = notes.filter((n) => noteState(n) === 'open').length;
  const sent = notes.filter((n) => noteState(n) === 'sent').length;
  const resolved = notes.filter((n) => n.resolved_at);
  const away = notes.filter((n) => !n.resolved_at && !placed.has(n.id));

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await actions.send();
      // As after Add to message: the phone goes back to the thread, where the message now is.
      shell?.back();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Review notes" className="mb-3 rounded-[18px] bg-surface px-3 pt-2.5 pb-3">
      <div className="flex min-h-8 items-center gap-2">
        <Icon name="pin" size={14} className="shrink-0 text-[var(--live)]" />
        <div className="min-w-0 flex-1 truncate text-[12.5px] leading-snug">
          <span className="font-medium text-fg">{plural(open, 'open note')}</span>
          {(sent > 0 || resolved.length > 0) && (
            <span className="text-fg-3">
              {sent > 0 && ` · ${sent} sent`}
              {resolved.length > 0 && ` · ${resolved.length} resolved`}
            </span>
          )}
        </div>
        <Button size="sm" variant="primary" icon="send" disabled={!open} busy={busy} onClick={send}>
          Send open notes
        </Button>
      </div>
      {error && <ErrorNote className="mt-2">{error}</ErrorNote>}
      {away.length > 0 &&
        (turn ? (
          <p className="mt-1.5 text-[11.5px] leading-snug text-fg-3">{`${plural(away.length, 'note')} ${away.length === 1 ? 'is' : 'are'} on lines this turn did not change. Since base shows ${away.length === 1 ? 'it' : 'them'}.`}</p>
        ) : (
          <div className="mt-2 space-y-1.5">
            {away.map((n) => (
              <NoteCard key={n.id} note={n} place={null} actions={actions} />
            ))}
          </div>
        ))}
      {resolved.length > 0 && (
        <div className="mt-2">
          <button
            type="button"
            aria-expanded={history}
            onClick={() => setHistory((h) => !h)}
            className="hov -mx-1 flex h-7 items-center gap-1.5 rounded-full px-1.5 text-[11.5px] font-medium text-fg-3 hover:text-fg"
          >
            <Icon name="chevronRight" size={11} className={`transition-transform duration-300 [transition-timing-function:var(--ease-settle)] ${history ? 'rotate-90' : ''}`} />
            Resolved {resolved.length}
          </button>
          {history && (
            <div className="mt-1 space-y-1.5">
              {resolved.map((n) => (
                <NoteCard key={n.id} note={n} place={placed.get(n.id) ?? null} actions={actions} />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * One note. `inline` sits under its lines in the diff. `place` null with the note unresolved: its lines are gone, so it
 * shows them as Ben picked them. A resolved note is one line until opened.
 */
export function NoteCard({ note, place, actions, inline = false }: { note: ReviewNote; place: NotePlace | null; actions: NoteActions; inline?: boolean }) {
  const state = noteState(note);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.body);
  const [expanded, setExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const outdated = !place && state !== 'resolved';

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    if (!draft.trim()) return setError('Write the note first.');
    if (await run(() => actions.update(note.id, { body: draft }))) setEditing(false);
  };

  const label = noteLabel(note);
  const name = label.split('/').pop() ?? label;
  const shell = inline ? 'mx-2 my-2 rounded-[14px] bg-elev shadow-[var(--shadow-card)]' : 'rounded-[14px] bg-bg shadow-[inset_0_0_0_1px_var(--line)]';

  if (state === 'resolved' && !expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        aria-label={`Resolved note on ${label}: ${note.body}`}
        className={`hov flex h-8 w-full min-w-0 items-center gap-2 px-2.5 text-left text-[12px] text-fg-3 ${shell}`}
      >
        <Icon name="check" size={12} className="shrink-0" />
        <span className="shrink-0 font-mono text-[11px]" title={label}>
          {name}
        </span>
        <span className="min-w-0 flex-1 truncate">{note.body}</span>
      </button>
    );
  }

  return (
    <article aria-label={`Note on ${label}`} data-note-state={outdated ? 'outdated' : state} className={`px-2.5 pt-1.5 pb-2.5 font-sans whitespace-normal ${shell}`}>
      <header className="flex min-h-7 items-center gap-1.5 text-[11.5px] text-fg-3">
        <Icon name={state === 'resolved' ? 'check' : 'pin'} size={12} className={`shrink-0 ${state === 'resolved' ? '' : 'text-[var(--live)]'}`} />
        <span className="min-w-0 truncate font-mono text-[11px]" title={label}>
          {name}
        </span>
        {outdated ? (
          <Chip tone="outline" title="The lines this note was on are not in the diff any more">
            Outdated
          </Chip>
        ) : place?.moved ? (
          <Chip tone="outline" title="The lines moved since the note was written">
            Moved
          </Chip>
        ) : null}
        {state === 'sent' && note.sent_at && <Chip title={`Sent ${relTime(note.sent_at)}`}>Sent</Chip>}
        {state === 'resolved' && <Chip>Resolved</Chip>}
        <span className="ml-auto flex shrink-0 items-center">
          {state === 'resolved' ? (
            <>
              <IconButton icon="undo" label="Reopen note" size={13} className="!h-7 !w-7" disabled={busy} onClick={() => run(() => actions.update(note.id, { resolved: false }))} />
              <IconButton icon="chevronDown" label="Collapse note" size={13} className="!h-7 !w-7" onClick={() => setExpanded(false)} />
            </>
          ) : (
            !editing && (
              <>
                <IconButton
                  icon="pencil"
                  label="Edit note"
                  size={13}
                  className="!h-7 !w-7"
                  disabled={busy}
                  onClick={() => {
                    setDraft(note.body);
                    setEditing(true);
                  }}
                />
                <IconButton icon="check" label="Resolve note" size={13} className="!h-7 !w-7" disabled={busy} onClick={() => run(() => actions.update(note.id, { resolved: true }))} />
              </>
            )
          )}
          {!editing &&
            (confirmDelete ? (
              <Button size="sm" variant="danger" className="!h-7 !px-2" disabled={busy} onClick={() => run(() => actions.remove(note.id))} onBlur={() => setConfirmDelete(false)} autoFocus>
                Delete?
              </Button>
            ) : (
              <IconButton icon="trash" label="Delete note" size={13} className="!h-7 !w-7" disabled={busy} onClick={() => setConfirmDelete(true)} />
            ))}
        </span>
      </header>
      {editing ? (
        <div data-keeps-esc="">
          <textarea
            value={draft}
            maxLength={NOTE_BODY_MAX}
            rows={3}
            autoFocus
            aria-label="Note"
            onChange={(e) => {
              setDraft(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void save();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                setEditing(false);
              }
            }}
            className="mt-1 block w-full resize-none rounded-xl bg-surface px-3 py-2 text-[16px] leading-[1.45] text-fg outline-none focus:shadow-[inset_0_0_0_1px_var(--line-strong)] sm:text-[13px]"
          />
          <div className="mt-2 flex items-center justify-end gap-1.5">
            <span className="mr-auto hidden pl-1 text-[11.5px] text-fg-3 sm:inline">{isMac ? '⌘↵' : 'Ctrl ↵'} save · Esc cancel</span>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" busy={busy} disabled={!draft.trim()} onClick={save}>
              Save
            </Button>
          </div>
        </div>
      ) : (
        <p className="mt-0.5 text-[13px] leading-[1.45] break-words whitespace-pre-wrap text-fg">{note.body}</p>
      )}
      {outdated && (
        <pre className="scroll-thin mt-2 max-h-32 overflow-auto rounded-lg bg-surface px-2 py-1.5 font-mono text-[11px] leading-[1.5] text-fg-3">
          {note.anchor.rows.map((r) => `${r.kind === 'add' ? '+' : r.kind === 'del' ? '-' : ' '}${r.text}`).join('\n')}
        </pre>
      )}
      {error && <ErrorNote className="mt-2">{error}</ErrorNote>}
    </article>
  );
}
