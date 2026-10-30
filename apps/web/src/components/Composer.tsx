import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent as ReactClipboardEvent, type DragEvent as ReactDragEvent, type FocusEvent as ReactFocusEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject, type SyntheticEvent } from 'react';
import { api, errorText, harnessesPath, useApi, type HarnessWithRunning, type SendMode, type Thread } from '../api.ts';
import { bytes, CHANNEL_KIND } from '../format.ts';
import { dropNewThreadPreset, navigate, openNewThread, peekNewThreadPreset, takeComposerFocus } from '../router.ts';
import { useApp } from '../store.tsx';
import { ErrorNote, Icon, IconButton, Kbd, Loader, Picker, type IconName, type PickerOption } from './ui.tsx';
import { CrewMark, isCrewRole } from './brand.tsx';
import { ModelPicker } from './ModelPicker.tsx';
import { BasePicker, useBasePick } from './BasePicker.tsx';
import { RunOnPicker, useRunOn } from './RunOnPicker.tsx';
import { baseRequest } from '../worktree-base.ts';
import { currentRun, pickedRun, shownRun, threadChoice, threadRunLabels, type RunPick } from '../thread-run.ts';
import type { Run } from '@omni/shared/run-switch.ts';
import { SlashMenu, optionId, useCommands } from './SlashMenu.tsx';
import { FileMenu, useFileMenu } from './FileMenu.tsx';
import { mentionSections, menuSections, pickCommand, rowKey, slashQuery } from '@omni/shared/slash-menu.ts';
import { menuCommands, newThreadHint, replySlash } from '@omni/shared/composer-slash.ts';
import { draftRun, draftRunRequest, newThreadBody, sameSettings, type DraftRun } from '../new-thread-preset.ts';
import { asksAuto } from '../thread-run.ts';
import { parseSlash, type SlashCommand } from '@omni/shared/slash.ts';
import { requestIdFor, sendKey, type PendingRequest } from '../requests.ts';
import { beginSend } from '../sending.ts';
import type { MessageContext } from '@omni/shared/message-context.ts';
import { ContextChips } from '../message-context/ContextChips.tsx';
import { ForkThreadButton } from './ContinueSheet.tsx';
import { removeDraftContext, settleDraftContext, useDraftContext } from '../message-context/draft.ts';

// Unsent text survives navigation (not reloads). Keyed by where the composer lives.
const drafts = new Map<string, string>();

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const MOD = isMac ? 'Cmd' : 'Ctrl';

function useAutosize(ref: RefObject<HTMLTextAreaElement | null>, value: string, max: number) {
  const fit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
  }, [ref, max]);
  useLayoutEffect(fit, [fit, value]);
  // The placeholder counts toward scrollHeight, so a measurement taken before layout or font load
  // settles can come out far too tall. Refit when the width or the fonts change.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    void document.fonts?.ready.then(fit);
    if (typeof ResizeObserver === 'undefined') return;
    let w = el.clientWidth;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === w) return;
      w = el.clientWidth;
      fit();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, fit]);
}

function useFocusRequests(ref: RefObject<HTMLTextAreaElement | null>, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    if (takeComposerFocus()) ref.current?.focus();
    const on = () => {
      takeComposerFocus();
      ref.current?.focus();
    };
    window.addEventListener('omni:focus-composer', on);
    return () => window.removeEventListener('omni:focus-composer', on);
  }, [ref, enabled]);
}

// ---------- attachments ----------

const MAX_ATTACHMENTS = 10;
const isImage = (f: File) => f.type.startsWith('image/');
const sameFile = (a: File, b: File) => a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;

