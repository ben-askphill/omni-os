// PROTOTYPE, throwaway. Screen 2: the `@` agent mention. Above: Ben's message that named Reviewer and Hermes seated
// them, and both reply in parallel. Below: Ben picks a third agent to seat (Designer), so the menu shows who sits here
// and who would join. Ben's pick: A, the one `@` menu, with B's hint line under the composer saying who gets the
// message. "Menu off" shows the message once Designer is picked. Ben's answers (2026-11-20): the hint shows only once
// an agent is named; with no `@`, the placeholder names the lead. The machine pill keeps today's blue and a device
// icon, the agent pill takes the agent's own color.
import type { ReactNode } from 'react';
import { AGENTS, CHANNELS, GROUP, THREAD, type AgentId, type Msg } from '../data.ts';
import { Messages } from '../messages.tsx';
import { AgentAvatar, ComposerBox, DesktopThread, MENU, MachinePill, MentionPill, PhoneComposer, PhoneThread, RemoteTag, RunPill, ThreadHead } from '../parts.tsx';
import { Icon, StatusDot } from '../../../components/ui.tsx';
import { useParams } from '../url-state.ts';
import type { Screen } from './types.ts';

const RUNNING: Msg[] = [
  { id: 41, author: 'reviewer', at: '12:09', text: '', running: 'Reading Builder’s diff' },
  { id: 51, author: 'hermes', at: '12:09', text: '', running: 'Searching the bridge log' },
];

function Transcript({ phone }: { phone?: boolean }) {
  return (
    <>
      <Messages list={GROUP.slice(0, 2)} phone={phone} />
      <Messages list={[GROUP[2]]} phone={phone} fresh={['reviewer', 'hermes']} />
      <Messages list={RUNNING} phone={phone} />
    </>
  );
}

const SEATED: { id: AgentId; state: string; running?: boolean; lead?: boolean }[] = [
  { id: 'builder', state: 'Lead · idle', lead: true },
  { id: 'reviewer', state: 'Replying now', running: true },
  { id: 'hermes', state: 'Replying now', running: true },
];
const OTHERS: AgentId[] = ['designer', 'researcher', 'writer', 'nomos'];

// ---------- A: one `@` menu, agents first ----------

function MenuRow({ id, detail, on, right }: { id: AgentId; detail: string; on?: boolean; right?: ReactNode }) {
  const a = AGENTS[id];
  return (
    <div data-highlighted={on || undefined} className="flex min-h-10 items-center gap-2.5 rounded-2xl px-3 py-1.5 data-highlighted:bg-[var(--wash)]">
      <AgentAvatar a={a} size={22} />
      <span className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className="shrink-0 text-[13px] font-medium text-fg">{a.name}</span>
        <span className="truncate text-[11.5px] text-fg-3">{detail}</span>
      </span>
      {a.kind === 'remote' && <RemoteTag />}
      {right}
    </div>
  );
}

function MixedMenu({ phone }: { phone?: boolean }) {
  return (
    <div className={`absolute right-0 bottom-[calc(100%+8px)] left-0 z-20 flex max-h-[min(26rem,60vh)] flex-col overflow-hidden ${MENU} ${phone ? 'mx-3' : ''}`}>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-1.5">
        <div className="caption px-3 pt-2 pb-1">In this thread</div>
        {SEATED.map((s) => (
          <MenuRow key={s.id} id={s.id} detail={s.state} right={s.running ? <StatusDot mark="working" size={7} /> : null} />
        ))}
        <div className="caption px-3 pt-3 pb-1">Add to this thread</div>
        {OTHERS.map((id) => (
          <MenuRow
            key={id}
            id={id}
            on={id === 'designer'}
            detail={AGENTS[id].description}
            right={id === 'designer' ? <span className="shrink-0 rounded-full bg-surface-2 px-2 py-px text-[11px] text-fg-3">Joins</span> : null}
          />
        ))}
        <div className="caption px-3 pt-3 pb-1">Machines and files</div>
        <div className="flex min-h-10 items-center gap-2.5 rounded-2xl px-3 py-1.5">
          <Icon name="monitor" size={14} className="shrink-0 text-fg-3" />
          <span className="text-[13px] font-medium">MacBook Pro</span>
          <span className="truncate text-[11.5px] text-fg-3">Online</span>
        </div>
        <div className="flex min-h-10 items-center gap-2.5 rounded-2xl px-3 py-1.5">
          <Icon name="file" size={14} className="shrink-0 text-fg-3" />
          <span className="text-[13px] font-medium">status.tsx</span>
          <span className="truncate text-[11.5px] text-fg-3">apps/web/src/components/ui</span>
        </div>
      </div>
      <div className="border-t border-line px-4 py-2 text-[11.5px] text-fg-3">{phone ? 'Designer joins this thread and stays' : '↑↓ to move · ↵ to pick · Designer joins this thread and stays'}</div>
    </div>
  );
}

const typed = (
  <>
    Can you also check the new mark is readable in dark mode on <MachinePill name="MacBook Pro" /> @
  </>
);
/** A's message once Designer is picked: the pill, marked as joining, beside a machine pill. */
const picked = (
  <>
    Can you also check the new mark is readable in dark mode on <MachinePill name="MacBook Pro" /> <MentionPill id="designer" fresh />
  </>
);
/** The hint line, taken from B: who gets the message, once it names an agent. Before that, the placeholder names the lead. */
const HINT_PICKED = (
  <>
    Goes to <span className="font-medium text-fg-2">Designer</span> only. Designer joins this thread and stays until you remove it.
  </>
);
/** The bar's "Menu off" switch: the menu closed, so the parallel replies above the composer show. */
const useClosed = () => useParams().get('closed') === '1';

