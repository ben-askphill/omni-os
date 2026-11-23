import { useEffect, useRef, useState } from 'react';
import { term } from '@omni/shared/display.ts';
import { useTechnical } from '../display.ts';
import { api, errorText, harnessesPath, useApi, type HarnessWithRunning, type Thread } from '../api.ts';
import { HarnessLogo, OmniMark } from '../components/brand.tsx';
import { useBasePick, useBaseRows } from '../components/BasePicker.tsx';
import { useRunOn } from '../components/RunOnPicker.tsx';
import { ComposerAccountNotice } from '../components/AccountNotice.tsx';
import { pickerAccounts, useAccounts } from '../accounts.ts';
import { accountLine } from '@omni/shared/harness-accounts.ts';
import { AttachmentStrip, useAttachments } from '../components/Composer.tsx';
import { ThreadReferencePanel } from '../components/ThreadReference.tsx';
import { ContextChips } from '../message-context/ContextChips.tsx';
import { clearDraftContext, removeDraftContext, useDraftContext } from '../message-context/draft.ts';
import { referencesFor } from '../message-context/thread-picker.ts';
import { MessageEditor, newThreadScope, type MessageEditorHandle } from '../components/composer/MessageEditor.tsx';
import { chipRecords, machineMention } from '@omni/shared/message-context-machine.ts';
import { keepLocalFiles } from '../sending.ts';
import type { ModelChoice } from '../components/ModelPicker.tsx';
import { Avatar, ErrorNote, Segmented } from '../components/ui.tsx';
import { QuickAnswer } from '../components/QuickAnswer.tsx';
import { draftRun, draftRunRequest, type DraftRun } from '@omni/shared/draft-run.ts';
import { baseRequest } from '../worktree-base.ts';
import { AUTO_CHOICE, asksAuto } from '@omni/shared/thread-run.ts';
import { useNewThreadCommands } from '../components/composer/menus.tsx';
import { CONDUCTOR_CHANNEL, hasOwnLook } from '@omni/shared/channel-icon.ts';
import { GROK_BOT_NOTE, GROK_BOT_PLACEHOLDER, GROK_BOT_SENT, grokBotBlock } from '@omni/shared/thread-machine.ts';
import { sendMessageToGrokBot } from '../grokbot.ts';
import { href } from '../router.ts';
import { useApp } from '../store.tsx';
import { useDictation, withPhrase } from './dictation.ts';
import { BaseChip, BaseSheet } from './BaseSheet.tsx';
import { ModelSheet, runLabel } from './ModelSheet.tsx';
import { RunOnChip, RunOnSheet } from './RunOnSheet.tsx';
import { MoRound, MoSheet } from './parts.tsx';
import { useShell } from './shell.tsx';
import { TemplateChips, useTemplates } from '../templates.tsx';
import { templateDraft, type Template } from '@omni/shared/templates.ts';
import { CONDUCTOR_ROLE, isConductor } from '@omni/shared/crew-role.ts';

/** The sheet's draft-context list: its reference chips, gone with its text when the sheet closes. */
export const NEW_SHEET_DRAFT = 'new:sheet';

const pill = (on: boolean) =>
  `mo-press inline-flex h-9 shrink-0 items-center gap-[7px] rounded-full pr-3 pl-1.5 text-[13.5px] leading-none font-medium ${on ? 'bg-fg text-on-ink' : 'bg-surface-2 text-fg'}`;

/**
 * Ask: a quick ask answered right in the sheet, with a follow-up box, Copy, Keep as thread and Make it a task, as in the
 * desktop app's Quick Prompt (components/QuickAnswer.tsx, packages/shared/quick-ask.ts). Task: a new delegation to the
 * Conductor, or a new thread in one channel: the same POST /threads the desktop composer
 * makes, with the role's or the channel's run defaults until Ben picks another model. With Grok Bot on the machine
 * chip it posts the text to /api/grokbot instead, as the desktop composer does, and no thread starts. `prompt` fills the box to start.
 */
