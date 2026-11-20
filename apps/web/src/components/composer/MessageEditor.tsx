import { useEffect, useImperativeHandle, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent, type Ref } from 'react';
import { createTokenInputController, TokenInput, TokenInputEditor, TokenInputToken, type Token, type TokenInputValue } from '@ui-sdk/react/token-input';
import {
  TriggerMenu,
  TriggerMenuContent,
  TriggerMenuGroup,
  TriggerMenuGroupLabel,
  TriggerMenuItem,
  TriggerMenuList,
  TriggerMenuStatus,
  createTriggerMenuController,
  type TriggerDefinition,
  type TriggerMenuDataItem,
  type TriggerMenuSelectDetails,
} from '@ui-sdk/react/trigger-menu';
import type { FileMention } from '@omni/shared/mention-menu.ts';
import { roleRows, type AskRole } from '@omni/shared/ask.ts';
import { mentionSections, menuSections, SOURCE_TAG, type MenuSection } from '@omni/shared/slash-menu.ts';
import { menuCommands } from '@omni/shared/composer-slash.ts';
import { machineMention, mentionBody, mentionsMachine } from '@omni/shared/message-context-machine.ts';
import { newContext, type MessageContext } from '@omni/shared/message-context.ts';
import type { SlashCommand } from '@omni/shared/slash.ts';
import { api, type CommandList } from '../../api.ts';
import { useTechnical } from '../../display.ts';
import { addDraftContext, draftContext, removeDraftContext } from '../../message-context/draft.ts';
import { reachLine } from '../../message-context/machine-mention.tsx';
import { editorText, editorValue, MACHINE_TOKEN, machineToken, reconcileMachines, tokenCodec } from '../../message-context/machine-tokens.ts';
import { Icon, Loader, StatusDot } from '../ui.tsx';
import { KbdFooter, MENU_SURFACE, overlayRow } from '../ui/overlay.tsx';

/** The `@` menu's scope in a new-thread composer: its channel, and the agent it starts as, which decides the machines. */
export const newThreadScope = (channel: string, role?: string) => `channel=${encodeURIComponent(channel)}${role ? `&role=${encodeURIComponent(role)}` : ''}`;

/** What a composer does with its editor beyond the text it hands in. */
export interface MessageEditorHandle {
  focus: (at?: 'start' | 'end') => void;
  /** Types `text` at the caret as one undo step, like Cmd+Enter's newline. */
  insert: (text: string) => void;
  element: () => HTMLElement | null;
}

const AT = '@';
const SLASH = '/';
const MACHINE_DOT = { online: 'done', offline: 'settled', unknown: 'idle' } as const;
const rowKey = (r: FileMention) => `${r.kind}:${r.insert}`;
// The menus' own grammar (packages/shared/mention-menu.ts, slash-menu.ts): paths after `@`, command names after `/`.
const PATH = /[A-Za-z0-9._\-/]/;
const COMMAND = /[A-Za-z0-9._:-]/;
// Offsets in a match count a chip as one character.
const plainOf = (value: TokenInputValue) => value.map((p) => (typeof p === 'string' ? p : '￼')).join('');

export interface MessageEditorProps {
  /** The composer's text, `@<name>` for each machine chip. A change that did not come from typing here rebuilds the box. */
  text: string;
  onText: (text: string) => void;
  /** The draft (message-context/draft.ts) whose machine_mention records the chips keep. */
  draft: string;
  records: readonly MessageContext[];
  /** The `@` menu's scope: `thread=<id>`, or newThreadScope's `channel=<id>[&role=<id>]`. */
  mentions: string;
  /** The agents a message can start by asking (packages/shared/ask.ts), listed first while the `@` starts the message. */
  roles?: readonly AskRole[];
  /** The `/` menu's commands. Without them `/` is plain text, as in the phone composers. */
  commands?: { list: CommandList | null; load: () => void | Promise<void>; where: 'reply' | 'new-thread' };
  /** Opens the menus below the box, for a composer near the top of the page. */
  below?: boolean;
  /** What the menus line up with: the composer's frame. */
  anchor?: HTMLElement | null;
  onError?: (why: string) => void;
  onMenuOpen?: (open: boolean) => void;
  /** The composer's own keys. A key an open menu takes never reaches it. */
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void;
  onPaste?: (e: ClipboardEvent<HTMLDivElement>) => void;
  placeholder: string;
  label: string;
  className?: string;
  autoFocus?: boolean;
  enterKeyHint?: 'send';
  /** The thread's reply box, which focus requests and the Esc interrupt look for. */
  reply?: boolean;
  handle?: Ref<MessageEditorHandle>;
}

