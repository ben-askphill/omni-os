// PROTOTYPE, throwaway: pieces the screens share. Markup copied from the real thread page (Thread.tsx, ThreadHeader,
// Transcript's UserBubble, the reply composer, the quick card and the phone's MoHeader and MoComposer) so the variants
// sit in Omni's own look. Nothing here is wired to the server.
import { Fragment, useLayoutEffect, useRef, type ReactNode } from 'react';
import { AVATAR_SWATCHES, avatarInk } from '@omni/shared/avatar-color.ts';
import { monogram } from '@omni/shared/monogram.ts';
import { HarnessLogo, StaticMark } from '../../components/brand.tsx';
import { Markdown } from '../../components/Markdown.tsx';
import { Avatar, Icon, IconButton, StatusDot, StatusPill, type IconName } from '../../components/ui.tsx';
import type { Mark } from '@omni/shared/status.ts';
import { COMPOSER_CLEARS_CARD, QUICK_CARD_SLOT, THREAD_COLUMN } from '../../components/thread/quick-card-layout.ts';
import { CAPTION, CARD_PAD, DIVIDER, ROW } from '../../components/thread/panel/inset.ts';
import { MoHeader, MoRound, bottomInset } from '../../mobile/parts.tsx';
import { useTechnical } from '../../display.ts';
import { AGENTS, type Agent, type AgentId, type Msg } from './data.ts';

// ---------- the agent's face ----------

const swatchOf = (id: string) => AVATAR_SWATCHES[[...id].reduce((n, c) => n + c.charCodeAt(0), 0) % 6];

/**
 * An agent's avatar: the image Ben uploaded or the server offered, else a colored disc with its initials, the color
 * taken from its id. `ring`: it is running (the agent family's blue, as the Working mark). `needs`: it waits on Ben.
 */
export function AgentAvatar({ a, size = 24, ring, needs, className = '' }: { a: Agent; size?: number; ring?: boolean; needs?: boolean; className?: string }) {
  const edge = ring || needs ? { boxShadow: `0 0 0 ${size > 20 ? 2 : 1.5}px var(--bg), 0 0 0 ${size > 20 ? 3.5 : 3}px ${needs ? 'var(--needs)' : 'var(--live)'}` } : {};
  if (a.avatar) return <img src={a.avatar} alt="" draggable={false} className={`shrink-0 rounded-full object-cover ${className}`} style={{ width: size, height: size, ...edge }} />;
  if (a.id === 'conductor')
    return (
      <span aria-hidden className={`inline-grid shrink-0 place-items-center rounded-full bg-surface-2 text-fg ${className}`} style={{ width: size, height: size, ...edge }}>
        <StaticMark size={size * 0.56} title="" />
      </span>
    );
  const bg = swatchOf(a.id);
  return (
    <span
      aria-hidden
      className={`inline-grid shrink-0 place-items-center rounded-full font-rounded font-medium leading-none ${className}`}
      style={{ width: size, height: size, fontSize: size < 18 ? size * 0.55 : size * 0.4, backgroundColor: bg, color: avatarInk(bg), ...edge }}
    >
      {/* Two letters stop reading below 18px: one letter there. */}
      {size < 18 ? monogram(a.name)[0] : monogram(a.name)}
    </span>
  );
}

/** Overlapping avatars, newest on top, then +N. */
export function Facepile({ ids, size = 20, max = 3, ring = [], count = true, className = '' }: { ids: AgentId[]; size?: number; max?: number; ring?: AgentId[]; count?: boolean; className?: string }) {
  const shown = ids.slice(0, max);
  const more = ids.length - shown.length;
  return (
    <span className={`inline-flex items-center ${className}`}>
      {shown.map((id, i) => (
        <span key={id} className="rounded-full" style={{ marginLeft: i ? -size * 0.3 : 0, boxShadow: '0 0 0 1.5px var(--bg)', zIndex: shown.length - i }}>
          <AgentAvatar a={AGENTS[id]} size={size} ring={ring.includes(id)} />
        </span>
      ))}
      {count && more > 0 && (
        <span className="ml-1 font-num text-[11px] text-fg-3 tabular-nums" style={{ marginLeft: 4 }}>
          +{more}
        </span>
      )}
    </span>
  );
}

/** Harness and model, only with Show technical details on (ADR 0019). */
export function TechLine({ a, className = '' }: { a: Agent; className?: string }) {
  const technical = useTechnical();
  if (!technical) return null;
  return (
    <span className={`inline-flex min-w-0 items-center gap-1 text-fg-3 ${className}`} title={`${a.harnessName} · ${a.model}`}>
      <HarnessLogo harness={a.harness} size={11} />
      <span className="truncate">
        {a.harnessName} · {a.model}
      </span>
    </span>
  );
}

