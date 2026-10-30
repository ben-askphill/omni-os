import { useMemo, useRef, useState } from 'react';
import { api, errorText, type BackgroundTask, type Thread } from '../api.ts';
import { threadMenu, type ThreadActionId } from '@omni/shared/thread-actions.ts';
import { handOff, useHandoffTargets } from '../components/thread/Handoff.tsx';
import { TakeoverConfirm } from '../components/thread/Takeover.tsx';
import { deviceRows, mayTakeOver } from '../handoff.ts';
import { Button, ErrorNote, Loader, StatusDot } from '../components/ui.tsx';
import { duration, toDate } from '../format.ts';
import { runningSubagents, subagentKind } from '../subagents.ts';
import { canMarkDone } from '../needs-you.ts';
import { sendThreadToGrokBot } from '../grokbot.ts';
import { useFolders } from '../folders.tsx';
import { href } from '../router.ts';
import { useApp, useNow } from '../store.tsx';
import { ThreadReferencePanel } from '../components/ThreadReference.tsx';
import { MoGroup, MoListRow, MoRadio, MoSection, MoSheet } from './parts.tsx';
import { useShell, useThread } from './shell.tsx';

/** A running sub-agent, last in the options sheet as under the resume command on desktop. A tap closes the sheet on the turn that started it. */
function MoSubagentRow({ t, last, onJump }: { t: BackgroundTask; last: boolean; onJump: (eventId: number) => void }) {
  const now = useNow(1000);
  return (
    <MoListRow
      icon={<Loader size={14} className="mx-0.5 text-live-text" />}
      label={t.description}
      sub={subagentKind(t)}
      right={duration(Math.max(0, now - toDate(t.started_at).getTime()))}
      chevron={false}
      disabled={!t.event_id}
      onClick={() => t.event_id && onJump(t.event_id)}
      last={last}
    />
  );
}

/** Actions that open another sheet carry a chevron; the rest act and close. */
const OPENS = new Set<ThreadActionId>(['rename', 'move', 'fork', 'reference', 'handoff', 'takeover']);

const SHEET_TITLE = 'px-5 pt-2.5 pb-2 text-[15px] leading-[1.3] font-medium';

/** The sheet's one-shot actions: each closes the sheet first (or after) and answers with a toast. */
function useThreadActions(thread: Thread, onClose: () => void) {
  const shell = useShell();
  const { setPinned, setDone, reloadChannels } = useApp();
  const { applyThread } = useThread();
  const [grokBusy, setGrokBusy] = useState(false);
  const [grokError, setGrokError] = useState('');
  const grokLock = useRef(false);
  const go = (to: string) => {
    onClose();
    shell.open(to);
  };
  const pin = async () => {
    onClose();
    try {
      applyThread(await setPinned(thread, !thread.pinned_at), true);
      shell.toast(thread.pinned_at ? 'Unpinned' : 'Pinned to Activity');
    } catch (e) {
      shell.toast(errorText(e));
    }
  };
  const done = async () => {
    onClose();
    try {
      applyThread(await setDone(thread.id, !thread.done_at), true);
      shell.toast(thread.done_at ? 'Back in Needs you' : 'Marked done');
    } catch (e) {
      shell.toast(errorText(e));
    }
  };
  const sendGrok = async () => {
    if (grokLock.current) return;
    grokLock.current = true;
    setGrokBusy(true);
    setGrokError('');
    const result = await sendThreadToGrokBot(thread.id);
    grokLock.current = false;
    setGrokBusy(false);
    if (result.ok) {
      onClose();
      shell.toast('Sent to Grok Bot');
      return;
    }
    setGrokError(result.error);
  };
  const archive = async () => {
    onClose();
    try {
      await api.patch<Thread>(`/threads/${encodeURIComponent(thread.id)}`, { archived: !thread.archived });
      await reloadChannels();
      if (thread.archived) shell.toast('Back in the lists');
      else {
        shell.toast('Archived. Search still finds it.');
        shell.back();
      }
    } catch (e) {
      shell.toast(errorText(e));
    }
  };
  return { go, pin, done, sendGrok, archive, grokBusy, grokError };
}

