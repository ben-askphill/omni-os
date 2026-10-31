import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type FocusEvent as ReactFocusEvent, type KeyboardEvent as ReactKeyboardEvent, type RefObject, type SyntheticEvent } from 'react';
import { optionId, useCommands } from '../SlashMenu.tsx';
import { useFileMenu } from '../FileMenu.tsx';
import { mentionSections, menuSections, pickCommand, rowKey, slashQuery } from '@omni/shared/slash-menu.ts';
import { menuCommands, newThreadHint } from '@omni/shared/composer-slash.ts';
import { parseSlash } from '@omni/shared/slash.ts';
import { asksAuto } from '../../thread-run.ts';
import type { DraftRun } from '../../new-thread-preset.ts';
import { type SlashCommand } from '@omni/shared/slash.ts';


/**
 * The `/` menu over a composer's textarea: whether it is open, what it lists, and the keys and
 * textarea props that drive it. A thread's reply box adds Omni's own commands at the start of a message.
 */
export function useSlashMenu({
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
export function joinMenus(slash: ReturnType<typeof useSlashMenu>, files: ReturnType<typeof useFileMenu>) {
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

/** The new-thread composer's menus: the `/` commands of the harness in its picker, for the channel it will run in, and the hint under the box. */
export function useNewThreadMenus({
  ref,
  text,
  onText,
  choice,
  channel,
}: {
  ref: RefObject<HTMLTextAreaElement | null>;
  text: string;
  onText: (text: string) => void;
  choice: DraftRun['choice'];
  channel: string;
}) {
  // Auto picks the harness only once the prompt is sent, so its menu is Claude Code's.
  const auto = asksAuto(choice);
  const menuHarness = auto ? 'claude-code' : choice.harness;
  const commands = useCommands(`harness=${encodeURIComponent(menuHarness)}&channel=${encodeURIComponent(channel)}`);
  const slashMenu = useSlashMenu({ ref, text, onText, commands, where: 'new-thread' });
  const fileMenu = useFileMenu({ ref, text, onText, scope: `channel=${encodeURIComponent(channel)}` });
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
  return { slashMenu, fileMenu, menus, hint };
}