function DesktopA() {
  const closed = useClosed();
  return (
    <DesktopThread
      head={<ThreadHead channel={CHANNELS.omni} title={THREAD.title} />}
      composer={
        <ComposerBox text={closed ? picked : typed} menu={closed ? null : <MixedMenu />} hint={closed ? HINT_PICKED : null}>
          <RunPill label="Builder · Opus 5.5" />
        </ComposerBox>
      }
    >
      <Transcript />
    </DesktopThread>
  );
}

function PhoneA() {
  const closed = useClosed();
  return (
    <PhoneThread title={THREAD.title} sub="#Omni OS · Builder and 2 more" composer={<PhoneComposer text={closed ? picked : typed} menu={closed ? null : <MixedMenu phone />} hint={closed ? HINT_PICKED : null} />}>
      <Transcript phone />
    </PhoneThread>
  );
}
const desktopA = () => <DesktopA />;
const phoneA = () => <PhoneA />;

// ---------- B: a To line of recipients above the message ----------

function ToChip({ id, on, lead }: { id: AgentId; on?: boolean; lead?: boolean }) {
  const a = AGENTS[id];
  return (
    <span
      className={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full pr-2.5 pl-1 text-[12.5px] ${
        on ? 'bg-fg text-on-ink' : 'text-fg-2 shadow-[inset_0_0_0_1px_var(--line-strong)]'
      }`}
    >
      <AgentAvatar a={a} size={20} />
      {a.name}
      {lead && <span className={on ? 'text-on-ink/70' : 'text-fg-3'}>· lead</span>}
    </span>
  );
}

/** At rest the lead is the one recipient, as a message with no mention goes to it. */
function ToLine({ phone, closed }: { phone?: boolean; closed?: boolean }) {
  return (
    <div className={`flex items-center gap-1.5 px-3 pt-3 pb-0.5 ${phone ? 'mo-scroll overflow-x-auto' : 'flex-wrap'}`}>
      <span className="mr-0.5 shrink-0 text-[12px] font-medium text-fg-3">To</span>
      <ToChip id="builder" lead on={closed} />
      <ToChip id="reviewer" />
      <ToChip id="hermes" />
      {!closed && <ToChip id="designer" on />}
      <span className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-[12.5px] text-fg-3 shadow-[inset_0_0_0_1px_var(--line-strong)]">
        <Icon name="plus" size={13} /> Agent
      </span>
    </div>
  );
}

function AddMenu({ phone }: { phone?: boolean }) {
  return (
    <div className={`absolute bottom-[calc(100%+8px)] z-20 w-[22rem] max-w-[calc(100%-1.5rem)] overflow-hidden p-1.5 ${MENU} ${phone ? 'right-3 left-3 w-auto max-w-none' : 'left-0'}`}>
      <div className="caption px-3 pt-2 pb-1">Add an agent to this thread</div>
      {OTHERS.map((id) => {
        const a = AGENTS[id];
        return (
          <div key={id} data-highlighted={id === 'designer' || undefined} className="flex items-center gap-3 rounded-2xl px-3 py-2 data-highlighted:bg-[var(--wash)]">
            <AgentAvatar a={a} size={30} />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-[13px] font-medium">
                {a.name}
                {a.kind === 'remote' && <RemoteTag />}
              </span>
              <span className="line-clamp-1 text-[12px] text-fg-3">{a.description}</span>
            </span>
            {id === 'designer' && <Icon name="check" size={15} className="shrink-0 text-fg" />}
          </div>
        );
      })}
    </div>
  );
}

function DesktopB() {
  const closed = useClosed();
  return (
    <DesktopThread
      head={<ThreadHead channel={CHANNELS.omni} title={THREAD.title} />}
      composer={
        <ComposerBox
          above={<ToLine closed={closed} />}
          text={closed ? undefined : <>Can you also check the new mark is readable in dark mode</>}
          menu={closed ? null : <AddMenu />}
          hint={closed ? undefined : 'Goes to Designer only. Designer joins this thread and stays until you remove it.'}
        >
          <RunPill label={closed ? 'Builder · Opus 5.5' : 'Designer · Sonnet 5.5'} />
        </ComposerBox>
      }
    >
      <Transcript />
    </DesktopThread>
  );
}

function PhoneB() {
  const closed = useClosed();
  return (
    <PhoneThread
      title={THREAD.title}
      sub="#Omni OS · Builder and 2 more"
      composer={
        <PhoneComposer
          above={<ToLine phone closed={closed} />}
          text={closed ? undefined : <>Can you also check the new mark in dark mode</>}
          menu={closed ? null : <AddMenu phone />}
          hint={closed ? undefined : 'Goes to Designer only. It joins this thread.'}
        />
      }
    >
      <Transcript phone />
    </PhoneThread>
  );
}
const desktopB = () => <DesktopB />;
const phoneB = () => <PhoneB />;

export const mention: Screen = {
  id: 2,
  name: '@ agent mention',
  place: { kind: 'channel', channel: 'omni-os', hash: `#/t/${THREAD.id}` },
  pick: 'A',
  toggle: { key: 'closed', label: 'Menu off' },
  variants: [
    { key: 'A', name: 'One @ menu', idea: 'The @ menu Ben has today, agents on top: who sits here, then who would join, then machines and files. A hint under the composer says who gets the message.', desktop: desktopA, phone: phoneA },
    { key: 'B', name: 'To line', idea: 'Recipients as chips above the message, the lead by default; + Agent seats a new one. @ in the text adds a chip.', desktop: desktopB, phone: phoneB },
  ],
};