/** Files staged for the next message: paperclip, drag-and-drop and paste all land here. */
export function useAttachments() {
  const { status } = useApp();
  const maxMb = status?.maxUploadMb ?? 25;
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const depth = useRef(0); // dragenter/leave also fire for children, so count them

  const add = useCallback(
    (incoming: File[]) => {
      if (!incoming.length) return;
      const tooBig = incoming.filter((f) => f.size > maxMb * 1024 * 1024);
      const ok = incoming.filter((f) => f.size <= maxMb * 1024 * 1024 && f.size > 0);
      setFiles((prev) => {
        const next = [...prev];
        for (const f of ok) if (!next.some((x) => sameFile(x, f))) next.push(f);
        if (next.length > MAX_ATTACHMENTS) {
          setError(`At most ${MAX_ATTACHMENTS} files per message.`);
          return next.slice(0, MAX_ATTACHMENTS);
        }
        return next;
      });
      setError(tooBig.length ? `${tooBig.map((f) => `"${f.name}"`).join(', ')} ${tooBig.length > 1 ? 'are' : 'is'} over the ${maxMb} MB limit.` : null);
    },
    [maxMb],
  );

  const remove = (f: File) => setFiles((prev) => prev.filter((x) => x !== f));
  const clear = () => {
    setFiles([]);
    setError(null);
  };

  const onPaste = (e: ReactClipboardEvent) => {
    const pasted = [...(e.clipboardData?.files ?? [])];
    // Text pastes carry no files; only intercept when something real came along.
    if (!pasted.length) return;
    e.preventDefault();
    add(pasted);
  };

  const dropZone = {
    onDragEnter: (e: ReactDragEvent) => {
      if (![...e.dataTransfer.types].includes('Files')) return;
      e.preventDefault();
      depth.current++;
      setOver(true);
    },
    onDragOver: (e: ReactDragEvent) => {
      if (![...e.dataTransfer.types].includes('Files')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    },
    onDragLeave: () => {
      if (--depth.current <= 0) {
        depth.current = 0;
        setOver(false);
      }
    },
    onDrop: (e: ReactDragEvent) => {
      if (![...e.dataTransfer.types].includes('Files')) return;
      e.preventDefault();
      depth.current = 0;
      setOver(false);
      add([...e.dataTransfer.files]);
    },
  };

  return { files, error, setError, add, remove, clear, over, onPaste, dropZone };
}

function Thumb({ file }: { file: File }) {
  const url = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return <img src={url} alt="" className="h-9 w-9 shrink-0 rounded-lg object-cover shadow-[inset_0_0_0_1px_var(--line)]" />;
}

/** Staged attachments, above the input, each removable until the message is sent. */
export function AttachmentStrip({ files, onRemove }: { files: File[]; onRemove: (f: File) => void }) {
  if (!files.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5 px-3 pt-3 pb-0.5">
      {files.map((f, i) => (
        <span key={`${f.name}:${f.size}:${i}`} className="flex h-11 max-w-[15rem] items-center gap-2 rounded-2xl bg-surface-2 pr-1 pl-1 text-[12.5px]">
          {isImage(f) ? (
            <Thumb file={f} />
          ) : (
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-bg text-fg-3">
              <Icon name="file" size={15} />
            </span>
          )}
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block truncate font-medium text-fg-2">{f.name}</span>
            <span className="block font-num text-[10.5px] text-fg-4">{bytes(f.size)}</span>
          </span>
          <IconButton icon="x" label={`Remove ${f.name}`} size={13} className="h-6 w-6" onClick={() => onRemove(f)} />
        </span>
      ))}
    </div>
  );
}

function AttachButton({ onPick, disabled }: { onPick: (files: File[]) => void; disabled?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          onPick([...(e.target.files ?? [])]);
          e.target.value = ''; // so picking the same file twice still fires
        }}
      />
      <IconButton icon="paperclip" label="Attach files" size={15} disabled={disabled} onClick={() => ref.current?.click()} />
    </>
  );
}

/** Bencho "cmd" go button: quiet until there is something to send, then ink. */
/** Where Send sits, while a turn runs and the box is empty: stops the turn. Esc does the same. */
function StopButton({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  const label = busy ? 'Stopping' : 'Stop';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-label={label}
      aria-keyshortcuts="Escape"
      title="Stop the agent (Esc). Messages already sent still run."
      className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-full bg-fg text-on-ink transition-[opacity,transform] duration-150 ease-out active:scale-[.92] disabled:opacity-60"
    >
      {busy ? <Loader size={16} /> : <Icon name="stop" size={16} strokeWidth={2} />}
    </button>
  );
}