/**
 * A composer's text box: ui-sdk's Token Input, where a machine picked from the `@` menu is one chip, and its Trigger
 * Menu for the `@` (files, agents, machines) and `/` (commands) menus. Focus stays in the box while the arrow keys move
 * through a menu; Enter or Tab picks, Esc closes it.
 */
export function MessageEditor(props: MessageEditorProps) {
  const { text, onText, draft, records, mentions, roles, commands, below, anchor, onError, onMenuOpen } = props;
  const technical = useTechnical();
  const controller = useMemo(() => createTokenInputController(), []);
  const box = useRef<HTMLDivElement>(null);
  useImperativeHandle(props.handle, () => ({ focus: (at = 'end') => controller.focus({ at }), insert: (t) => void controller.insert(t), element: () => box.current }), [controller]);

  const [value, setValue] = useState(() => editorValue(text, records));
  // The text the box last showed: a different one came from outside (a template, a failed send coming back).
  const [shown, setShown] = useState(text);
  if (text !== shown) {
    setShown(text);
    setValue(editorValue(text, records));
  }

  const onValueChange = (next: TokenInputValue) => {
    const t = editorText(next);
    setValue(next);
    setShown(t);
    const fix = reconcileMachines(next, draftContext(draft));
    for (const id of fix.remove) removeDraftContext(draft, id);
    for (const m of fix.add) {
      const why = addDraftContext(draft, newContext(machineMention, mentionBody(m, new Date()), ''));
      if (why) onError?.(why);
    }
    onText(t);
  };

  // ----- the open menu -----
  const [match, setMatch] = useState<{ trigger: string; query: string } | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    onMenuOpen?.(open);
  }, [open, onMenuOpen]);
  const menu = useMemo(() => createTriggerMenuController(), []);
  const startsMessage = () => {
    const m = menu.getMatch();
    return !!m && !plainOf(value).slice(0, m.start).trim();
  };

  // `@`: the rows with the search they answer, so a slower reply for an older search never shows.
  const atQuery = match?.trigger === AT ? match.query : null;
  const [got, setGot] = useState<{ key: string; rows: FileMention[] } | null>(null);
  const atKey = atQuery === null ? null : `${mentions}\0${atQuery}`;
  useEffect(() => {
    if (atQuery === null) return;
    const key = `${mentions}\0${atQuery}`;
    let stale = false;
    const t = setTimeout(
      () => {
        api
          .get<FileMention[]>(`/mentions?${mentions}&q=${encodeURIComponent(atQuery)}`)
          .then((rows) => !stale && setGot({ key, rows }))
          .catch(() => !stale && setGot({ key, rows: [] }));
      },
      got ? 90 : 0,
    );
    return () => {
      stale = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mentions, atQuery]);
  // Until the search for the new text answers, the last rows stay, so typing doesn't flicker the menu.
  const files = got?.rows ?? [];
  const asks: FileMention[] =
    atQuery !== null && roles?.length && startsMessage()
      ? roleRows(roles, atQuery).map((r) => ({ insert: r.id, name: r.name, detail: r.remote ? 'Ask a remote agent' : 'Ask an agent', kind: 'role', remote: r.remote }))
      : [];
  const rows = asks.length ? [...asks, ...files] : files;
  const rowsLoading = atKey !== null && got?.key !== atKey && !got;

  // `/`: a fresh list each time the menu opens, or gets another list while open. The server only probes a list older
  // than 30 seconds.
  const slashQuery = match?.trigger === SLASH ? match.query : null;
  const load = commands?.load;
  const loaded = useRef<typeof load | null>(null);
  useEffect(() => {
    const on = open && slashQuery !== null;
    if (on && load && loaded.current !== load) void load();
    loaded.current = on ? load : null;
  }, [open, slashQuery, load]);
  const list = commands?.list ?? null;
  const sections: MenuSection[] = useMemo(() => {
    if (slashQuery === null || !commands) return [];
    const all = menuCommands(list?.commands, commands.where);
    return (startsMessage() ? menuSections : mentionSections)(all, slashQuery, list?.recent);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slashQuery, list, commands?.where, value]);
  const slashLoading = !list || list.status === 'loading';

  const byKey = useRef(new Map<string, FileMention>());
  byKey.current = new Map(rows.map((r) => [rowKey(r), r]));

  const triggers: TriggerDefinition[] = [
    {
      char: AT,
      pattern: PATH,
      maxLength: 200,
      filter: false,
      type: MACHINE_TOKEN,
      insert: (item: TriggerMenuDataItem) => {
        const r = byKey.current.get(String(item.value));
        if (r?.kind === 'machine' && r.machine) return machineToken({ id: r.machine.id, name: r.name, reachability: r.machine.reachability, lastSeen: r.machine.lastSeen });
        return `@${r?.insert ?? item.label} `;
      },
    },
    ...(commands ? [{ char: SLASH, pattern: COMMAND, filter: false as const, insert: (item: TriggerMenuDataItem) => `/${String(item.value)} ` }] : []),
  ];

  /** A machine goes on the message as a record before its chip goes in; when it can't, the name stays plain text. */
  const onSelect = (picked: unknown, details: TriggerMenuSelectDetails<unknown>) => {
    if (details.trigger !== AT) return;
    const r = byKey.current.get(String(picked));
    const m = r?.kind === 'machine' ? r.machine : undefined;
    if (!r || !m || mentionsMachine(draftContext(draft), m.id)) return;
    const why = addDraftContext(draft, newContext(machineMention, mentionBody({ id: m.id, name: r.name, reachability: m.reachability, lastSeen: m.lastSeen }, new Date()), ''));
    if (!why) return;
    onError?.(why);
    details.insert(`@${r.insert} `);
  };

  // Loading until the rows for the match are in, so a bare `@` or `/` opens the menu before its first search answers.
  const status = !match || (match.trigger === AT ? rowsLoading : slashLoading) ? 'loading' : 'idle';
  const { onKeyDown, onPaste } = props;

  return (
    <TokenInput
      value={value}
      onValueChange={onValueChange}
      controller={controller}
      codec={tokenCodec}
      copy="label"
      tokenDeletion="whole"
      getTokenDescription={(t) => (t.type === MACHINE_TOKEN ? 'machine' : t.type)}
      renderToken={(t) => <MachineChip token={t} />}
    >
      <TokenInputEditor
        ref={box}
        aria-label={props.label}
        placeholder={props.placeholder}
        autoFocus={props.autoFocus}
        enterKeyHint={props.enterKeyHint}
        data-reply-composer={props.reply || undefined}
        data-menu-open={open || undefined}
        spellCheck
        onKeyDown={(e) => {
          // The menu takes its keys on the element itself, before React's handlers run: a key it used is prevented.
          if (!e.defaultPrevented && !menu.isOpen()) onKeyDown?.(e);
        }}
        onFocus={() => void load?.()}
        onPaste={onPaste}
        className={`message-editor ${props.className ?? ''}`}
      />
      <TriggerMenu
        triggers={triggers}
        controller={menu}
        status={status}
        onSelect={onSelect}
        onOpenChange={(next, details) => {
          setOpen(next);
          setMatch(next && details.trigger ? { trigger: details.trigger, query: menu.getQuery() } : null);
        }}
        onQueryChange={(query, details) => setMatch({ trigger: details.trigger, query })}
      >
        <TriggerMenuStatus className="sr-only" />
        <TriggerMenuContent
          anchor={anchor ?? undefined}
          side={below ? 'bottom' : 'top'}
          align="start"
          sideOffset={8}
          collisionPadding={8}
          className={`fade-in z-20 flex w-(--anchor-width) flex-col overflow-hidden ${MENU_SURFACE} ${match?.trigger === SLASH ? 'max-h-[min(26rem,50vh)]' : 'max-h-[min(22rem,45vh)]'}`}
        >
          {match?.trigger === SLASH ? (
            <SlashRows list={list} sections={sections} loading={slashLoading} technical={technical} />
          ) : (
            <MentionRows rows={rows} loading={rowsLoading} />
          )}
        </TriggerMenuContent>
      </TriggerMenu>
    </TokenInput>
  );
}

