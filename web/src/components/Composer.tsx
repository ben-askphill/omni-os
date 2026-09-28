import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent as ReactClipboardEvent, type DragEvent as ReactDragEvent, type FocusEvent as ReactFocusEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject, type SyntheticEvent } from 'react';
import { api, errorText, useApi, type HarnessWithRunning, type SendMode, type Thread } from '../api.ts';
import { bytes } from '../format.ts';
import { dropNewThreadPreset, navigate, openNewThread, peekNewThreadPreset, takeComposerFocus } from '../router.ts';
import { useApp } from '../store.tsx';
import { ErrorNote, Icon, IconButton, Kbd, Loader, Picker, type IconName, type PickerOption } from './ui.tsx';
import { CrewMark, isCrewRole } from './brand.tsx';
import { ModelPicker, type ModelChoice } from './ModelPicker.tsx';
import { SlashMenu, optionId, useCommands } from './SlashMenu.tsx';
import { mentionSections, menuSections, pickCommand, rowKey, slashQuery } from '../slash-menu.ts';
import { menuCommands, newThreadBody, newThreadHint, otherModel, replySlash, sameSettings } from '../composer-slash.ts';
import { parseSlash, type SlashCommand } from '../../../shared/slash.ts';

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
function useAttachments() {
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
function AttachmentStrip({ files, onRemove }: { files: File[]; onRemove: (f: File) => void }) {
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

const KIND: Record<string, string> = { client: 'Client', internal: 'Internal', personal: 'Personal', system: 'System' };

/** Bencho "cmd" go button: quiet until there is something to send, then ink. */
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

function Hint() {
  return (
    <span className="hidden items-center gap-3.5 pr-1 text-[11.5px] text-fg-4 sm:inline-flex">
      <span>{isMac ? '⌘↵' : 'Ctrl ↵'} send</span>
      <span>↵ newline</span>
      <span>/ commands</span>
    </span>
  );
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
  // Set up from the thread Ben came from, when `/clear` or "New thread on another model" opened this.
  const [preset] = useState(() => (channelId ? peekNewThreadPreset(channelId) : null));
  useEffect(() => {
    if (preset) dropNewThreadPreset(preset);
  }, [preset]);
  const [text, setText] = useState(() => drafts.get(key) ?? '');
  const [channel, setChannel] = useState(channelId ?? defaultChannel);
  const [role, setRole] = useState<string>(() => preset?.role ?? ((channelId ?? defaultChannel) === 'conductor' ? 'conductor' : ''));
  const [choice, setChoice] = useState<ModelChoice>(() => preset?.choice ?? { harness: 'claude-code', model: '' });
  const [effort, setEffort] = useState(preset?.effort ?? '');
  const { data: harnesses, reload: reloadHarnesses } = useApi<HarnessWithRunning[]>('/harnesses');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const att = useAttachments();
  useAutosize(ref, text, big ? 360 : 260);
  useFocusRequests(ref, true);

  useEffect(() => {
    if (channelId) setChannel(channelId);
  }, [channelId]);

  // A new composer starts on its harness's default model (Claude Code's, unless a preset says), not on the last pick.
  useEffect(() => {
    if (!harnesses || choice.model) return;
    const h = harnesses.find((x) => x.id === choice.harness);
    const def = h?.models.find((m) => m.default) ?? h?.models[0];
    if (def) setChoice({ harness: choice.harness, model: def.id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [harnesses]);

  // Default the role once crew loads, if the conductor channel is selected. A preset keeps its own.
  useEffect(() => {
    if (!preset && !role && channel === 'conductor' && crew.some((r) => r.id === 'conductor')) setRole('conductor');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crew]);

  const roleObj = crew.find((r) => r.id === role);
  const visibleChannels = channels.filter((c) => !c.archived);

  const onRole = (r: string) => {
    setRole(r);
    const roleObj = crew.find((x) => x.id === r);
    const rc = roleObj?.channel;
    if (!channelId && rc && channels.some((c) => c.id === rc)) setChannel(rc);
    // Preselect the role's harness, model and effort defaults.
    if (roleObj && harnesses) {
      const h = roleObj.harness && harnesses.some((x) => x.id === roleObj.harness) ? roleObj.harness : 'claude-code';
      const info = harnesses.find((x) => x.id === h);
      const model = roleObj.model || info?.models.find((m) => m.default)?.id || info?.models[0]?.id || '';
      setChoice({ harness: h, model });
      setEffort(roleObj.effort || '');
    }
  };
  const onChannel = (c: string) => {
    setChannel(c);
    if (c === 'conductor' && !role && crew.some((r) => r.id === 'conductor')) setRole('conductor');
    if (c !== 'conductor' && role === 'conductor') setRole('');
  };

  const update = (v: string) => {
    setText(v);
    drafts.set(key, v);
  };

  // ----- the `/` menu: the harness in the picker, for the folder a thread in this channel reads its commands from -----
  const commands = useCommands(`harness=${encodeURIComponent(choice.harness)}&channel=${encodeURIComponent(channel)}`);
  const slashMenu = useSlashMenu({ ref, text, onText: update, commands, where: 'new-thread' });
  const hint = useMemo(() => newThreadHint(text, commands.list, choice.harness), [text, commands.list, choice.harness]);
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
        { channel, prompt, role: role || undefined, harness: choice.harness, model: choice.model || undefined, effort: effort || undefined },
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
    sub: KIND[c.kind] ?? c.kind,
    avatar: c.name,
    icon: c.id === 'conductor' ? 'target' : undefined,
  }));
  if (!visibleChannels.some((c) => c.id === channel)) channelOptions.push({ value: channel, label: channel, avatar: channel });
  const roleOptions: PickerOption<string>[] = [
    { value: '', label: 'No role', sub: 'No charter', avatar: false, icon: 'x' },
    ...crew.map((r) => ({ value: r.id, label: r.name, sub: r.description, avatar: r.name, lead: isCrewRole(r.id) ? <CrewMark role={r.id} size={13} /> : undefined })),
  ];
  return (
    <div className={shell(big ? 'rounded-[30px] bg-surface' : 'rounded-[26px] bg-surface', att.over)} {...att.dropZone}>
      <DropHint over={att.over} />
      {/* Near the top of the page, so it opens downward. */}
      {slashMenu.menu && <SlashMenu {...slashMenu.menu} below />}
      <AttachmentStrip files={att.files} onRemove={att.remove} />
      <textarea
        ref={ref}
        value={text}
        {...slashMenu.textarea}
        onPaste={att.onPaste}
        onKeyDown={(e) => {
          if (slashMenu.onKey(e)) return;
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void submit();
          }
        }}
        rows={big ? 3 : 2}
        placeholder={placeholder ?? (channel === 'conductor' ? 'Ask the Conductor anything. It delegates to the crew.' : 'Describe the task')}
        className={`block max-h-[220px] w-full resize-none bg-transparent px-4 pt-3 pb-1 leading-[1.5] outline-none placeholder:text-fg-4 ${big ? 'min-h-[96px] text-[16px]' : 'min-h-[60px] text-[14.5px]'}`}
      />
      <div className="flex flex-wrap items-center gap-1.5 px-2 pt-1.5 pb-2">
        {!channelId && <Picker label="Channel" value={channel} options={channelOptions} onChange={onChannel} />}
        <Picker label="Role" value={role} options={roleOptions} onChange={onRole} />
        {harnesses && (
          <ModelPicker
            harnesses={harnesses}
            onOpen={reloadHarnesses}
            defaultOpen={preset?.pickModel}
            value={choice}
            onChange={(c) => {
              setChoice(c);
              setEffort(''); // changing the model resets effort to the default
            }}
          />
        )}
        {harnesses && (() => {
          const m = harnesses.find((h) => h.id === choice.harness)?.models.find((x) => x.id === choice.model);
          const efforts = m?.efforts ?? [];
          if (!efforts.length) {
            return <Picker label="Effort" value="" options={[{ value: '', label: 'Auto effort', avatar: false, icon: 'sliders' }]} onChange={() => {}} disabled />;
          }
          const effortOptions: PickerOption<string>[] = [
            { value: '', label: m?.defaultEffort ? `Default (${m.defaultEffort})` : 'Default', avatar: false, icon: 'sliders' },
            ...efforts.map((e) => ({ value: e, label: e, avatar: false as const, icon: 'sliders' as const })),
          ];
          return <Picker label="Effort" value={effort} options={effortOptions} onChange={setEffort} />;
        })()}
        <AttachButton onPick={att.add} disabled={busy} />
        <div className="ml-auto flex items-center gap-2.5">
          <Hint />
          <SendButton armed={!!text.trim()} busy={busy} onClick={submit}>
            Start
          </SendButton>
        </div>
      </div>
      {/* Mounted before it says anything, so a screen reader reads each hint as it appears. */}
      <div aria-live="polite">{hint && !slashMenu.open && <div className="px-4 pb-2.5 text-[12px] text-fg-3">{hint}</div>}</div>
      {roleObj?.description && <div className="px-4 pb-2.5 text-[12px] text-fg-3">{roleObj.description}</div>}
      {(att.error || error) && <ErrorNote className="mx-2 mb-2">{att.error ?? error}</ErrorNote>}
    </div>
  );
}

const SEND_OPTIONS: { mode: SendMode; label: string; hint: string; icon: IconName; keys?: string[] }[] = [
  { mode: 'steer', label: 'Steer now', hint: 'The agent reads it at its next step', icon: 'send', keys: [MOD, 'Enter'] },
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

/** Follow-up composer pinned under a thread. On a busy thread it steers by default. */
export function ReplyComposer({
  thread,
  canSteer = true,
  onSent,
  onRenamed,
  extra,
}: {
  thread: Thread;
  /** When false (e.g. Cursor), a busy thread offers only Queue and Interrupt; Cmd+Enter queues. */
  canSteer?: boolean;
  onSent?: (t: Thread, mode?: SendMode) => void;
  /** The thread after `/rename`. */
  onRenamed?: (t: Thread) => void;
  extra?: ReactNode;
}) {
  const { id: threadId, status } = thread;
  const key = `reply:${threadId}`;
  const [text, setText] = useState(() => drafts.get(key) ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const att = useAttachments();
  useAutosize(ref, text, 240);

  useEffect(() => {
    setText(drafts.get(key) ?? '');
    setError(null);
    att.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const busyThread = status === 'running' || status === 'queued';
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

  // `mode` only matters while a turn is in progress; an idle thread just starts the next turn.
  const submit = async (mode?: SendMode) => {
    const raw = text;
    const prompt = raw.trim();
    if (!prompt || busy) return;
    setBusy(true);
    setError(null);
    try {
      const t = await api.send<Thread>(`/threads/${encodeURIComponent(threadId)}/messages`, mode ? { prompt, mode } : { prompt }, att.files);
      // Keep anything typed while the send was in flight.
      if (drafts.get(key) === raw) drafts.delete(key);
      if (latest.current === raw) setText('');
      att.clear();
      onSent?.(t, mode);
    } catch (e) {
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
        onRenamed?.(t);
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const otherModelThread = () => {
    sent(text);
    openNewThread(otherModel(thread));
  };

  return (
    <div className={shell('rounded-[26px] bg-surface', att.over)} {...att.dropZone}>
      <DropHint over={att.over} />
      {slashMenu.menu && <SlashMenu {...slashMenu.menu} />}
      <AttachmentStrip files={att.files} onRemove={att.remove} />
      <textarea
        ref={ref}
        data-reply-composer
        value={text}
        {...slashMenu.textarea}
        onPaste={att.onPaste}
        onKeyDown={(e) => {
          if (slashMenu.onKey(e)) return;
          if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey) || e.nativeEvent.isComposing) return;
          e.preventDefault();
          if (omni) return void runOmni();
          const busyMode: SendMode = e.shiftKey ? 'interrupt' : canSteer ? 'steer' : 'queue';
          void submit(busyThread ? busyMode : undefined);
        }}
        rows={1}
        placeholder={busyThread ? 'Steer the agent. It reads this at its next step.' : 'Reply'}
        className="block max-h-[220px] min-h-[60px] w-full resize-none bg-transparent px-4 pt-3 pb-1 text-[14.5px] leading-[1.5] outline-none placeholder:text-fg-4"
      />
      <div className="flex flex-wrap items-center gap-1.5 px-2 pt-1.5 pb-2">
        {extra}
        <AttachButton onPick={att.add} disabled={busy} />
        <div className="ml-auto flex items-center gap-2.5">
          <Hint />
          {omni ? (
            <SendButton armed={slash.armed} busy={busy} onClick={() => void runOmni()}>
              {slash.label ?? 'Send'}
            </SendButton>
          ) : busyThread ? (
            <SteerButton disabled={!text.trim()} busy={busy} canSteer={canSteer} onSend={sendVia} />
          ) : (
            <SendButton armed={!!text.trim()} busy={busy} onClick={() => void submit()}>
              Send
            </SendButton>
          )}
        </div>
      </div>
      {/* Mounted before it says anything, so a screen reader reads each hint as it appears. */}
      <div aria-live="polite">
        {slash.hint && !slashMenu.open && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 pb-2.5 text-[12px] text-fg-3">
            <span>{slash.hint}</span>
            {slash.action.kind === 'fixed' && (
              <button type="button" onClick={otherModelThread} className="font-medium text-fg-2 underline-offset-2 hover:text-fg hover:underline">
                New thread on another model
              </button>
            )}
          </div>
        )}
      </div>
      {(att.error || error) && <ErrorNote className="mx-2 mb-2">{att.error ?? error}</ErrorNote>}
    </div>
  );
}