function SendButton({ armed, busy, onClick, children }: { armed: boolean; busy: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!armed || busy}
      data-armed={armed || undefined}
      aria-label={typeof children === 'string' ? children : undefined}
      title={typeof children === 'string' ? children : undefined}
      className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-full bg-fg text-on-ink transition-[opacity,transform] duration-150 ease-out active:scale-[.92] disabled:opacity-25"
    >
      {busy ? <Loader size={16} /> : <Icon name="send" size={16} strokeWidth={2} />}
      <span className="sr-only">{children}</span>
    </button>
  );
}

/** A composer's placeholder, with the two keys that open a menu. */
const withKeys = (text: string) => `${text} · / commands, @ files`;

/**
 * Enter sends, Shift+Cmd/Ctrl+Enter interrupts, Cmd/Ctrl+Enter inserts a newline (Shift+Enter keeps the
 * textarea's own). Null for every other key, and for the Enter that ends an IME composition (229: Safari's,
 * which it doesn't flag as composing). Prevents the default for the keys it acts on.
 */
function enterKey(e: ReactKeyboardEvent<HTMLTextAreaElement>, text: string, onText: (text: string) => void): 'send' | 'interrupt' | null {
  if (e.key !== 'Enter' || e.nativeEvent.isComposing || e.keyCode === 229 || e.altKey) return null;
  const mod = e.metaKey || e.ctrlKey;
  if (!mod && e.shiftKey) return null;
  e.preventDefault();
  if (mod && e.shiftKey) return 'interrupt';
  if (!mod) return 'send';
  const el = e.currentTarget;
  const at = el.selectionStart + 1;
  onText(text.slice(0, el.selectionStart) + '\n' + text.slice(el.selectionEnd));
  requestAnimationFrame(() => el.setSelectionRange(at, at));
  return null;
}

const shell = (shape: string, over = false) =>
  `${shape} relative transition-[background-color,box-shadow] duration-[160ms] ease-out focus-within:bg-bg ${
    over
      ? 'bg-bg shadow-[inset_0_0_0_1px_var(--line-strong),0_0_0_4px_var(--wash)]'
      : 'focus-within:shadow-[inset_0_0_0_1px_var(--line-strong),0_0_0_4px_var(--wash)]'
  }`;

function DropHint({ over }: { over: boolean }) {
  if (!over) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-[inherit] bg-bg/85">
      <span className="flex items-center gap-2 text-[13px] font-medium text-fg-2">
        <Icon name="paperclip" size={15} /> Drop to attach
      </span>
    </div>
  );
}

// ---------- the `/` menu ----------

/**
 * The `/` menu over a composer's textarea: whether it is open, what it lists, and the keys and
 * textarea props that drive it. A thread's reply box adds Omni's own commands at the start of a message.
 */