/** "Remote", on a remote agent's name where it helps. */
export function RemoteTag({ className = '' }: { className?: string }) {
  return <span className={`inline-flex h-[18px] shrink-0 items-center rounded-full px-1.5 text-[10.5px] font-medium text-fg-3 shadow-[inset_0_0_0_1px_var(--line-strong)] ${className}`}>Remote</span>;
}

/** An agent mention as a pill in a message: the agent's face and name, never a text `@`. */
export function MentionPill({ id, fresh }: { id: AgentId; fresh?: boolean }) {
  const a = AGENTS[id];
  return (
    <span className="mention-pill" title={fresh ? `${a.name} joins this thread` : a.name}>
      <AgentAvatar a={a} size={14} />
      {a.name}
      {fresh && <Icon name="plus" size={10} strokeWidth={2.4} />}
    </span>
  );
}

/** Message text with its agent mentions drawn as pills. */
export function WithMentions({ text, fresh = [] }: { text: string; fresh?: AgentId[] }) {
  const parts = text.split(/(@[A-Z][a-z]+)/g);
  return (
    <>
      {parts.map((p, i) => {
        const id = p.startsWith('@') ? (p.slice(1).toLowerCase() as AgentId) : null;
        return id && AGENTS[id] ? <MentionPill key={i} id={id} fresh={fresh.includes(id)} /> : <Fragment key={i}>{p}</Fragment>;
      })}
    </>
  );
}

// ---------- transcript rows ----------

/** Ben's message, as the transcript draws it today (Transcript.tsx UserBubble). */
export function BenBubble({ m, phone, fresh }: { m: Msg; phone?: boolean; fresh?: AgentId[] }) {
  return (
    <div className="group/msg flex flex-col items-end">
      <div className="mb-1 flex flex-wrap items-center justify-end gap-x-2 text-[11.5px] text-fg-3">
        <span className="font-num text-[11px] text-fg-3">{m.at}</span>
      </div>
      <div
        className={
          phone
            ? 'max-w-[86%] rounded-[20px] bg-bubble px-3.5 py-2.5 text-[15px] leading-[1.45] break-words whitespace-pre-wrap text-pretty'
            : 'max-w-[92%] rounded-[22px] rounded-tr-lg bg-bubble px-4 py-2.5 text-[14.5px] leading-[1.55] break-words whitespace-pre-wrap @lg:max-w-[80%]'
        }
      >
        <WithMentions text={m.text} fresh={fresh} />
      </div>
    </div>
  );
}

/** A turn's steps, folded, as StepsCard shows a finished turn. */
export function StepsFold({ text }: { text: string }) {
  return (
    <button type="button" className="hov -mx-2 flex max-w-full min-w-0 items-center gap-2 rounded-xl px-2 py-1 text-left text-[12.5px] text-fg-3">
      <Icon name="chevronRight" size={11} className="shrink-0" />
      <span className="truncate">{text}</span>
    </button>
  );
}

/** The row under a running turn (ThinkingLine), with a fixed time so screenshots hold still. */
export function Thinking({ label, time = '0:42', className = 'text-[12.5px]' }: { label: string; time?: string; className?: string }) {
  return (
    <div className={`flex items-center gap-2 text-fg-3 ${className}`} role="status">
      <span className="grid w-4 shrink-0 place-items-center">
        <StatusDot mark="working" size={8} />
      </span>
      <span className="shimmer-text min-w-0 truncate">{label}</span>
      <span className="shrink-0 tabular-nums">{time}</span>
    </div>
  );
}

export function Prose({ text }: { text: string }) {
  return <Markdown text={text} />;
}

/** A quiet divider line in the transcript, as SwitchLine draws a run switch. */
export function DividerLine({ children }: { children: ReactNode }) {
  return (
    <div className="py-1 text-center text-[12px] font-medium text-fg-3">
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-line" />
        <span className="inline-flex min-w-0 items-center gap-1.5 break-words text-fg-3">{children}</span>
        <div className="h-px flex-1 bg-line" />
      </div>
    </div>
  );
}

// ---------- the desktop thread page ----------

/** A thread opens on its newest messages, as the real transcript does. */
function useAtBottom() {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  });
  return ref;
}

