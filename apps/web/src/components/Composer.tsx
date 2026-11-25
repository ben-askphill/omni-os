import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTechnical } from '../display.ts';
import { api, errorText, harnessesPath, useApi, type HarnessWithRunning, type SendMode, type Thread } from '../api.ts';
import { dropNewThreadPreset, navigate, openNewThread, peekNewThreadPreset } from '../router.ts';
import { useApp } from '../store.tsx';
import { Button, ErrorNote, Icon, Picker } from './ui.tsx';
import { ModelPicker } from './ModelPicker.tsx';
import { BasePicker, useBasePick } from './BasePicker.tsx';
import { RunOnPicker, useRunOn } from './RunOnPicker.tsx';
import { useToast } from './Toaster.tsx';
import { sendMessageToGrokBot } from '../grokbot.ts';
import { GROK_BOT_NOTE, GROK_BOT_PLACEHOLDER, GROK_BOT_SENT, grokBotBlock } from '@omni/shared/thread-machine.ts';
import { ComposerAccountNotice } from './AccountNotice.tsx';
import { pickerAccounts, useAccounts } from '../accounts.ts';
import { accountLine } from '@omni/shared/harness-accounts.ts';
import { asksAuto } from '@omni/shared/thread-run.ts';
import { baseRequest } from '../worktree-base.ts';
import { useCommands } from './composer/use-commands.ts';
import { mentionedAgents } from '@omni/shared/message-context-agent.ts';
import { replyTo, routingHint } from '@omni/shared/members.ts';
import { isRemoteAgentHarness, remoteLeadPlaceholder } from '@omni/shared/remote-agent.ts';
import { CommitButton } from './thread/CommitButton.tsx';
import { useThreadAgents } from '../thread-agents.ts';
import { chipRecords, machineMention } from '@omni/shared/message-context-machine.ts';
import { replySlash } from '@omni/shared/composer-slash.ts';
import { STEP_WORKING } from '@omni/shared/thread-glance.ts';
import { sameSettings } from '../new-thread-preset.ts';
import { runReplyCommand } from './composer/reply-command.ts';
import { draftRun, draftRunRequest, type DraftRun } from '@omni/shared/draft-run.ts';
import { sendKey } from '../requests.ts';
import { beginSend, keepLocalFiles } from '../sending.ts';
import type { MessageContext } from '@omni/shared/message-context.ts';
import { requestIdFor, type PendingRequest } from '@omni/shared/request-id.ts';
import { ContextChips } from '../message-context/ContextChips.tsx';
import { ForkThreadButton } from './ContinueSheet.tsx';
import { removeDraftContext, settleDraftContext, useDraftContext } from '../message-context/draft.ts';
import { referencesFor } from '../message-context/thread-picker.ts';
import { ReferenceThreadButton } from './ThreadReference.tsx';
import { QuickAnswer } from './QuickAnswer.tsx';

import { AttachButton, AttachmentStrip, useAttachments } from './composer/attachments.tsx';
import { DropHint, enterKey, SendButton, shell, StopButton, useFocusRequests, withKeys } from './composer/controls.tsx';
import { useNewThreadCommands } from './composer/menus.tsx';
import { MessageEditor, newThreadScope, type MessageEditorHandle } from './composer/MessageEditor.tsx';
import { pickerOptions } from './composer/pickerOptions.tsx';
import { finePointer, SteerButton, ThreadRunPills } from './composer/ReplyControls.tsx';
import { ThreadMachineChip, type MachineHeld } from './composer/MachineChip.tsx';
import { LivesOnNote, sendRefusal, type SendRefusal } from './thread/LivesOn.tsx';
import { TakeoverConfirm } from './thread/Takeover.tsx';
import { TemplateChips, useTemplates } from '../templates.tsx';
import { templateDraft, type Template } from '@omni/shared/templates.ts';
import { CONDUCTOR_CHANNEL } from '@omni/shared/channel-icon.ts';
import { CONDUCTOR_ROLE, isConductor } from '@omni/shared/crew-role.ts';

