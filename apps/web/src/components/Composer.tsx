import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, errorText, harnessesPath, useApi, type HarnessWithRunning, type SendMode, type Thread } from '../api.ts';
import { dropNewThreadPreset, navigate, openNewThread, peekNewThreadPreset } from '../router.ts';
import { useApp } from '../store.tsx';
import { ErrorNote, Icon, Picker } from './ui.tsx';
import { ModelPicker } from './ModelPicker.tsx';
import { BasePicker, useBasePick } from './BasePicker.tsx';
import { RunOnPicker, useRunOn } from './RunOnPicker.tsx';
import { baseRequest } from '../worktree-base.ts';
import { SlashMenu, useCommands } from './SlashMenu.tsx';
import { FileMenu, useFileMenu } from './FileMenu.tsx';
import { replySlash } from '@omni/shared/composer-slash.ts';
import { draftRun, draftRunRequest, newThreadBody, sameSettings, type DraftRun } from '../new-thread-preset.ts';
import { requestIdFor, sendKey, type PendingRequest } from '../requests.ts';
import { beginSend } from '../sending.ts';
import type { MessageContext } from '@omni/shared/message-context.ts';
import { ContextChips } from '../message-context/ContextChips.tsx';
import { ForkThreadButton } from './ContinueSheet.tsx';
import { removeDraftContext, settleDraftContext, useDraftContext } from '../message-context/draft.ts';

import { AttachButton, AttachmentStrip, useAttachments } from './composer/attachments.tsx';
import { DropHint, enterKey, SendButton, shell, StopButton, useAutosize, useFocusRequests, withKeys } from './composer/controls.tsx';
import { joinMenus, useNewThreadMenus, useSlashMenu } from './composer/menus.tsx';
import { pickerOptions } from './composer/pickerOptions.tsx';
import { finePointer, SteerButton, ThreadRunPills } from './composer/ReplyControls.tsx';

export { AttachmentStrip, useAttachments };

// Unsent text survives navigation (not reloads). Keyed by where the composer lives.
const drafts = new Map<string, string>();