/** The thread page's header (ThreadHeader): channel avatar, crumbs, title, then the header actions. */
export function ThreadHead({ channel, title, crumbs, right, status = 'working' }: { channel: { name: string; bg?: string }; title: string; crumbs?: ReactNode; right?: ReactNode; status?: Mark }) {
  return (
    <div className="@container flex shrink-0 items-center gap-3 px-3 pt-3 pb-2 md:px-6 md:pt-4">
      <span className="hidden sm:block @max-3xl:hidden">
        <Avatar name={channel.name} avatarBg={channel.bg} size={34} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1 text-[12px] text-fg-3">
          <span className="shrink-0">#{channel.name}</span>
          {crumbs}
        </div>
        <h1 className="mt-0.5 line-clamp-2 font-display text-[length:var(--fs-heading)] leading-snug text-balance">{title}</h1>
      </div>
      {right}
      <div className="flex shrink-0 items-center gap-1">
        <IconButton icon="check" label="Mark done" />
        <StatusPill mark={status} />
        <IconButton icon="search" label="Find in thread" />
        <IconButton icon="more" label="More" />
        <IconButton icon="panel" label="Panel" pressed />
      </div>
    </div>
  );
}

/** The thread page's columns (Thread.tsx): header, transcript with the quick card beside it, composer. */
export function DesktopThread({
  head,
  below,
  quick,
  composer,
  children,
}: {
  head: ReactNode;
  below?: ReactNode;
  quick?: ReactNode;
  composer: ReactNode;
  children: ReactNode;
}) {
  const scroll = useAtBottom();
  return (
    <div className="flex h-full min-h-0">
      <div className={THREAD_COLUMN}>
        {head}
        {below}
        <div className="relative flex min-h-0 flex-1">
          <div className="relative min-h-0 min-w-0 flex-1">
            <div ref={scroll} className="scroll-none h-full overflow-y-auto">
              <div className="@container mx-auto max-w-4xl px-4 pt-4 pb-10 md:px-6">
                <div className="space-y-5">{children}</div>
              </div>
            </div>
          </div>
          {quick && <div className={QUICK_CARD_SLOT}>{quick}</div>}
        </div>
        <div className={`relative shrink-0 bg-bg px-3 pt-1 pb-4 md:px-6 ${quick ? COMPOSER_CLEARS_CARD : ''}`}>
          <div className="mx-auto max-w-4xl">{composer}</div>
        </div>
      </div>
    </div>
  );
}

/** The reply composer's frame (Composer.tsx shell), with what goes in it. */
export function ComposerBox({ text, placeholder = 'Reply · / commands, @ agents and files', above, menu, hint, children }: { text?: ReactNode; placeholder?: string; above?: ReactNode; menu?: ReactNode; hint?: ReactNode; children?: ReactNode }) {
  return (
    <div className="relative">
      {menu}
      <div className="relative rounded-[20px] bg-surface shadow-[inset_0_0_0_1px_var(--line-strong),0_0_0_4px_var(--wash)]">
        {above}
        <div className="block min-h-[60px] w-full px-4 pt-3 pb-1 text-[14.5px] leading-[1.8]">
          {text ? <span className="text-fg">{text}</span> : <span className="text-fg-3">{placeholder}</span>}
          {text && <span className="ml-px inline-block h-[1.1em] w-px translate-y-[3px] bg-fg align-baseline" />}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 px-2 pt-1.5 pb-2">
          <IconButton icon="paperclip" label="Attach" size={15} />
          <IconButton icon="branch" label="Fork" size={15} />
          {children}
          <div className="ml-auto flex items-center gap-2.5">
            <button type="button" aria-label="Send" className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-full bg-fg text-on-ink">
              <Icon name="arrowUp" size={17} strokeWidth={2.2} />
            </button>
          </div>
        </div>
        {hint && <div className="px-4 pb-2.5 text-[12px] text-fg-3">{hint}</div>}
      </div>
    </div>
  );
}

/** The run pill under the composer, as ThreadRunPills draws it. */
export function RunPill({ label }: { label: string }) {
  return (
    <span className="inline-flex h-[30px] items-center gap-1.5 rounded-full bg-surface-2 pr-2.5 pl-1 text-[12.5px] text-fg-2">
      <span className="grid h-[22px] w-[22px] place-items-center rounded-full bg-bg">
        <HarnessLogo harness="claude-code" size={12} />
      </span>
      {label}
      <Icon name="chevronDown" size={12} className="text-fg-3" />
    </span>
  );
}

/** The quick card beside the transcript (ThreadQuickCard), with the rows a screen passes. */
export function QuickCard({ children }: { children: ReactNode }) {
  return <div className={`w-full rounded-[var(--r-lg)] border border-line bg-surface ${CARD_PAD} shadow-[inset_0_0_0_1px_light-dark(transparent,var(--pane-edge))]`}>{children}</div>;
}