/** A machine inline: the monitor icon and its name, deleted, crossed and copied as one piece. */
function MachineChip({ token }: { token: Token }) {
  const reach = token.data?.reachability;
  const seen = token.data?.lastSeen;
  const title = reach === 'online' || reach === 'offline' || reach === 'unknown' ? `${token.label}: ${reachLine(reach, typeof seen === 'string' ? seen : null)}` : token.label;
  return (
    <TokenInputToken className="mention-pill" title={title}>
      <Icon name="monitor" size={12} strokeWidth={2} className="mention-icon" />
      {token.label}
    </TokenInputToken>
  );
}

function MentionRows({ rows, loading }: { rows: FileMention[]; loading: boolean }) {
  return (
    <TriggerMenuList aria-label={rows.some((r) => r.kind === 'role') ? (rows.some((r) => r.kind === 'machine') ? 'Agents, machines and files' : 'Files and agents') : rows.some((r) => r.kind === 'machine') ? 'Machines and files' : 'Files'} className="scroll-thin min-h-0 flex-1 overflow-y-auto p-1.5">
      {loading && !rows.length && (
        <div className="flex items-center gap-2 px-3 py-2.5 text-[12.5px] text-fg-3">
          <Loader size={13} /> Looking
        </div>
      )}
      {rows.map((r) => (
        <TriggerMenuItem key={rowKey(r)} value={rowKey(r)} label={r.name} keywords={[r.insert]} className="flex min-h-10 cursor-pointer items-center gap-2.5 rounded-2xl px-3 py-1.5 data-highlighted:bg-[var(--wash)]">
          <Icon name={r.kind === 'role' ? 'message' : r.kind === 'machine' ? 'monitor' : 'file'} size={14} className="shrink-0 text-fg-3" />
          <span className="flex min-w-0 flex-1 items-baseline gap-2">
            <span className="shrink-0 text-[13px] font-medium text-fg">{r.name}</span>
            <span className="truncate text-[11.5px] text-fg-3">{r.machine && !r.machine.here ? reachLine(r.machine.reachability, r.machine.lastSeen) : r.detail}</span>
          </span>
          {r.kind === 'artifact' && <span className="shrink-0 rounded-full bg-surface-2 px-2 py-px text-[11px] text-fg-3">artifact</span>}
          {r.remote && <span className="shrink-0 rounded-full px-2 py-px text-[11px] text-fg-3 shadow-[inset_0_0_0_1px_var(--line-strong)]">Remote</span>}
          {r.machine && <StatusDot status={MACHINE_DOT[r.machine.reachability]} size={7} className="shrink-0" />}
        </TriggerMenuItem>
      ))}
    </TriggerMenuList>
  );
}