/** The title field that replaces the sheet's items while renaming. */
function RenameSheet({ thread, onClose }: { thread: Thread; onClose: () => void }) {
  const shell = useShell();
  const { reloadChannels } = useApp();
  const { applyThread } = useThread();
  const [draft, setDraft] = useState(thread.title ?? '');
  const rename = async () => {
    const next = draft.replace(/\s+/g, ' ').trim();
    onClose();
    if (!next || next === thread.title) return;
    try {
      applyThread(await api.patch<Thread>(`/threads/${encodeURIComponent(thread.id)}`, { title: next }), true);
      await reloadChannels();
      shell.toast('Renamed');
    } catch (e) {
      shell.toast(errorText(e));
    }
  };
  return (
    <MoSheet onClose={onClose} label="Rename thread">
      <div className={SHEET_TITLE}>Rename thread</div>
      <form
        className="flex items-center gap-2 px-3 pb-1"
        onSubmit={(e) => {
          e.preventDefault();
          void rename();
        }}
      >
        <input
          autoFocus
          value={draft}
          maxLength={200}
          enterKeyHint="done"
          aria-label="Thread title"
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setDraft(e.target.value)}
          className="h-11 min-w-0 flex-1 rounded-full bg-surface-2 px-4 text-[16px] text-fg outline-none placeholder:text-fg-4"
        />
        <Button type="submit">Save</Button>
      </form>
    </MoSheet>
  );
}

/** The folders of the thread's channel, one tap to move it. */
function MoveSheet({ thread, onClose }: { thread: Thread; onClose: () => void }) {
  const { channel } = useApp();
  const folders = useFolders();
  const moveTo = (folderId: string | null) => {
    onClose();
    void folders.moveThread({ id: thread.id, channel_id: thread.channel_id, title: thread.title, status: thread.status, created_at: thread.created_at, folder_id: thread.folder_id }, folderId);
  };
  const choices = (channel(thread.channel_id)?.folders ?? []).filter((f) => !f.id.startsWith('tmp-'));
  const rows = [{ id: null as string | null, name: 'No folder' }, ...choices];
  return (
    <MoSheet onClose={onClose} label="Move to folder">
      <div className={SHEET_TITLE}>Move to folder</div>
      <div className="flex flex-col gap-2.5 px-3">
        <MoGroup>
          {rows.map((f, i) => (
            <MoListRow
              key={f.id ?? ''}
              icon={f.id ? 'folder' : 'minus'}
              label={f.name}
              right={<MoRadio on={(thread.folder_id ?? null) === f.id} />}
              chevron={false}
              onClick={() => moveTo(f.id)}
              last={i === rows.length - 1}
            />
          ))}
        </MoGroup>
        {!choices.length && <p className="m-0 px-2 text-[12.5px] leading-[1.4] text-fg-3">This channel has no folders yet. Add one from Channels.</p>}
      </div>
    </MoSheet>
  );
}

/** The Macs the thread can go to; picking one hands it off and closes the sheet. */
function HandoffSheet({ thread, devices, onClose }: { thread: Thread; devices: Extract<ReturnType<typeof useHandoffTargets>, { state: 'ready' }>['devices']; onClose: () => void }) {
  const shell = useShell();
  const { applyThread, setHandoff } = useThread();
  const [sending, setSending] = useState<string | null>(null);
  const sendTo = async (to: { id: string; name: string }) => {
    setSending(to.id);
    try {
      const a = await handOff(thread.id, to.id);
      applyThread(a.thread, true);
      setHandoff(a.handoff);
      onClose();
      shell.toast(`Handing off to ${to.name}`);
    } catch (e) {
      setSending(null);
      shell.toast(errorText(e));
    }
  };
  return (
    <MoSheet onClose={onClose} label="Hand off to">
      <div className="px-5 pt-2.5 pb-0.5 text-[15px] leading-[1.3] font-medium">Hand off to</div>
      <p className="px-5 pb-2.5 text-[12.5px] leading-[1.4] text-fg-3">The turn stops here and keeps running on the Mac you pick.</p>
      <div className="flex flex-col gap-2.5 px-3">
        <MoGroup>
          {deviceRows(devices).map((d, i, all) => (
            <MoListRow
              key={d.id}
              icon={sending === d.id ? <Loader size={14} /> : <StatusDot status={d.dot} size={9} className="mx-[4.5px]" />}
              label={d.name}
              sub={d.label}
              chevron={false}
              disabled={!d.pickable || !!sending}
              onClick={() => void sendTo(d)}
              last={i === all.length - 1}
            />
          ))}
        </MoGroup>
      </div>
    </MoSheet>
  );
}

type Mode = 'rename' | 'move' | 'reference' | 'takeover' | 'handoff';