export { AttachmentStrip, useAttachments };

// Unsent text survives navigation (not reloads). Keyed by where the composer lives.
const drafts = new Map<string, string>();


/**
 * Starts a new thread. `channelId` fixes the channel (channel page); otherwise a picker is shown, on the Conductor.
 * `templateChips={false}` leaves out the template chips under an empty box (Overview); the `/` menu still has them.
 */
export function NewThreadComposer({
  channelId,
  big,
  placeholder,
  templateChips = true,
}: {
  channelId?: string;
  big?: boolean;
  placeholder?: string;
  templateChips?: boolean;
}) {
  const { channels, crew } = useApp();
  const key = `new:${channelId ?? '*'}`;
  // Set up from the thread Ben came from, when `/clear` opened this. Home's composer (no `channelId`) takes one left for
  // it while the Inbox was up, channel and all.
  const [preset] = useState(() => peekNewThreadPreset(channelId));
  useEffect(() => {
    if (!preset) return;
    dropNewThreadPreset(preset);
    // A preset's prompt is the draft from here on, like text Ben typed.
    if (preset.prompt) drafts.set(key, preset.prompt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset]);
  const [text, setText] = useState(() => preset?.prompt ?? drafts.get(key) ?? '');
  const [channel, setChannel] = useState(channelId ?? preset?.channel ?? 'conductor');
  const [role, setRole] = useState<string>(() => preset?.role ?? ((channelId ?? preset?.channel ?? 'conductor') === 'conductor' ? 'conductor' : ''));
  const [picked, setPicked] = useState<DraftRun | null>(() => preset?.choice ? { choice: preset.choice, effort: preset.effort ?? '' } : null);
  // "New thread here" on a sidebar folder files the thread in it, until Ben takes it out.
  const [folder, setFolder] = useState(preset?.folder ?? null);
  // As the channel sees them: Cursor Cloud needs its GitHub repo.
  const { data: harnesses, reload: reloadHarnesses } = useApi<HarnessWithRunning[]>(harnessesPath(channel));
  const [busy, setBusy] = useState(false);
  // A quick ask from Ask: answered under the composer (components/QuickAnswer.tsx), no thread to open.
  const [answering, setAnswering] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<MessageEditorHandle>(null);
  const [frame, setFrame] = useState<HTMLDivElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const att = useAttachments();
  // Threads Ben referenced for the first message: chips over the box, kept like its text until Start.
  const refs = useDraftContext(key);
  useFocusRequests(ref, true);

  const [base, setBase] = useBasePick(channel);
  const runOn = useRunOn();
  const toast = useToast();
  // Grok Bot in the Machine chip: the text goes to its webhook and no thread starts, so the run's own pickers step aside.
  const toGrok = runOn.grokBot;
  const grokBlock = toGrok ? grokBotBlock(att.files.length + refs.length) : null;
  const { choice, effort } = draftRun(picked, crew.find((r) => r.id === role), channels.find((c) => c.id === channel), harnesses ?? []);
  // Who the picked harness runs as on the machine the thread will run on: in the model list, the machine rows, and a
  // notice when it switched since anyone last looked. Auto picks the harness later, so it shows none.
  const accounts = useAccounts();
  const target = pickerAccounts(accounts.data, runOn.pick);
  const picksHarness = !asksAuto(choice);
  const accountFor = useCallback(
    (pick: string) => {
      const a = picksHarness ? pickerAccounts(accounts.data, pick)?.byHarness[choice.harness] : undefined;
      return a ? accountLine(a) : null;
    },
    [accounts.data, choice.harness, picksHarness],
  );
  const switched = picksHarness ? target?.byHarness[choice.harness] : undefined;

  // Default the role once crew loads, if the conductor channel is selected. A preset keeps its own.
  useEffect(() => {
    if (!preset && !role && channel === CONDUCTOR_CHANNEL && crew.some((r) => isConductor(r.id))) setRole(CONDUCTOR_ROLE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crew]);

  const roleObj = crew.find((r) => r.id === role);
  // The Conductor channel runs the Conductor, and with no crew there is nothing to pick.
  const showRole = crew.length > 0 && channel !== 'conductor' && !toGrok;
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
    if (c === CONDUCTOR_CHANNEL && !role && crew.some((x) => isConductor(x.id))) r = CONDUCTOR_ROLE;
    if (c !== CONDUCTOR_CHANNEL && isConductor(role)) r = '';
    setRole(r);
    setPicked(null);
  };

  const update = (v: string) => {
    setText(v);
    drafts.set(key, v);
  };

  const { commands, hint } = useNewThreadCommands({ text, choice, channel });
  const templates = useTemplates(templateChips);

  /** POST /api/grokbot with the text and the channel, the route Send to Grok Bot uses. The box empties once it took it. */
  const sendToGrok = async (prompt: string) => {
    // The note under the box already says to remove the attachments.
    if (grokBlock) return;
    setBusy(true);
    setError(null);
    const result = await sendMessageToGrokBot(prompt, channel);
    setBusy(false);
    if (!result.ok) return setError(result.error);
    drafts.delete(key);
    setText('');
    toast({ title: GROK_BOT_SENT, icon: 'grok' });
  };

  const submit = async () => {
    const prompt = text.trim();
    if (!prompt || busy) return;
    if (toGrok) return sendToGrok(prompt);
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
          ...(refs.length && { context: referencesFor(refs, channel) }),
        },
        att.files,
      );
      keepLocalFiles(t.id, att.files);
      drafts.delete(key);
      settleDraftContext(key, refs.map((r) => r.id));
      setText('');
      att.clear();
      navigate(`/t/${t.id}`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  /** Ask: a quick ask in this channel, on the picked run, answered right here with read-only tools. */
  // It runs here and delegates nothing, so a machine mention stays out of it.
  const quickRefs = refs.filter((r) => r.kind !== machineMention.kind);
  const ask = async () => {
    const prompt = text.trim();
    if (!prompt || busy || toGrok) return;
    setBusy(true);
    setError(null);
    try {
      const t = await api.send<Thread>(
        '/threads',
        { channel, prompt, quick: true, ...draftRunRequest(picked ? { choice, effort } : null), ...(quickRefs.length && { context: referencesFor(quickRefs, channel) }) },
        att.files,
      );
      keepLocalFiles(t.id, att.files);
      drafts.delete(key);
      settleDraftContext(key, refs.map((r) => r.id));
      setText('');
      att.clear();
      setAnswering(t.id);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const { channelOptions, roleOptions } = pickerOptions(visibleChannels, channel, crew);
  // A template chip puts `/<name> ` in the box, ready for what the job is about.
  const pickTemplate = (t: Template) => {
    update(templateDraft(t));
    requestAnimationFrame(() => ref.current?.focus('end'));
  };
  return (
    <>
      {/* flow-root: the last note's or the answer's bottom margin stays inside the box, which has no padding to hold it. */}
      <div ref={setFrame} className={shell('flow-root rounded-[20px] bg-surface', att.over)} {...att.dropZone}>
        <DropHint over={att.over} />
        <ContextChips records={chipRecords(text, refs)} onRemove={(id) => removeDraftContext(key, id)} className="px-3 pt-3 pb-0.5" />
        <AttachmentStrip files={att.files} onRemove={att.remove} />
        <MessageEditor
          handle={ref}
          text={text}
          onText={update}
          draft={key}
          records={refs}
          // `@` a machine: the Conductor (or a role with the omni tools) starts the task there.
          mentions={newThreadScope(channel, role)}
          commands={{ ...commands, where: 'new-thread' }}
          // Near the top of the page, so the menus open downward.
          below
          anchor={frame}
          onError={setError}
          onMenuOpen={setMenuOpen}
          onPaste={att.onPaste}
          onKeyDown={(e) => {
            if (enterKey(e, () => ref.current?.insert('\n'))) void submit();
          }}
          // Named, not left to the placeholder: that changes with the target and carries key hints.
          label="Message"
          placeholder={toGrok ? GROK_BOT_PLACEHOLDER : withKeys(placeholder ?? (channel === 'conductor' ? 'Ask the Conductor anything. It delegates to the crew.' : 'Describe the task'))}
          className={`block max-h-[220px] w-full overflow-y-auto bg-transparent px-4 pt-3 pb-1 leading-[1.8] outline-none ${big ? 'min-h-[96px] text-[16px]' : 'min-h-[60px] text-[14.5px]'}`}
        />
        <div className="flex flex-wrap items-center gap-1.5 px-2 pt-1.5 pb-2">
          {!channelId && <Picker label="Channel" value={channel} options={channelOptions} onChange={onChannel} />}
          {showRole && <Picker label="Agent" value={role} options={roleOptions} onChange={onRole} />}
          {/* A remote agent runs on its own server: no harness or model to pick for it (ADR 0020). */}
          {harnesses && !toGrok && !roleObj?.server && (
            <ModelPicker
              harnesses={harnesses}
              onOpen={() => {
                reloadHarnesses();
                accounts.reload();
              }}
              accounts={target}
              defaultOpen={preset?.pickModel}
              value={choice}
              onChange={(c) => {
                setPicked({ choice: c, effort: '' }); // changing the model resets effort to the default
              }}
              effort={{ value: effort, onChange: (effort) => setPicked({ choice, effort }) }}
            />
          )}
          {!toGrok && <BasePicker channel={channel} harness={choice.harness} value={base} onChange={setBase} />}
          <RunOnPicker rows={runOn.rows} value={runOn.pick} onChange={runOn.setPick} accountFor={accountFor} />
          <AttachButton onPick={att.add} disabled={busy} />
          {!toGrok && <ReferenceThreadButton to={{ draft: key, channel }} disabled={busy} />}
          {folder && channel === preset?.channel && !toGrok && (
            <button
              type="button"
              onClick={() => setFolder(null)}
              title="Filed in this folder. Click to start it ungrouped."
              aria-label={`In folder ${folder.name}. Remove`}
              className="hov inline-flex h-[30px] max-w-[180px] items-center gap-1.5 rounded-full px-2.5 text-[12.5px] text-fg-2 hover:text-fg"
            >
              <Icon name="folder" size={13} className="text-fg-3" />
              <span className="truncate">{folder.name}</span>
              <Icon name="x" size={12} className="text-fg-3" />
            </button>
          )}
          <div className="ml-auto flex items-center gap-2.5">
            {!toGrok && (
              <Button size="sm" variant="secondary" icon="zap" disabled={!text.trim() || busy} onClick={() => void ask()} title="Answer here with read-only tools, without starting a thread">
                Quick ask
              </Button>
            )}
            <SendButton armed={!!text.trim() && !grokBlock} busy={busy} onClick={submit}>
              {toGrok ? 'Send' : 'Start'}
            </SendButton>
          </div>
        </div>
        {/* Mounted before it says anything, so a screen reader reads each hint as it appears. */}
        <div aria-live="polite">{hint && !menuOpen && !toGrok && <div className="px-4 pb-2.5 text-[12px] text-fg-3">{hint}</div>}</div>
        {showRole && roleObj?.description && <div className="px-4 pb-2.5 text-[12px] text-fg-3">{roleObj.description}</div>}
        {toGrok && !grokBlock && <div className="px-4 pb-2.5 text-[12px] text-fg-3">{GROK_BOT_NOTE}</div>}
        {grokBlock && <ErrorNote className="mx-2 mb-2">{grokBlock}</ErrorNote>}
        {switched?.notice && target && <ComposerAccountNotice machine={{ id: target.id, name: target.machine }} account={switched} onSeen={accounts.setData} />}
        {(att.error || error) && <ErrorNote className="mx-2 mb-2">{att.error ?? error}</ErrorNote>}
        {answering && (
          <div className="mx-2 mb-2 flex flex-col gap-3 rounded-[16px] bg-bg p-3.5 shadow-[var(--shadow-card)]">
            <QuickAnswer key={answering} id={answering} onOpen={(id) => navigate(`/t/${id}`)} />
            <button type="button" onClick={() => setAnswering(null)} className="press self-start text-[12.5px] font-medium text-fg-3 hover:text-fg">
              Close
            </button>
          </div>
        )}
      </div>
      {!text.trim() && !toGrok && templates.data && <TemplateChips templates={templates.data.templates} onPick={pickTemplate} className="mt-3 px-1" />}
    </>
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
    /**
     * `ifAway: 'ask'`: when the thread lives on a machine Tailscale sees asleep, refuse with `lives_on` (Send there,
     * Take over) instead of leaving the message to wait there. The reply boxes ask; Send there sends without it.
     */
    async (prompt: string, mode: SendMode | undefined, files: File[], context: readonly MessageContext[] = [], ifAway?: 'ask') => {
      const ids = context.map((r) => r.id);
      const request = requestIdFor(lastRequest.current, sendKey(prompt, mode, files, ids));
      lastRequest.current = request;
      const body = { prompt, ...(mode && { mode }), ...(context.length ? { context } : {}), request_id: request.id, ...(ifAway && { if_away: ifAway }) };
      // In the thread at once, files and all, while the upload and the server's checks run (sending.ts).
      const done = beginSend(threadId, request.id, prompt, files);
      try {
        const t = await api.send<Thread>(`/threads/${encodeURIComponent(threadId)}/messages`, body, files);
        lastRequest.current = null;
        settleDraftContext(threadId, ids);
        // The stream's pending list that takes over lands with the next frame's rows (useThreadHistory's withRows).
        requestAnimationFrame(done);
        return t;
      } catch (e) {
        done();
        throw e;
      }
    },
    [threadId],
  );
}

export function ReplyComposer({
  thread,
  canSteer = true,
  onSent,
  onSending,
  onChanged,
  stop,
  machine,
  asking = false,
  openPR,
  commit,
}: {
  thread: Thread;
  /**
   * The agent waits on a question card. A message steers in as the answer (the server dismisses the question), so the
   * box reads as a reply: Send, no Stop.
   */
  asking?: boolean;
  /** When false (e.g. Cursor), a busy thread offers only Queue and Interrupt; Cmd+Enter queues. */
  canSteer?: boolean;
  /** The thread's handoff state, for the Machine chip next to the model pill. Without it the chip is left out. */
  machine?: MachineHeld;
  /** Set while a turn runs that can be stopped: an empty box shows Stop where Send sits. */
  stop?: { busy: boolean; run: () => void } | null;
  /** Set when the agent's last reply asks whether to open a PR: Open PR beside the Machine chip answers yes. */
  openPR?: { busy: boolean; prompt: string; run: () => void } | null;
  /** Set in a remote-led thread while its worktree has changes no one committed: the Commit button (ADR 0020). */
  commit?: { files: number; onDone: () => void } | null;
  onSent?: (t: Thread, mode?: SendMode) => void;
  /** Called as a message leaves the box, before the server has it: it shows in the thread from now on. */
  onSending?: () => void;
  /** The thread after `/rename` or a run switch. */
  onChanged?: (t: Thread) => void;
}) {
  const { id: threadId, status } = thread;
  // A switch queued behind the turn: what Ben sends waits for it too (apps/server/runner/queue.ts), so nothing steers.
  const steers = canSteer && !thread.queued_harness;
  const technical = useTechnical();
  const key = `reply:${threadId}`;
  const [text, setText] = useState(() => drafts.get(key) ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A send the server refused with where the thread lives or a raw reason (LivesOn.tsx), and the mode it went with.
  const [away, setAway] = useState<{ refusal: SendRefusal; mode?: SendMode } | null>(null);
  const [takingOver, setTakingOver] = useState(false);
  const ref = useRef<MessageEditorHandle>(null);
  const [frame, setFrame] = useState<HTMLDivElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const att = useAttachments();
  const context = useDraftContext(threadId);
  const sendReply = useReplySend(threadId);

  // Once Take over is asked for (or the thread is here again), the card's offer is past.
  const takeover = machine?.takeover;
  useEffect(() => {
    if (!takeover) setAway((a) => (a?.refusal.livesOn ? null : a));
  }, [takeover]);

  useEffect(() => {
    setText(drafts.get(key) ?? '');
    setError(null);
    setAway(null);
    att.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const busyThread = status === 'running' || status === 'queued';
  // A remote agent leads: it talks only, so the box says who changes files (ADR 0020).
  const remoteLead = isRemoteAgentHarness(thread.harness);
  const replying = asking && steers;
  // The server's guess at the next reply, shown in the empty box. Tab takes it.
  const suggestion = !busyThread && !text && thread.suggestion ? thread.suggestion : null;
  const latest = useRef(text);
  latest.current = text;

  // ----- the `/` and `@` menus -----
  const update = (v: string) => {
    setText(v);
    drafts.set(key, v);
  };
  const commands = useCommands(`thread=${encodeURIComponent(threadId)}`);
  const { list } = commands;
  // The agents the message goes to (ADR 0019): the ones it names, else the lead. Once an `@` is typed, a line under the
  // box says who gets it and who joins (Q50); with none, the placeholder names the lead.
  const agents = useThreadAgents(thread);
  const named = useMemo(() => mentionedAgents(context).map((a) => ({ agent: a.agent, name: a.name })), [context]);
  const hint = routingHint(text, { agent: agents.lead.id, name: agents.lead.name }, named, agents.members.map((m) => m.id));
  // A message to members only does not steer the lead's running turn: it starts theirs.
  const toOthers = named.length > 0 && !named.some((a) => a.agent === agents.lead.id);

  // `mode` only matters while a turn is in progress; an idle thread just starts the next turn.
  const canSend = !thread.read_only && (!!text.trim() || context.length > 0);
  /** `sendThere`: the card's Send there, which lets the message wait for a machine that is asleep. */
  const submit = async (mode?: SendMode, sendThere = false) => {
    const raw = text;
    const prompt = raw.trim();
    if (!canSend || busy) return;
    setBusy(true);
    setError(null);
    setAway(null);
    // The box empties now: the message shows in the thread while it goes, and comes back here if it fails.
    const files = att.files;
    drafts.delete(key);
    setText('');
    att.clear();
    onSending?.();
    try {
      const t = await sendReply(prompt, mode, files, context, sendThere ? undefined : 'ask');
      onSent?.(t, mode);
    } catch (e) {
      // Unless Ben started a new message meanwhile.
      if (!latest.current || latest.current === raw) update(raw);
      att.add(files);
      const refusal = sendRefusal(e);
      if (refusal.livesOn || refusal.detail) setAway({ refusal, mode });
      else setError(errorText(e));
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
    if (!slash.armed || busy) return;
    const raw = text;
    await runReplyCommand(slash.action, thread, att.files, {
      sent: (files) => {
        sent(raw);
        if (files) att.clear();
      },
      openNew: () => openNewThread(sameSettings(thread)),
      pickModel: () => setPillRequest((n) => n + 1),
      started: (t) => navigate(`/t/${t.id}`),
      renamed: (t) => onChanged?.(t),
      busy: setBusy,
      error: setError,
    });
  };

  return (
    <div ref={setFrame} className={shell('rounded-[20px] bg-surface', att.over)} {...att.dropZone}>
      <DropHint over={att.over} />
      <ContextChips records={chipRecords(text, context)} onRemove={(id) => removeDraftContext(threadId, id)} className="px-3 pt-3 pb-0.5" />
      <AttachmentStrip files={att.files} onRemove={att.remove} />
      <MessageEditor
        // A fresh box per thread: its Undo history is that thread's draft.
        key={threadId}
        handle={ref}
        reply
        text={text}
        onText={update}
        draft={threadId}
        records={context}
        // `@` a machine: the Conductor (or a role with the omni tools) starts the task there.
        mentions={`thread=${encodeURIComponent(threadId)}`}
        agents={agents}
        commands={{ ...commands, where: 'reply' }}
        anchor={frame}
        onError={setError}
        onMenuOpen={setMenuOpen}
        onPaste={att.onPaste}
        onKeyDown={(e) => {
          if (e.key === 'Tab' && suggestion && !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            update(suggestion);
            requestAnimationFrame(() => ref.current?.focus('end'));
            return;
          }
          const key = enterKey(e, () => ref.current?.insert('\n'));
          if (!key) return;
          if (omni) return void runOmni();
          const busyMode: SendMode = key === 'interrupt' ? 'interrupt' : steers ? 'steer' : 'queue';
          void submit(busyThread && !toOthers ? busyMode : undefined);
        }}
        label="Message"
        placeholder={
          thread.read_only
            ? thread.read_only
            : suggestion
              ? `${suggestion} · ⇥ to use`
              : withKeys(!busyThread || replying ? (remoteLead ? remoteLeadPlaceholder(agents.lead.name) : replyTo(thread.role ? agents.lead.name : null)) : steers ? (technical ? `Steer ${agents.lead.name}. It reads this at its next step` : 'Add to this. It reads it at its next step') : technical ? 'Queue a message. It runs after this turn' : 'Send when it finishes')
        }
        className="block max-h-[220px] min-h-[60px] w-full overflow-y-auto bg-transparent px-4 pt-3 pb-1 text-[14.5px] leading-[1.8] outline-none"
      />
      <div className="flex flex-wrap items-center gap-1.5 px-2 pt-1.5 pb-2">
        <AttachButton onPick={att.add} disabled={busy} />
        <ForkThreadButton thread={thread} disabled={busy} />
        {/* A remote agent's run is its server: no harness or model to pick (ADR 0020). */}
        {!remoteLead && <ThreadRunPills thread={thread} openRequest={pillRequest} onSwitched={(t) => onChanged?.(t)} onError={setError} />}
        {machine && <ThreadMachineChip thread={thread} held={machine} disabled={busy} onError={setError} />}
        {commit && <CommitButton thread={thread} files={commit.files} onDone={commit.onDone} />}
        {openPR && (
          <Button size="sm" variant="primary" icon="pr" busy={openPR.busy} title={openPR.prompt} onClick={openPR.run}>
            {openPR.busy ? STEP_WORKING.open : 'Open PR'}
          </Button>
        )}
        <div className="ml-auto flex items-center gap-2.5">
          {omni ? (
            <SendButton armed={slash.armed} busy={busy} onClick={() => void runOmni()}>
              {slash.label ?? 'Send'}
            </SendButton>
          ) : replying || toOthers ? (
            <SendButton armed={canSend} busy={busy} onClick={() => void submit('steer')}>
              Send
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
        {slash.hint && !menuOpen && (
          <div className="px-4 pb-2.5 text-[12px] text-fg-3">{slash.hint}</div>
        )}
        {!slash.hint && hint && (
          <div data-routing-hint className="px-4 pb-2.5 text-[12px] text-fg-3">
            {hint}
          </div>
        )}
      </div>
      {away && (
        <LivesOnNote
          className="mx-2 mb-2"
          refusal={away.refusal}
          takeover={machine?.takeover}
          busy={busy}
          onSendThere={() => void submit(away.mode, true)}
          onTakeOver={() => setTakingOver(true)}
        />
      )}
      {(att.error || error) && <ErrorNote className="mx-2 mb-2">{att.error ?? error}</ErrorNote>}
      {takingOver && machine?.takeover && (
        <TakeoverConfirm
          threadId={threadId}
          takeover={machine.takeover}
          onClose={() => setTakingOver(false)}
          onChanged={(a) => {
            setAway(null);
            machine.onChanged(a);
          }}
        />
      )}
    </div>
  );
}