/** Starts a new thread. `channelId` fixes the channel (channel page); otherwise a picker is shown. */
export function NewThreadComposer({
  channelId,
  defaultChannel = 'conductor',
  big,
  placeholder,
}: {
  channelId?: string;
  defaultChannel?: string;
  big?: boolean;
  placeholder?: string;
}) {
  const { channels, crew } = useApp();
  const key = `new:${channelId ?? '*'}`;
  // Set up from the thread Ben came from, when `/clear` opened this.
  const [preset] = useState(() => (channelId ? peekNewThreadPreset(channelId) : null));
  useEffect(() => {
    if (!preset) return;
    dropNewThreadPreset(preset);
    // A preset's prompt is the draft from here on, like text Ben typed.
    if (preset.prompt) drafts.set(key, preset.prompt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset]);
  const [text, setText] = useState(() => preset?.prompt ?? drafts.get(key) ?? '');
  const [channel, setChannel] = useState(channelId ?? defaultChannel);
  const [role, setRole] = useState<string>(() => preset?.role ?? ((channelId ?? defaultChannel) === 'conductor' ? 'conductor' : ''));
  const [picked, setPicked] = useState<DraftRun | null>(() => preset?.choice ? { choice: preset.choice, effort: preset.effort ?? '' } : null);
  // "New thread here" on a sidebar folder files the thread in it, until Ben takes it out.
  const [folder, setFolder] = useState(preset?.folder ?? null);
  // As the channel sees them: Cursor Cloud needs its GitHub repo.
  const { data: harnesses, reload: reloadHarnesses } = useApi<HarnessWithRunning[]>(harnessesPath(channel));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const att = useAttachments();
  useAutosize(ref, text, big ? 360 : 260);
  useFocusRequests(ref, true);

  const [base, setBase] = useBasePick(channel);
  const runOn = useRunOn();
  const { choice, effort } = draftRun(picked, crew.find((r) => r.id === role), channels.find((c) => c.id === channel), harnesses ?? []);

  // Default the role once crew loads, if the conductor channel is selected. A preset keeps its own.
  useEffect(() => {
    if (!preset && !role && channel === 'conductor' && crew.some((r) => r.id === 'conductor')) setRole('conductor');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crew]);

  const roleObj = crew.find((r) => r.id === role);
  // The Conductor channel runs the Conductor, and with no crew there is nothing to pick.
  const showRole = crew.length > 0 && channel !== 'conductor';
  const visibleChannels = channels.filter((c) => !c.archived);

  const onRole = (r: string) => {
    setRole(r);
    const roleObj = crew.find((x) => x.id === r);
    const rc = roleObj?.channel;
    const next = !channelId && rc && channels.some((c) => c.id === rc) ? rc : channel;
    setChannel(next);
    setPicked(null);
  };
  const onChannel = (c: string) => {
    setChannel(c);
    let r = role;
    if (c === 'conductor' && !role && crew.some((x) => x.id === 'conductor')) r = 'conductor';
    if (c !== 'conductor' && role === 'conductor') r = '';
    setRole(r);
    setPicked(null);
  };

  const update = (v: string) => {
    setText(v);
    drafts.set(key, v);
  };

  const { slashMenu, fileMenu, menus, hint } = useNewThreadMenus({ ref, text, onText: update, choice, channel });

  const submit = async () => {
    const prompt = text.trim();
    if (!prompt || busy) return;
    setBusy(true);
    setError(null);
    try {
      const t = await api.send<Thread>(
        '/threads',
        {
          channel,
          prompt,
          role: role || undefined,
          ...draftRunRequest(picked ? { choice, effort } : null),
          ...baseRequest(base, choice.harness),
          ...runOn.request,
          folder: folder && channel === preset?.channel ? folder.id : undefined,
        },
        att.files,
      );
      drafts.delete(key);
      setText('');
      att.clear();
      navigate(`/t/${t.id}`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const { channelOptions, roleOptions } = pickerOptions(visibleChannels, channel, crew);
  return (
    <div className={shell('rounded-xl bg-surface', att.over)} {...att.dropZone}>
      <DropHint over={att.over} />
      {/* Near the top of the page, so it opens downward. */}
      {slashMenu.menu && <SlashMenu {...slashMenu.menu} below />}
      {fileMenu.menu && <FileMenu {...fileMenu.menu} below />}
      <AttachmentStrip files={att.files} onRemove={att.remove} />
      <textarea
        ref={ref}
        value={text}
        {...menus.textarea}
        onPaste={att.onPaste}
        onKeyDown={(e) => {
          if (menus.onKey(e)) return;
          if (enterKey(e, text, update)) void submit();
        }}
        rows={big ? 3 : 2}
        placeholder={withKeys(placeholder ?? (channel === 'conductor' ? 'Ask the Conductor anything. It delegates to the crew.' : 'Describe the task'))}
        className={`block max-h-[220px] w-full resize-none bg-transparent px-4 pt-3 pb-1 leading-[1.8] outline-none placeholder:text-fg-4 ${big ? 'min-h-[96px] text-[16px]' : 'min-h-[60px] text-[14.5px]'}`}
      />
      <div className="flex flex-wrap items-center gap-1.5 px-2 pt-1.5 pb-2">
        {!channelId && <Picker label="Channel" value={channel} options={channelOptions} onChange={onChannel} />}
        {showRole && <Picker label="Role" value={role} options={roleOptions} onChange={onRole} />}
        {harnesses && (
          <ModelPicker
            harnesses={harnesses}
            onOpen={reloadHarnesses}
            defaultOpen={preset?.pickModel}
            value={choice}
            onChange={(c) => {
              setPicked({ choice: c, effort: '' }); // changing the model resets effort to the default
            }}
            effort={{ value: effort, onChange: (effort) => setPicked({ choice, effort }) }}
          />
        )}
        <BasePicker channel={channel} harness={choice.harness} value={base} onChange={setBase} />
        <RunOnPicker rows={runOn.rows} value={runOn.pick} onChange={runOn.setPick} />
        <AttachButton onPick={att.add} disabled={busy} />
        {folder && channel === preset?.channel && (
          <button
            type="button"
            onClick={() => setFolder(null)}
            title="Filed in this folder. Click to start it ungrouped."
            aria-label={`In folder ${folder.name}. Remove`}
            className="hov inline-flex h-[30px] max-w-[180px] items-center gap-1.5 rounded-full px-2.5 text-[12.5px] text-fg-2 hover:text-fg"
          >
            <Icon name="folder" size={13} className="text-fg-3" />
            <span className="truncate">{folder.name}</span>
            <Icon name="x" size={12} className="text-fg-4" />
          </button>
        )}
        <div className="ml-auto flex items-center gap-2.5">
          <SendButton armed={!!text.trim()} busy={busy} onClick={submit}>
            Start
          </SendButton>
        </div>
      </div>
      {/* Mounted before it says anything, so a screen reader reads each hint as it appears. */}
      <div aria-live="polite">{hint && !menus.open && <div className="px-4 pb-2.5 text-[12px] text-fg-3">{hint}</div>}</div>
      {showRole && roleObj?.description && <div className="px-4 pb-2.5 text-[12px] text-fg-3">{roleObj.description}</div>}
      {(att.error || error) && <ErrorNote className="mx-2 mb-2">{att.error ?? error}</ErrorNote>}
    </div>
  );
}

/** Follow-up composer pinned under a thread. On a busy thread it steers by default. */
/**
 * Sends a reply to a thread. A message keeps its request id until it goes through, so retrying one whose answer was
 * lost is not delivered twice. The context it carried leaves the thread's draft once it has.
 */
export function useReplySend(threadId: string) {
  // The last send that failed: retrying the same message reuses its request id.
  const lastRequest = useRef<PendingRequest | null>(null);
  useEffect(() => {
    lastRequest.current = null;
  }, [threadId]);
  return useCallback(
    async (prompt: string, mode: SendMode | undefined, files: File[], context: readonly MessageContext[] = []) => {
      const ids = context.map((r) => r.id);
      const request = requestIdFor(lastRequest.current, sendKey(prompt, mode, files, ids));
      lastRequest.current = request;
      const body = { prompt, ...(mode && { mode }), ...(context.length ? { context } : {}), request_id: request.id };
      // In the thread at once, files and all, while the upload and the server's checks run (sending.ts).
      const done = beginSend(threadId, request.id, prompt, files);
      try {
        const t = await api.send<Thread>(`/threads/${encodeURIComponent(threadId)}/messages`, body, files);
        lastRequest.current = null;
        settleDraftContext(threadId, ids);
        return t;
      } finally {
        done();
      }
    },
    [threadId],
  );
}

export function ReplyComposer({
  thread,
  canSteer = true,
  onSent,
  onChanged,
  extra,
  stop,
}: {
  thread: Thread;
  /** When false (e.g. Cursor), a busy thread offers only Queue and Interrupt; Cmd+Enter queues. */
  canSteer?: boolean;
  /** Set while a turn runs that can be stopped: an empty box shows Stop where Send sits. */
  stop?: { busy: boolean; run: () => void } | null;
  onSent?: (t: Thread, mode?: SendMode) => void;
  /** The thread after `/rename` or a run switch. */
  onChanged?: (t: Thread) => void;
  extra?: ReactNode;
}) {
  const { id: threadId, status } = thread;
  // A switch queued behind the turn: what Ben sends waits for it too (apps/server/runner/queue.ts), so nothing steers.
  const steers = canSteer && !thread.queued_harness;
  const key = `reply:${threadId}`;
  const [text, setText] = useState(() => drafts.get(key) ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const att = useAttachments();
  const context = useDraftContext(threadId);
  const sendReply = useReplySend(threadId);
  useAutosize(ref, text, 240);

  useEffect(() => {
    setText(drafts.get(key) ?? '');
    setError(null);
    att.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const busyThread = status === 'running' || status === 'queued';
  // The server's guess at the next reply, shown in the empty box. Tab takes it.
  const suggestion = !busyThread && !text && thread.suggestion ? thread.suggestion : null;
  const latest = useRef(text);
  latest.current = text;

  // ----- the `/` menu -----
  const update = (v: string) => {
    setText(v);
    drafts.set(key, v);
  };
  const commands = useCommands(`thread=${encodeURIComponent(threadId)}`);
  const { list } = commands;
  const slashMenu = useSlashMenu({ ref, text, onText: update, commands, where: 'reply' });
  const fileMenu = useFileMenu({ ref, text, onText: update, scope: `thread=${encodeURIComponent(threadId)}` });
  const menus = joinMenus(slashMenu, fileMenu);

  // `mode` only matters while a turn is in progress; an idle thread just starts the next turn.
  const canSend = !!text.trim() || context.length > 0;
  const submit = async (mode?: SendMode) => {
    const raw = text;
    const prompt = raw.trim();
    if (!canSend || busy) return;
    setBusy(true);
    setError(null);
    // The box empties now: the message shows in the thread while it goes, and comes back here if it fails.
    const files = att.files;
    drafts.delete(key);
    setText('');
    att.clear();
    try {
      const t = await sendReply(prompt, mode, files, context);
      onSent?.(t, mode);
    } catch (e) {
      // Unless Ben started a new message meanwhile.
      if (!latest.current || latest.current === raw) update(raw);
      att.add(files);
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const sendVia = (mode: SendMode) => {
    if (finePointer()) ref.current?.focus();
    void submit(mode);
  };

  // ----- Omni commands, and hints for commands that stay text -----
  const slash = useMemo(() => replySlash(text, list, thread.harness), [text, list, thread.harness]);
  const omni = slash.action.kind !== 'send';
  const [pillRequest, setPillRequest] = useState(0);

  /** Clear what was sent, unless Ben typed more while it was in flight. */
  const sent = (raw: string) => {
    if (drafts.get(key) === raw) drafts.delete(key);
    if (latest.current === raw) setText('');
  };

  /** Run the Omni command the message starts with. The thread itself sees none of it. */
  const runOmni = async () => {
    const { action } = slash;
    if (!slash.armed || busy) return;
    const raw = text;
    if (action.kind === 'pick-model') {
      sent(raw);
      setPillRequest((n) => n + 1);
      return;
    }
    if (action.kind === 'new-thread' && !action.prompt) {
      sent(raw);
      openNewThread(sameSettings(thread));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (action.kind === 'new-thread') {
        const t = await api.send<Thread>('/threads', newThreadBody(thread, action.prompt), att.files);
        sent(raw);
        att.clear();
        navigate(`/t/${t.id}`);
      } else if (action.kind === 'rename') {
        const t = await api.patch<Thread>(`/threads/${encodeURIComponent(threadId)}`, { title: action.title });
        sent(raw);
        onChanged?.(t);
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={shell('rounded-xl bg-surface', att.over)} {...att.dropZone}>
      <DropHint over={att.over} />
      {slashMenu.menu && <SlashMenu {...slashMenu.menu} />}
      {fileMenu.menu && <FileMenu {...fileMenu.menu} />}
      <ContextChips records={context} onRemove={(id) => removeDraftContext(threadId, id)} className="px-3 pt-3 pb-0.5" />
      <AttachmentStrip files={att.files} onRemove={att.remove} />
      <textarea
        ref={ref}
        data-reply-composer
        value={text}
        {...menus.textarea}
        onPaste={att.onPaste}
        onKeyDown={(e) => {
          if (menus.onKey(e)) return;
          if (e.key === 'Tab' && suggestion && !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            return update(suggestion);
          }
          const key = enterKey(e, text, update);
          if (!key) return;
          if (omni) return void runOmni();
          const busyMode: SendMode = key === 'interrupt' ? 'interrupt' : steers ? 'steer' : 'queue';
          void submit(busyThread ? busyMode : undefined);
        }}
        rows={1}
        placeholder={suggestion ? `${suggestion} · ⇥ to use` : withKeys(!busyThread ? 'Reply' : steers ? 'Steer the agent. It reads this at its next step.' : 'Queue a message. It runs after this turn.')}
        className="block max-h-[220px] min-h-[60px] w-full resize-none bg-transparent px-4 pt-3 pb-1 text-[14.5px] leading-[1.8] outline-none placeholder:text-fg-4"
      />
      <div className="flex flex-wrap items-center gap-1.5 px-2 pt-1.5 pb-2">
        {extra}
        <AttachButton onPick={att.add} disabled={busy} />
        <ForkThreadButton thread={thread} disabled={busy} />
        <ThreadRunPills thread={thread} openRequest={pillRequest} onSwitched={(t) => onChanged?.(t)} onError={setError} />
        <div className="ml-auto flex items-center gap-2.5">
          {omni ? (
            <SendButton armed={slash.armed} busy={busy} onClick={() => void runOmni()}>
              {slash.label ?? 'Send'}
            </SendButton>
          ) : stop && !canSend && !att.files.length ? (
            <StopButton busy={stop.busy} onClick={stop.run} />
          ) : busyThread ? (
            <SteerButton disabled={!canSend} busy={busy} canSteer={steers} onSend={sendVia} />
          ) : (
            <SendButton armed={canSend} busy={busy} onClick={() => void submit()}>
              Send
            </SendButton>
          )}
        </div>
      </div>
      {/* Mounted before it says anything, so a screen reader reads each hint as it appears. */}
      <div aria-live="polite">
        {slash.hint && !menus.open && (
          <div className="px-4 pb-2.5 text-[12px] text-fg-3">{slash.hint}</div>
        )}
      </div>
      {(att.error || error) && <ErrorNote className="mx-2 mb-2">{att.error ?? error}</ErrorNote>}
    </div>
  );
}