function SlashRows({ list, sections, loading, technical }: { list: CommandList | null; sections: MenuSection[]; loading: boolean; technical: boolean }) {
  const empty = !sections.some((s) => s.commands.length);
  return (
    <>
      <TriggerMenuList aria-label="Commands" className="scroll-thin min-h-0 flex-1 overflow-y-auto p-1.5">
        {/* A thread's menu lists Omni's own commands either way, so say why the harness's are missing. */}
        {list?.status === 'unavailable' && (
          <div className="px-3 py-2.5 text-[12.5px] text-fg-3">
            Couldn't read the commands.
            {list.fix && (
              <>
                {' '}
                Run <code className="rounded bg-surface-2 px-1 font-mono text-[12px] text-fg-2">{list.fix}</code> in a terminal to see why.
              </>
            )}
          </div>
        )}
        {loading && empty && (
          <div className="flex items-center gap-2 px-3 py-2.5 text-[12.5px] text-fg-3">
            <Loader size={13} /> Loading commands
          </div>
        )}
        {sections.map((s) => (
          <TriggerMenuGroup key={s.label ?? 'matches'}>
            {s.label ? <TriggerMenuGroupLabel className="caption px-3 pt-2 pb-1">{s.label}</TriggerMenuGroupLabel> : <TriggerMenuGroupLabel className="sr-only">Matches</TriggerMenuGroupLabel>}
            {s.commands.map((c) => (
              <CommandRow key={c.name} c={c} technical={technical} />
            ))}
          </TriggerMenuGroup>
        ))}
      </TriggerMenuList>
      <KbdFooter
        hints={[
          [['↑', '↓'], 'move'],
          [['↵'], 'pick'],
          [['esc'], 'close'],
        ]}
      />
    </>
  );
}

function CommandRow({ c, technical }: { c: SlashCommand; technical: boolean }) {
  return (
    <TriggerMenuItem value={c.name} label={c.name} className={`${overlayRow('lg')} cursor-pointer py-1.5`}>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="shrink-0 font-mono text-[13px] font-medium text-fg">/{c.name}</span>
          {c.argumentHint && <span className="truncate font-mono text-[12px] text-fg-3">{c.argumentHint}</span>}
        </span>
        {c.description && <span className="block truncate text-[12px] text-fg-3">{c.description}</span>}
      </span>
      {/* Where a command comes from (project, plugin, mcp) is for whoever writes them: Show technical details. */}
      {technical && <span className="shrink-0 rounded-full bg-surface-2 px-2 py-px text-[11px] text-fg-3">{SOURCE_TAG[c.source]}</span>}
    </TriggerMenuItem>
  );
}