function useSlashMenu({
  ref,
  text,
  onText,
  commands: { list, load },
  where,
}: {
  ref: RefObject<HTMLTextAreaElement | null>;
  text: string;
  /** The composer's own setter, which keeps its draft too. */
  onText: (text: string) => void;
  commands: ReturnType<typeof useCommands>;
  where: 'reply' | 'new-thread';
}) {
  const menuId = useId();
  const [caret, setCaret] = useState(0);
  const [focused, setFocused] = useState(false);
  // Esc closes the menu for this command until the text changes. Moving the caret keeps it closed.
  const [dismissed, setDismissed] = useState<string | null>(null);
  const at = focused ? slashQuery(text, caret) : null;
  const here = at && `${at.start}\0${text}`;
  // After the start of the message, only a Mention: a skill or custom command, never an Omni command.
  const sections = useMemo(() => {
    if (!at) return [];
    const rows = menuCommands(list?.commands, where);
    return (at.mention ? mentionSections : menuSections)(rows, at.query, list?.recent);
  }, [at?.query, at?.mention, list, where]);
  const items = sections.flatMap((s) => s.commands);
  // A ready list with nothing matching shows no menu: the text is sent as it is.
  const open = !!here && dismissed !== here && (items.length > 0 || !list || list.status !== 'ready');
  // The highlight follows a command, not a row number, so a list that refreshes while open keeps it.
  const navKey = `${at?.start}\0${at?.query}`;
  const [nav, setNav] = useState<{ key: string; row: string | null }>({ key: '', row: null });
  const active = Math.max(nav.key === navKey ? items.findIndex((c) => rowKey(c) === nav.row) : 0, 0);
  const moveTo = (i: number) => setNav({ key: navKey, row: rowKey(items[i]) });
  const [picked, setPicked] = useState<{ caret: number } | null>(null);

  // Swap in a fresh list whenever the menu opens, or gets another list while open (a new harness or
  // channel); the server only probes a list older than 30 seconds.
  const loaded = useRef<typeof load | null>(null);
  useEffect(() => {
    if (open && loaded.current !== load) void load();
    loaded.current = open ? load : null;
  }, [open, load]);

  // Put the caret after `/name ` once the picked text is in the textarea.
  useLayoutEffect(() => {
    if (picked) ref.current?.setSelectionRange(picked.caret, picked.caret);
  }, [picked, ref]);

  const pick = (c: SlashCommand) => {
    if (!at) return;
    const next = pickCommand(text, at, c.name);
    onText(next.text);
    setCaret(next.caret);
    setPicked({ caret: next.caret });
  };

  /** Arrow keys, Enter, Tab and Esc drive the menu while it is open. True when the key was used. */
  const onKey = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    // 229: Safari's Enter that ends an IME composition, which it doesn't flag as composing.
    if (!open || e.nativeEvent.isComposing || e.keyCode === 229) return false;
    const n = items.length;
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && n) {
      moveTo((active + (e.key === 'ArrowDown' ? 1 : -1) + n) % n);
    } else if (((e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) || (e.key === 'Tab' && !e.shiftKey)) && n) {
      pick(items[active]);
    } else if (e.key === 'Escape') {
      setDismissed(here);
    } else {
      return false;
    }
    e.preventDefault();
    return true;
  };

  const textarea = {
    onChange: (e: ChangeEvent<HTMLTextAreaElement>) => {
      onText(e.target.value);
      setCaret(e.target.selectionStart);
      // Deleting the command ends an Esc, so typing `/` again reopens the menu.
      if (!slashQuery(e.target.value, e.target.selectionStart)) setDismissed(null);
    },
    onSelect: (e: SyntheticEvent<HTMLTextAreaElement>) => setCaret(e.currentTarget.selectionStart),
    onFocus: (e: ReactFocusEvent<HTMLTextAreaElement>) => {
      setFocused(true);
      setCaret(e.currentTarget.selectionStart);
      void load();
    },
    onBlur: () => setFocused(false),
    'aria-autocomplete': 'list' as const,
    'aria-controls': open ? menuId : undefined,
    'aria-activedescendant': open && items.length ? optionId(menuId, active) : undefined,
  };

  const menu = open ? { id: menuId, list, sections, active, onActive: moveTo, onPick: pick } : null;
  return { open, menu, onKey, textarea };
}