export function QuickRow({ icon, children, chevron, className = '' }: { icon?: IconName; children: ReactNode; chevron?: boolean; className?: string }) {
  return (
    <div className={`flex w-full min-w-0 items-center gap-[var(--sp-5)] ${ROW} text-left text-[12.5px] ${className}`}>
      {icon && <Icon name={icon} size={15} className="shrink-0 text-fg-3" />}
      <span className="flex min-w-0 flex-1 items-center gap-[var(--sp-4)] text-fg">{children}</span>
      {chevron && <Icon name="chevronRight" size={13} className="shrink-0 text-fg-3" />}
    </div>
  );
}

/** The lead's harness and model row, only with Show technical details on, as the quick card has it today. */
export function TechRow({ id = 'builder' }: { id?: AgentId }) {
  const technical = useTechnical();
  if (!technical) return null;
  return (
    <QuickRow icon="info">
      <TechLine a={AGENTS[id]} />
    </QuickRow>
  );
}

export const QuickDivider = () => <div className="my-[var(--sp-2)] h-px bg-line" />;
export const QuickCaption = ({ children }: { children: ReactNode }) => <div className={`flex items-center ${CAPTION} text-[11px] text-fg-3`}>{children}</div>;
export { DIVIDER };

/** The quick card's usual top rows: machine and folder. */
export function QuickTop() {
  return (
    <>
      <QuickRow icon="monitor">omarchy</QuickRow>
      <QuickRow icon="folder">
        <span className="min-w-0 truncate font-mono text-[11.5px]">~/omni-os/data/worktrees/9a1c0e52</span>
      </QuickRow>
      <QuickDivider />
      <QuickRow icon="user">
        <span className="shrink-0 text-fg-3">Owner</span>
        <span>You</span>
      </QuickRow>
    </>
  );
}

export function QuickBottom({ status = 'Working · 2 agents', branch = 'omni/9a1c0e52' }: { status?: string; branch?: string | null }) {
  return (
    <>
      <QuickRow icon="clock">
        <span className="truncate">{status}</span>
      </QuickRow>
      <QuickRow icon="branch">
        {branch ? <span className="min-w-0 truncate font-mono text-[11.5px]">{branch}</span> : <span className="text-fg-3">No branch</span>}
      </QuickRow>
      <div className={DIVIDER}>
        <QuickRow icon="sidebar" chevron>
          <span className="font-medium">All details</span>
        </QuickRow>
      </div>
    </>
  );
}

// ---------- the phone thread screen ----------

export function PhoneThread({ title, sub, right, below, composer, children }: { title: string; sub: ReactNode; right?: ReactNode; below?: ReactNode; composer: ReactNode; children: ReactNode }) {
  const scroll = useAtBottom();
  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <MoHeader
        onBack={() => {}}
        title={title}
        sub={sub}
        right={
          right ?? (
            <>
              <MoRound icon="panel" label="Panel" />
              <MoRound icon="more" label="More" />
            </>
          )
        }
      />
      {below}
      <div ref={scroll} className="mo-scroll min-h-0 flex-1 overflow-y-auto px-4 pt-2 pb-6">
        <div className="space-y-5">{children}</div>
      </div>
      {composer}
    </div>
  );
}

export function PhoneComposer({ text, placeholder = 'Reply', above, menu, hint }: { text?: ReactNode; placeholder?: string; above?: ReactNode; menu?: ReactNode; hint?: ReactNode }) {
  return (
    <div className="relative shrink-0 bg-bg px-3 pt-1.5" style={{ paddingBottom: bottomInset(2) }}>
      {menu}
      <div className="relative flex flex-col rounded-[26px] bg-surface">
        {above}
        <div className="flex min-h-[52px] items-end gap-1.5 p-1.5">
          <MoRound icon="plus" label="Add" />
          <div className="min-w-0 flex-1 self-center px-1 py-2 text-[16px] leading-[1.35]">{text ? <span className="text-fg">{text}</span> : <span className="text-fg-3">{placeholder}</span>}</div>
          <MoRound ink icon="send" label="Send" />
        </div>
        {hint && <div className="px-4 pb-2.5 -mt-1 text-[12px] text-fg-3">{hint}</div>}
      </div>
    </div>
  );
}

/** The menu surface the composer's `@` and `/` menus use (MENU_SURFACE). */
export { MENU_SURFACE as MENU } from '../../components/ui/overlay.tsx';