/** `run`: the run to start on, from `/clear` or `/new` in a thread (shell.tsx), which also makes it a task. */
export function NewSheet({ channel: initial, prompt: first, run: preset }: { channel?: string; prompt?: string; run?: DraftRun }) {
  const shell = useShell();
  const { channels, crew } = useApp();
  const listed = channels.filter((c) => !c.archived && c.id !== 'conductor');
  const conductorChannel = channels.find((c) => c.id === CONDUCTOR_CHANNEL);
  const [target, setTarget] = useState(initial ?? 'conductor');
  // An open item's New thread starts with its prompt (components/thread/OpenItemsCard.tsx).
  const [text, setText] = useState(first ?? '');
  const templates = useTemplates();
  const box = useRef<MessageEditorHandle>(null);
  const [frame, setFrame] = useState<HTMLDivElement | null>(null);
  // A template chip puts `/<name> ` in the box and hands the keyboard back, ready for what the job is about.
  const pickTemplate = (t: Template) => {
    setText(templateDraft(t));
    requestAnimationFrame(() => box.current?.focus('end'));
  };
  // As the target channel sees them: Cursor Cloud needs its GitHub repo.
  const { data: harnesses, reload } = useApi<HarnessWithRunning[]>(harnessesPath(target));
  const technical = useTechnical();
  // A pick holds for the target it was made for; another target starts on its own defaults, as on the desktop.
  const [picked, setPicked] = useState<{ target: string; choice: ModelChoice; effort: string } | null>(() => (preset ? { target: initial ?? 'conductor', ...preset } : null));
  const [picking, setPicking] = useState(false);
  const [pickingBase, setPickingBase] = useState(false);
  const [pickingMachine, setPickingMachine] = useState(false);
  const [referencing, setReferencing] = useState(false);
  const refs = useDraftContext(NEW_SHEET_DRAFT);
  // Fresh on open, as its text is, even after a reload that left chips in this browser's storage; dropped on close.
  useEffect(() => {
    clearDraftContext(NEW_SHEET_DRAFT);
    return () => clearDraftContext(NEW_SHEET_DRAFT);
  }, []);
  const runOn = useRunOn();
  const [base, setBase] = useBasePick(target);
  const [busy, setBusy] = useState(false);
  // An open item's prompt is a task to start; anything typed fresh is asked first.
  const [mode, setMode] = useState<'ask' | 'task'>(first || preset ? 'task' : 'ask');
  const [answering, setAnswering] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const att = useAttachments();
  const file = useRef<HTMLInputElement>(null);
  const mic = useDictation((p) => setText((t) => withPhrase(t, p)));
  const strip = useRef<HTMLDivElement>(null);
  // A block body: scrollIntoView returns a promise in newer Chrome, which React would take for a cleanup.
  useEffect(() => {
    strip.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, []);

  const conductor = target === 'conductor';
  const ch = conductor ? undefined : listed.find((c) => c.id === target);
  const role = conductor && crew.some((r) => isConductor(r.id)) ? CONDUCTOR_ROLE : '';
  const ro = crew.find((r) => r.id === role);
  const mentions = newThreadScope(target, mode === 'task' ? role : undefined);
  const run = harnesses ? draftRun(picked?.target === target ? picked : null, ro, channels.find((c) => c.id === target), harnesses) : null;
  const { rows: baseRows, reload: reloadBases } = useBaseRows(target, run?.choice.harness ?? '');
  // Who the picked harness runs as on the machine it will run on, as on the desktop composer. Auto picks one later.
  const accounts = useAccounts();
  const onMachine = pickerAccounts(accounts.data, runOn.pick);
  const harness = run && !asksAuto(run.choice) ? run.choice.harness : null;
  const accountFor = (pick: string) => {
    const a = harness ? pickerAccounts(accounts.data, pick)?.byHarness[harness] : undefined;
    return a ? accountLine(a) : null;
  };
  const switched = harness ? onMachine?.byHarness[harness] : undefined;
  const onTarget = (next: string) => {
    if (next === target) return;
    setTarget(next);
    setPicked(null);
  };
  const close = () => shell.sheet(null);
  // The `/` menu: the commands the picked harness lists for the channel, and why a command would stay text.
  const { commands, hint } = useNewThreadCommands({ text, choice: run?.choice ?? AUTO_CHOICE, channel: target });
  const [menuOpen, setMenuOpen] = useState(false);
  // Grok Bot takes the text alone: the model and the base do not apply, and attachments stop the send.
  const toGrok = runOn.grokBot;
  const grokBlock = toGrok ? grokBotBlock(att.files.length + refs.length) : null;

  const sendToGrok = async (prompt: string) => {
    if (grokBlock) return;
    setBusy(true);
    setError(null);
    const result = await sendMessageToGrokBot(prompt, target);
    setBusy(false);
    if (!result.ok) return setError(result.error);
    shell.toast(GROK_BOT_SENT);
    close();
  };

  const asking = mode === 'ask' && !toGrok;
  const send = async () => {
    const prompt = text.trim();
    if (!prompt || busy) return;
    if (toGrok) return sendToGrok(prompt);
    if (asking) {
      // A quick ask runs here and delegates nothing, so a machine mention stays out of it.
      const quickRefs = refs.filter((r) => r.kind !== machineMention.kind);
      setBusy(true);
      setError(null);
      try {
        const t = await api.send<Thread>(
          '/threads',
          { channel: target, prompt, quick: true, ...draftRunRequest(picked?.target === target ? run : null), ...(quickRefs.length && { context: referencesFor(quickRefs, target) }) },
          att.files,
        );
        clearDraftContext(NEW_SHEET_DRAFT);
        keepLocalFiles(t.id, att.files);
        setText('');
        setAnswering(t.id);
      } catch (e) {
        setError(errorText(e));
      } finally {
        setBusy(false);
      }
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const t = await api.send<Thread>(
        '/threads',
        {
          channel: target,
          prompt,
          role: role || undefined,
          ...draftRunRequest(picked?.target === target ? run : null),
          ...baseRequest(base, run?.choice.harness),
          ...runOn.request,
          ...(refs.length && { context: referencesFor(refs, target) }),
        },
        att.files,
      );
      keepLocalFiles(t.id, att.files);
      clearDraftContext(NEW_SHEET_DRAFT);
      shell.open(href.thread(t.id));
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  return (
    <>
      <MoSheet onClose={close} label={asking ? 'Ask' : conductor ? term('newDelegation', technical) : 'New thread'}>
        <div className="flex shrink-0 items-center px-3 pt-1.5 pb-2">
          <button type="button" onClick={close} className="w-[60px] px-1.5 py-2 text-left text-[15px]">
            Cancel
          </button>
          <span className="flex-1 text-center text-[15px] font-medium">{asking ? 'Ask' : conductor ? term('newDelegation', technical) : 'New thread'}</span>
          <span className="w-[60px]" />
        </div>
        {!toGrok && !answering && (
          <div className="flex shrink-0 justify-center px-4 pb-3">
            <Segmented
              label="Ask or start a task"
              value={mode}
              onChange={setMode}
              options={[
                { id: 'ask', label: 'Ask' },
                { id: 'task', label: 'Task' },
              ]}
            />
          </div>
        )}
        {answering ? (
          <div className="mx-3 rounded-[26px] bg-surface-2 px-3.5 py-3.5">
            <QuickAnswer id={answering} touch onOpen={(id) => shell.open(href.thread(id))} />
            <button type="button" onClick={() => setAnswering(null)} className="mo-press mt-3 text-[14px] font-medium text-fg-2">
              New ask
            </button>
          </div>
        ) : (
        <>
        <div ref={strip} className="mo-scroll flex shrink-0 gap-2 overflow-x-auto px-4 pb-3">
          <button type="button" onClick={() => onTarget('conductor')} className={pill(conductor)} aria-pressed={conductor}>
            {conductorChannel && hasOwnLook(conductorChannel) ? (
              <Avatar name={conductorChannel.name} omni channelIcon={conductorChannel.icon} avatarBg={conductorChannel.avatar_bg} size={24} />
            ) : (
              <span className="grid h-6 w-6 place-items-center rounded-full bg-bg text-fg">
                <OmniMark size={18} />
              </span>
            )}
            Conductor
          </button>
          {listed.map((c) => (
            <button key={c.id} type="button" onClick={() => onTarget(c.id)} className={pill(target === c.id)} aria-pressed={target === c.id}>
              <Avatar name={c.name} channelIcon={c.icon} avatarBg={c.avatar_bg} size={24} />#{c.name}
            </button>
          ))}
        </div>
        <div ref={setFrame} className="relative mx-3 flex flex-col gap-2.5 rounded-[26px] bg-surface px-2 pt-3.5 pb-2">
          <ContextChips records={chipRecords(text, refs)} onRemove={(id) => removeDraftContext(NEW_SHEET_DRAFT, id)} className="px-1" />
          <AttachmentStrip files={att.files} onRemove={att.remove} />
          <MessageEditor
            handle={box}
            autoFocus
            text={text}
            onText={setText}
            draft={NEW_SHEET_DRAFT}
            records={refs}
            // Files, and for a task the Conductor starts, the machine each task goes to, as on the desktop. An Ask
            // runs here with read-only tools, so it lists no machines.
            mentions={mentions}
            commands={toGrok ? undefined : { ...commands, where: 'new-thread' }}
            // Upward: the sheet ends near the box, and the phone keyboard sits under it.
            anchor={frame}
            onError={setError}
            onMenuOpen={setMenuOpen}
            onPaste={att.onPaste}
            enterKeyHint="send"
            label="Message"
            placeholder={toGrok ? GROK_BOT_PLACEHOLDER : asking ? 'Ask anything. The answer shows here.' : ch ? `Describe the task for #${ch.name}` : 'Ask the Conductor. It delegates to the crew.'}
            className="max-h-[40vh] min-h-[92px] overflow-y-auto bg-transparent px-2 text-[16px] leading-[1.45] text-fg outline-none"
          />
          {/* A quick ask runs here with no worktree, so neither the base nor the machine applies. */}
          {!asking && ((baseRows && !toGrok) || runOn.rows) && (
            <div className="flex min-w-0 flex-wrap gap-1.5">
              {baseRows && !toGrok && (
                <BaseChip
                  rows={baseRows}
                  value={base}
                  onClick={() => {
                    reloadBases();
                    setPickingBase(true);
                  }}
                />
              )}
              {runOn.rows && (
                <RunOnChip
                  rows={runOn.rows}
                  value={runOn.pick}
                  onClick={() => {
                    runOn.reload();
                    setPickingMachine(true);
                  }}
                />
              )}
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <input
              ref={file}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                att.add([...(e.target.files ?? [])]);
                e.target.value = '';
              }}
            />
            <MoRound icon="plus" label="Attach files" onClick={() => file.current?.click()} disabled={busy} />
            {!toGrok && <MoRound icon="message" label="Reference a thread" onClick={() => setReferencing(true)} disabled={busy} />}
            {!toGrok && (
              <button
                type="button"
                onClick={() => {
                  void reload();
                  accounts.reload();
                  setPicking(true);
                }}
                disabled={!harnesses}
                className="mo-press inline-flex h-10 min-w-0 items-center gap-[7px] rounded-full bg-surface-2 px-3 text-[13px] font-medium text-fg disabled:opacity-40"
              >
                {run && (asksAuto(run.choice) ? <OmniMark size={15} /> : <HarnessLogo harness={run.choice.harness} size={13} />)}
                <span className="truncate">{run ? runLabel(harnesses, run.choice, run.effort) : 'Model'}</span>
              </button>
            )}
            <span className="flex-1" />
            {text.trim() || !mic.supported ? (
              <MoRound ink icon="send" label={toGrok ? 'Send to Grok Bot' : 'Send'} onClick={() => void send()} disabled={!text.trim() || busy || !!grokBlock} />
            ) : (
              <MoRound ink={!mic.on} icon={mic.on ? 'stop' : 'mic'} label={mic.on ? 'Stop dictating' : 'Dictate'} onClick={mic.toggle} />
            )}
          </div>
        </div>
        {!text.trim() && !toGrok && templates.data && (
          <TemplateChips templates={templates.data.templates} onPick={pickTemplate} touch className="px-4 pt-3" />
        )}
        {grokBlock && <ErrorNote className="mx-3 mt-2">{grokBlock}</ErrorNote>}
        {switched?.notice && onMachine && (
          <div className="mt-2 px-1">
            <ComposerAccountNotice machine={{ id: onMachine.id, name: onMachine.machine }} account={switched} onSeen={accounts.setData} />
          </div>
        )}
        {(att.error || error) && <ErrorNote className="mx-3 mt-2">{att.error ?? error}</ErrorNote>}
        <div aria-live="polite">{hint && !menuOpen && !toGrok && <p className="m-0 px-6 pt-2.5 text-[12.5px] leading-[1.45] text-fg-3">{hint}</p>}</div>
        <p className="m-0 px-6 pt-2.5 text-[12.5px] leading-[1.45] text-fg-3">
          {toGrok
            ? GROK_BOT_NOTE
            : asking
              ? 'Answered here with read-only tools. Work that changes something needs a task. Recent asks keep it for 7 days.'
              : ch
                ? technical
                  ? `Runs in #${ch.name} with its repo, store and browser profile.`
                  : `In #${ch.name}.`
              : 'The Conductor picks the crew and reports back here. Activity shows you when something needs you.'}
        </p>
        </>
        )}
      </MoSheet>
      {pickingBase && baseRows && <BaseSheet rows={baseRows} value={base} onChange={setBase} onClose={() => setPickingBase(false)} />}
      {referencing && (
        <MoSheet onClose={() => setReferencing(false)} label="Reference a thread" full>
          <ThreadReferencePanel to={{ draft: NEW_SHEET_DRAFT, channel: target }} touch onPicked={() => setReferencing(false)} />
        </MoSheet>
      )}
      {pickingMachine && runOn.rows && <RunOnSheet rows={runOn.rows} value={runOn.pick} onChange={runOn.setPick} accountFor={accountFor} onClose={() => setPickingMachine(false)} />}
      {picking && harnesses && run && (
        <ModelSheet
          harnesses={harnesses}
          choice={run.choice}
          effort={run.effort}
          onChange={(choice, effort) => setPicked({ target, choice, effort })}
          onClose={() => setPicking(false)}
          accounts={onMachine}
        />
      )}
    </>
  );
}