/** The `/` and `@` menus on one textarea: the handlers of both, and the keys go to whichever is open. */
function joinMenus(slash: ReturnType<typeof useSlashMenu>, files: ReturnType<typeof useFileMenu>) {
  const { aria, ...f } = files.textarea;
  return {
    textarea: {
      ...slash.textarea,
      onChange: (e: ChangeEvent<HTMLTextAreaElement>) => {
        slash.textarea.onChange(e);
        f.onChange(e);
      },
      onSelect: (e: SyntheticEvent<HTMLTextAreaElement>) => {
        slash.textarea.onSelect(e);
        f.onSelect(e);
      },
      onFocus: (e: ReactFocusEvent<HTMLTextAreaElement>) => {
        slash.textarea.onFocus(e);
        f.onFocus(e);
      },
      onBlur: () => {
        slash.textarea.onBlur();
        f.onBlur();
      },
      ...(files.open ? aria : {}),
    },
    onKey: (e: ReactKeyboardEvent<HTMLTextAreaElement>) => slash.onKey(e) || files.onKey(e),
    open: slash.open || files.open,
  };
}

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

  // ----- the `/` menu: the harness in the picker, for the folder a thread in this channel reads its commands from -----
  // Auto picks the harness only once the prompt is sent, so its menu is Claude Code's.
  const auto = asksAuto(choice);
  const menuHarness = auto ? 'claude-code' : choice.harness;
  const commands = useCommands(`harness=${encodeURIComponent(menuHarness)}&channel=${encodeURIComponent(channel)}`);
  const slashMenu = useSlashMenu({ ref, text, onText: update, commands, where: 'new-thread' });
  const fileMenu = useFileMenu({ ref, text, onText: update, scope: `channel=${encodeURIComponent(channel)}` });
  const menus = joinMenus(slashMenu, fileMenu);
  const hint = useMemo(() => newThreadHint(text, commands.list, menuHarness), [text, commands.list, menuHarness]);
  // Another harness or channel has its own list: fetch it for what is typed, so the hint re-checks it.
  const latest = useRef(text);
  latest.current = text;
  const { load } = commands;
  useEffect(() => {
    const { lead, mentions } = parseSlash(latest.current);
    if (lead || mentions.length) void load();
  }, [load]);

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

  const channelOptions: PickerOption<string>[] = visibleChannels.map((c) => ({
    value: c.id,
    label: c.id === 'conductor' ? 'Conductor' : c.name,
    sub: CHANNEL_KIND[c.kind] ?? c.kind,
    avatar: c.name,
    icon: c.id === 'conductor' ? 'target' : undefined,
  }));
  if (!visibleChannels.some((c) => c.id === channel)) channelOptions.push({ value: channel, label: channel, avatar: channel });
  const roleOptions: PickerOption<string>[] = [
    { value: '', label: 'No role', sub: 'No charter', avatar: false, icon: 'x' },
    ...crew.map((r) => ({ value: r.id, label: r.name, sub: r.description, avatar: r.name, lead: isCrewRole(r.id) ? <CrewMark role={r.id} size={13} /> : undefined })),
  ];
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

const SEND_OPTIONS: { mode: SendMode; label: string; hint: string; icon: IconName; keys?: string[] }[] = [
  { mode: 'steer', label: 'Steer now', hint: 'The agent reads it at its next step', icon: 'send', keys: ['Enter'] },
  { mode: 'queue', label: 'Queue for after this turn', hint: 'Runs when the current turn ends', icon: 'clock' },
  { mode: 'interrupt', label: 'Interrupt and send', hint: 'Stops the current step, then runs this', icon: 'stop', keys: [MOD, 'Shift', 'Enter'] },
];

const halfCls = 'inline-flex h-[34px] items-center bg-fg text-on-ink transition-[opacity,transform] duration-150 ease-out select-none active:scale-[.92] disabled:opacity-25';