export function MenuSheet({ thread, prLabel, onClose }: { thread: Thread; prLabel: string | null; onClose: () => void }) {
  const shell = useShell();
  const { tasks, status } = useApp();
  const { applyThread, blocked, handoff, setHandoff, takeover, jumpTo } = useThread();
  const agents = useMemo(() => runningSubagents(tasks, thread.id), [tasks, thread.id]);
  const targets = useHandoffTargets(thread, { blocked, handoff, takeover });
  // The sheet this one has swapped itself for, if any.
  const [mode, setMode] = useState<Mode | null>(null);
  const { go, pin, done, sendGrok, archive, grokBusy, grokError } = useThreadActions(thread, onClose);
  if (mode === 'rename') return <RenameSheet thread={thread} onClose={onClose} />;
  if (mode === 'move') return <MoveSheet thread={thread} onClose={onClose} />;
  if (mode === 'reference') {
    return (
      <MoSheet onClose={onClose} label="Reference a thread" full>
        <ThreadReferencePanel thread={thread} touch onPicked={onClose} />
      </MoSheet>
    );
  }
  if (mode === 'takeover' && takeover && mayTakeOver(takeover, handoff)) {
    return (
      <TakeoverConfirm
        threadId={thread.id}
        takeover={takeover}
        mobile
        onClose={onClose}
        onChanged={(a) => {
          applyThread(a.thread, true);
          setHandoff(a.handoff);
          shell.toast(`Asked ${takeover.from.name} for this thread`);
        }}
      />
    );
  }
  if (mode === 'handoff' && targets.state === 'ready') return <HandoffSheet thread={thread} devices={targets.devices} onClose={onClose} />;
  const takeOverNow = takeover && mayTakeOver(takeover, handoff) ? takeover : null;
  // The thread's actions, from the list the desktop menu and the Mac app render too.
  const menu = threadMenu({
    row: true,
    archived: !!thread.archived,
    pinned: !!thread.pinned_at,
    done: !!thread.done_at,
    settled: canMarkDone(thread.status),
    child: !!thread.parent_id,
    harness: thread.harness,
    handOff: targets.state === 'ready',
    takeOverFrom: takeOverNow?.from.name ?? null,
    grokBot: !!status?.grokBot,
  });
  const runs: Record<ThreadActionId, () => void> = {
    pin: () => void pin(),
    done: () => void done(),
    rename: () => setMode('rename'),
    move: () => setMode('move'),
    archive: () => void archive(),
    fork: () => (onClose(), shell.sheet({ name: 'continue', source: thread })),
    reference: () => setMode('reference'),
    handoff: () => setMode('handoff'),
    takeover: () => setMode('takeover'),
    grok: () => void sendGrok(),
  };
  return (
    <MoSheet onClose={onClose} label="Thread options">
      <div className={`truncate ${SHEET_TITLE}`}>{thread.title || 'Untitled'}</div>
      <div className="flex flex-col gap-2.5 px-3">
        <MoGroup>
          {thread.branch && <MoListRow icon="diff" label="Changes" sub={prLabel ?? `On ${thread.branch}`} onClick={() => go(href.threadView(thread.id, prLabel ? 'pr' : 'changes'))} />}
          <MoListRow icon="browser" label="Browser" sub="Watch only" onClick={() => go(href.threadView(thread.id, 'browser'))} />
          <MoListRow icon="terminal" label="Terminal" sub="Read only" onClick={() => go(href.threadView(thread.id, 'terminal'))} />
          <MoListRow icon="play" label="Actions" sub="Preview, checks, tests" onClick={() => go(href.threadView(thread.id, 'actions'))} />
          <MoListRow icon="info" label="Details" sub="Harness, model, session" onClick={() => go(href.threadView(thread.id, 'details'))} last />
        </MoGroup>
        {menu.map((g) => (
          <MoSection key={g.id} title={g.title} pad={false}>
            <MoGroup>
              {g.items.map((it, i) => (
                <MoListRow
                  key={it.id}
                  icon={it.id === 'grok' && grokBusy ? <Loader size={18} /> : it.icon}
                  label={it.label}
                  sub={it.off ?? (it.id === 'grok' && grokBusy ? 'Sending' : it.hint)}
                  chevron={OPENS.has(it.id)}
                  disabled={!!it.off || (it.id === 'grok' && grokBusy)}
                  onClick={runs[it.id]}
                  last={i === g.items.length - 1}
                />
              ))}
            </MoGroup>
          </MoSection>
        ))}
        {grokError && <ErrorNote>{grokError}</ErrorNote>}
        {agents.length > 0 && (
          <MoSection title="Running subagents" count={agents.length} pad={false}>
            <MoGroup>
              {agents.map((t, i) => (
                <MoSubagentRow
                  key={t.task_id}
                  t={t}
                  last={i === agents.length - 1}
                  onJump={(at) => {
                    onClose();
                    jumpTo(at);
                  }}
                />
              ))}
            </MoGroup>
          </MoSection>
        )}
      </div>
    </MoSheet>
  );
}