/** Split button for a busy thread: Steer (or Queue when the harness can't steer), plus a menu. */
function SteerButton({ disabled, busy, canSteer = true, onSend }: { disabled: boolean; busy: boolean; canSteer?: boolean; onSend: (mode: SendMode) => void }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (disabled || busy) setOpen(false);
  }, [disabled, busy]);

  useEffect(() => {
    if (!open) return;
    items.current[0]?.focus();
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    // The thread page skips its Esc-to-interrupt while a [role=menu] is open, so this only closes the menu.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const onMenuKey = (e: ReactKeyboardEvent) => {
    const list = items.current.filter((b): b is HTMLButtonElement => !!b);
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    const go = (k: number) => {
      e.preventDefault();
      list[(k + list.length) % list.length]?.focus();
    };
    if (e.key === 'ArrowDown') go(at + 1);
    else if (e.key === 'ArrowUp') go(at - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(list.length - 1);
    else if (e.key === 'Tab') setOpen(false);
  };

  const options = canSteer ? SEND_OPTIONS : SEND_OPTIONS.filter((o) => o.mode !== 'steer');
  const primary: SendMode = canSteer ? 'steer' : 'queue';
  return (
    <div ref={wrap} className="relative flex">
      <button type="button" onClick={() => onSend(primary)} disabled={disabled || busy} className={`${halfCls} gap-1.5 rounded-l-full pr-2.5 pl-3.5 text-[13px] font-medium whitespace-nowrap`}>
        {busy ? <Loader size={16} /> : <Icon name={canSteer ? 'send' : 'clock'} size={16} strokeWidth={2} />}
        {canSteer ? 'Steer' : 'Queue'}
      </button>
      <button
        ref={trigger}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More ways to send"
        title="More ways to send"
        disabled={disabled || busy}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={`${halfCls} w-8 justify-center rounded-r-full border-l border-on-ink/25 pr-0.5`}
      >
        <Icon name="chevronDown" size={13} />
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Send options"
          onKeyDown={onMenuKey}
          className="fade-in absolute right-0 bottom-full z-20 mb-1.5 w-72 max-w-[calc(100vw-1.5rem)] sm:w-80 rounded-[22px] bg-elev p-1.5 shadow-[var(--shadow-menu)]"
        >
          {options.map((o, k) => (
            <button
              key={o.mode}
              ref={(el) => {
                items.current[k] = el;
              }}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onSend(o.mode);
              }}
              className="flex min-h-10 w-full min-w-0 items-start gap-2.5 rounded-2xl px-3 py-2 text-left outline-none hover:bg-[var(--wash)] focus:bg-[var(--wash)]"
            >
              <Icon name={o.icon} size={14} className="mt-[3px] text-fg-3" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 text-[13px] text-fg">{o.label}</span>
                  {o.keys && (
                    <span className="hidden shrink-0 items-center gap-0.5 sm:flex">
                      {o.keys.map((key) => (
                        <Kbd key={key}>{key}</Kbd>
                      ))}
                    </span>
                  )}
                </span>
                <span className="block text-[11.5px] text-fg-4">{o.hint}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const finePointer = () => typeof matchMedia !== 'undefined' && matchMedia('(pointer: fine)').matches;

/**
 * The thread's model and effort. Picking either switches the run for the next turn: the server answers with the
 * thread, or says why not. While a turn runs the pick waits for it (`queued_*`), so the pills show it with a "Next
 * turn" chip whose x drops it.
 */
function ThreadRunPills({
  thread,
  openRequest,
  onSwitched,
  onError,
}: {
  thread: Thread;
  /** Bumped to open the model list: `/model`, `/effort` and `/fast`. */
  openRequest: number;
  onSwitched: (t: Thread) => void;
  onError: (text: string | null) => void;
}) {
  const { data: harnesses, reload } = useApi<HarnessWithRunning[]>('/harnesses');
  const [switching, setSwitching] = useState(false);
  const shown = shownRun(thread);
  const queued = shown !== thread;
  const labels = threadRunLabels(shown, harnesses);
  const choice = threadChoice(shown, harnesses);

  const post = async (run: Run | null) => {
    if (!run || switching) return;
    setSwitching(true);
    onError(null);
    try {
      onSwitched(await api.post<Thread>(`/threads/${encodeURIComponent(thread.id)}/run`, run));
    } catch (e) {
      onError(errorText(e));
    } finally {
      setSwitching(false);
    }
  };
  const pick = (p: RunPick) => void post(pickedRun(shown, harnesses, p));

  if (!harnesses) return null;
  const now = threadRunLabels(thread, harnesses);
  const busy = thread.status === 'running' || thread.status === 'queued';
  const ring = queued ? 'rounded-full ring-1 ring-live' : '';
  return (
    <span title={busy && !queued ? 'A pick now applies when this turn ends' : (shown.auto_reason ?? undefined)} className="inline-flex max-w-full items-center gap-1.5">
      {queued && (
        <button
          type="button"
          disabled={switching}
          onClick={() => void post(currentRun(thread))}
          title={`Runs on ${now.model}, ${now.effort} until this turn ends. Click to keep it.`}
          aria-label={`Next turn runs on ${labels.model}, ${labels.effort}. Keep ${now.model}, ${now.effort}`}
          className="press inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-surface-2 pr-2 pl-2.5 text-[12px] font-semibold text-live-text transition-colors hover:bg-surface-3 disabled:opacity-45"
        >
          <Icon name="clock" size={13} />
          Next turn
          <Icon name="x" size={12} className="text-fg-4" />
        </button>
      )}
      <ModelPicker
        harnesses={harnesses}
        onOpen={reload}
        openRequest={openRequest}
        offerAuto={false}
        label={labels.model}
        value={choice}
        disabled={switching}
        className={ring}
        onChange={(c) => pick(c)}
        effort={{ value: shown.effort, onChange: (effort) => pick({ effort }) }}
      />
    </span>
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
