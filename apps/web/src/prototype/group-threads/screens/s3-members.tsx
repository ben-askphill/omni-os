// PROTOTYPE, throwaway. Screen 3: the thread's member list. Who is seated, who is running, and removing a member.
// Builder (the lead) runs; Reviewer is idle; Ben is removing Hermes, so its row shows the confirm.
import type { ReactNode } from 'react';
import { AGENTS, CHANNELS, GROUP, THREAD, type AgentId, type Msg } from '../data.ts';
import { Messages } from '../messages.tsx';
import {
  AgentAvatar,
  ComposerBox,
  DesktopThread,
  Facepile,
  MENU,
  PhoneComposer,
  PhoneThread,
  QuickBottom,
  QuickCaption,
  QuickCard,
  QuickDivider,
  QuickRow,
  QuickTop,
  RemoteTag,
  RunPill,
  TechLine,
  ThreadHead,
} from '../parts.tsx';
import { Button, Icon, IconButton, StatusDot } from '../../../components/ui.tsx';
import { MoRound } from '../../../mobile/parts.tsx';
import { GroupQuick } from './s1-group-thread.tsx';
import { useParams } from '../url-state.ts';
import type { Screen } from './types.ts';

/** The bar's "List off" switch: the facepile at rest, so the quick card's faces show beside it. */
const useListOff = () => useParams().get('closed') === '1';

const LIST: Msg[] = [...GROUP.slice(0, 6), { id: 7, author: 'builder', at: '12:14', text: '', steps: '3 steps · Editing sync-thread.test.ts', running: 'Adding the failed case' }];

interface Member {
  id: AgentId;
  lead?: boolean;
  state: string;
  running?: boolean;
}
const MEMBERS: Member[] = [
  { id: 'builder', lead: true, state: 'Working · 1:12', running: true },
  { id: 'reviewer', state: 'Idle · last replied 12:11' },
  { id: 'hermes', state: 'Idle · last replied 12:11' },
];

const Transcript = ({ phone }: { phone?: boolean }) => <Messages list={LIST} phone={phone} />;
const composer = (
  <ComposerBox>
    <RunPill label="Builder · Opus 5.5" />
  </ComposerBox>
);

/** The confirm a Remove opens in place, as InlineConfirm does. */
function RemoveConfirm({ id, phone }: { id: AgentId; phone?: boolean }) {
  const a = AGENTS[id];
  return (
    <div className={`rounded-[16px] bg-bg p-3 shadow-[var(--shadow-card)] ${phone ? 'mx-1' : ''}`}>
      <p className="text-[12.5px] leading-[1.45] text-fg-2">
        Remove {a.name} from this thread? Its session closes. Its replies stay in the thread.
      </p>
      <div className="mt-2.5 flex justify-end gap-2">
        <Button size="sm" variant="ghost">
          Cancel
        </Button>
        <Button size="sm" variant="needs">
          Remove {a.name}
        </Button>
      </div>
    </div>
  );
}

function MemberLine({ m, size = 28, action }: { m: Member; size?: number; action?: ReactNode }) {
  const a = AGENTS[m.id];
  return (
    <div className="flex min-w-0 items-center gap-3 py-2">
      <AgentAvatar a={a} size={size} ring={m.running} />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-medium">
          <span className="truncate">{a.name}</span>
          {m.lead && <span className="shrink-0 rounded-full bg-surface-2 px-1.5 py-px text-[10.5px] font-medium text-fg-3">Lead</span>}
          {a.kind === 'remote' && <RemoteTag />}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-fg-3">
          {m.running && <StatusDot mark="working" size={7} />}
          <span className="truncate">{m.state}</span>
          <TechLine a={a} className="text-[11.5px]" />
        </span>
      </span>
      {action}
    </div>
  );
}

// ---------- A: a facepile in the header, the list in a popover ----------

function Pile({ open }: { open?: boolean }) {
  return (
    <button type="button" aria-expanded={open} className={`press flex h-8 items-center gap-1.5 rounded-full pr-2.5 pl-1.5 text-[12px] font-medium text-fg-2 ${open ? 'bg-surface-2' : 'hov'}`}>
      <Facepile ids={['builder', 'reviewer', 'hermes']} size={22} ring={['builder']} />
      3
    </button>
  );
}

function MembersPopover() {
  return (
    <div className={`absolute top-14 right-[13.5rem] z-30 w-[21rem] p-2 ${MENU}`}>
      <div className="flex items-baseline justify-between px-2 pt-1">
        <span className="caption">In this thread</span>
        <span className="text-[11.5px] text-fg-3">@ an agent to add one</span>
      </div>
      <div className="px-2">
        {MEMBERS.map((m) => (
          <div key={m.id}>
            <MemberLine
              m={m}
              action={
                m.lead ? null : (
                  <Button size="sm" variant="danger" className={m.id === 'hermes' ? 'bg-surface-2' : ''}>
                    Remove
                  </Button>
                )
              }
            />
            {m.id === 'hermes' && <RemoveConfirm id="hermes" />}
          </div>
        ))}
      </div>
    </div>
  );
}

function DesktopA() {
  const off = useListOff();
  return (
    <div className="relative h-full">
      <DesktopThread
        head={<ThreadHead channel={CHANNELS.omni} title={THREAD.title} right={<Pile open={!off} />} />}
        quick={<GroupQuick status="Working · Builder" running={['builder']} />}
        composer={composer}
      >
        <Transcript />
      </DesktopThread>
      {!off && <MembersPopover />}
    </div>
  );
}
const desktopA = () => <DesktopA />;

function PhoneSheet({ children }: { children: ReactNode }) {
  return (
    <div className="absolute inset-0 z-30 flex flex-col justify-end bg-[var(--scrim)]">
      <div className="rounded-t-[28px] bg-bg px-4 pt-2 pb-8 shadow-[var(--shadow-menu)]">
        <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-[var(--line-strong)]" />
        {children}
      </div>
    </div>
  );
}

const phoneA = () => <PhoneA />;
function PhoneA() {
  const off = useListOff();
  return (
  <div className="relative h-full">
    <PhoneThread
      title={THREAD.title}
      sub="#Omni OS"
      right={
        <>
          <span className="flex h-10 items-center rounded-full bg-surface-2 px-2">
            <Facepile ids={['builder', 'reviewer', 'hermes']} size={22} ring={['builder']} />
          </span>
          <MoRound icon="more" label="More" />
        </>
      }
      composer={<PhoneComposer placeholder="Reply to Builder" />}
    >
      <Transcript phone />
    </PhoneThread>
    {!off && <PhoneSheet>
      <div className="flex items-baseline justify-between px-1 pb-1">
        <span className="text-[17px] font-semibold">In this thread</span>
        <span className="text-[12.5px] text-fg-3">3 agents</span>
      </div>
      {MEMBERS.map((m) => (
        <div key={m.id}>
          <MemberLine m={m} size={36} action={m.lead ? null : <MoRound icon="minus" label={`Remove ${AGENTS[m.id].name}`} size={36} />} />
          {m.id === 'hermes' && <RemoveConfirm id="hermes" phone />}
        </div>
      ))}
      <p className="px-1 pt-2 text-[12.5px] text-fg-3">To add an agent, @ it in a message.</p>
    </PhoneSheet>}
  </div>
  );
}

// ---------- B: a strip of members under the header ----------

function StripChip({ m, confirm }: { m: Member; confirm?: boolean }) {
  const a = AGENTS[m.id];
  if (confirm)
    return (
      <span className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-needs/12 pr-1 pl-1 text-[12.5px] shadow-[inset_0_0_0_1px_var(--needs)]">
        <AgentAvatar a={a} size={24} />
        <span className="font-medium">Remove {a.name}?</span>
        <span className="text-fg-3">Replies stay</span>
        <button type="button" className="ml-1 h-6 rounded-full bg-needs px-2.5 text-[12px] font-medium text-on-needs">
          Remove
        </button>
        <button type="button" aria-label="Keep" className="grid h-6 w-6 place-items-center rounded-full text-fg-3 hover:text-fg">
          <Icon name="x" size={13} />
        </button>
      </span>
    );
  return (
    <span className="group/chip inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-surface pr-1 pl-1 text-[12.5px] shadow-[inset_0_0_0_1px_var(--line)]">
      <AgentAvatar a={a} size={24} ring={m.running} />
      <span className="font-medium">{a.name}</span>
      {m.lead && <span className="text-fg-3">lead</span>}
      {m.running ? <StatusDot mark="working" size={7} className="mr-1.5" /> : <span className="mr-1.5 text-[11.5px] text-fg-3">idle</span>}
      {!m.lead && (
        <button type="button" aria-label={`Remove ${a.name}`} className="-ml-1 grid h-6 w-6 place-items-center rounded-full text-fg-3 hover:bg-surface-2 hover:text-fg">
          <Icon name="x" size={12} />
        </button>
      )}
    </span>
  );
}

function Strip({ phone }: { phone?: boolean }) {
  // The phone has no room for the confirm in the chip: it opens on a line of its own under the strip.
  return (
    <div className="shrink-0">
      <div className={`flex items-center gap-1.5 pb-2 ${phone ? 'mo-scroll overflow-x-auto px-4' : 'px-3 md:px-6 md:pl-[4.25rem]'}`}>
        {MEMBERS.map((m) => (
          <StripChip key={m.id} m={m} confirm={!phone && m.id === 'hermes'} />
        ))}
      </div>
      {phone && (
        <div className="px-4 pb-2">
          <RemoveConfirm id="hermes" phone />
        </div>
      )}
    </div>
  );
}

const desktopB = () => (
  <DesktopThread head={<ThreadHead channel={CHANNELS.omni} title={THREAD.title} />} below={<Strip />} composer={composer}>
    <Transcript />
  </DesktopThread>
);

const phoneB = () => (
  <PhoneThread title={THREAD.title} sub="#Omni OS" below={<Strip phone />} composer={<PhoneComposer placeholder="Reply to Builder" />}>
    <Transcript phone />
  </PhoneThread>
);

// ---------- C: a section of the quick card (desktop) and of the thread's details (phone) ----------

function QuickMembers() {
  return (
    <QuickCard>
      <QuickTop />
      <QuickDivider />
      <QuickCaption>
        <span className="flex-1">Agents</span>
        <span className="font-num tabular-nums">3</span>
      </QuickCaption>
      {MEMBERS.map((m) => {
        const a = AGENTS[m.id];
        return (
          <div key={m.id}>
            <div className="flex min-w-0 items-center gap-1">
              <QuickRow className="flex-1">
                <AgentAvatar a={a} size={20} ring={m.running} />
                <span className="truncate">{a.name}</span>
                <span className="truncate text-fg-3">{m.lead ? 'Lead' : m.state.split(' · ')[0]}</span>
              </QuickRow>
              {!m.lead && <IconButton icon="more" label={`${a.name} options`} size={14} active={m.id === 'hermes'} className="mr-[var(--sp-2)] h-7 w-7" />}
            </div>
            {m.id === 'hermes' && (
              <div className="px-1 pb-1">
                <RemoveConfirm id="hermes" />
              </div>
            )}
          </div>
        );
      })}
      <QuickBottom status="Working · Builder" />
    </QuickCard>
  );
}

const desktopC = () => (
  <DesktopThread head={<ThreadHead channel={CHANNELS.omni} title={THREAD.title} />} quick={<QuickMembers />} composer={composer}>
    <Transcript />
  </DesktopThread>
);

/** The phone's thread details screen (the Details view a thread pushes), with its agents on top. */
const phoneC = () => (
  <div className="flex h-full flex-col bg-bg">
    <header className="shrink-0 bg-bg">
      <div className="flex h-[52px] items-center gap-2.5 px-3">
        <MoRound icon="chevronLeft" label="Back" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-medium">Details</div>
          <div className="truncate text-[12px] text-fg-3">{THREAD.title}</div>
        </div>
      </div>
    </header>
    <div className="mo-scroll min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pt-2 pb-10">
      <section className="flex flex-col gap-2">
        <div className="flex items-baseline gap-1.5 px-1">
          <span className="text-[12px] font-medium text-fg-3">Agents in this thread</span>
          <span className="text-[12px] text-fg-3 tabular-nums">3</span>
        </div>
        <div className="overflow-hidden rounded-[20px] bg-surface px-4">
          {MEMBERS.map((m, i) => (
            <div key={m.id} className={i < MEMBERS.length - 1 ? 'border-b border-line' : ''}>
              <MemberLine m={m} size={34} action={m.lead ? null : <span className="text-[14px] text-danger-text">Remove</span>} />
              {m.id === 'hermes' && (
                <div className="pb-3">
                  <RemoveConfirm id="hermes" />
                </div>
              )}
            </div>
          ))}
        </div>
        <p className="px-1 text-[12.5px] text-fg-3">To add an agent, @ it in a message.</p>
      </section>
      <section className="flex flex-col gap-2">
        <div className="px-1 text-[12px] font-medium text-fg-3">Work</div>
        <div className="overflow-hidden rounded-[20px] bg-surface">
          {[
            ['monitor', 'omarchy'],
            ['branch', 'omni/9a1c0e52'],
            ['pr', 'No PRs yet'],
          ].map(([icon, label], i) => (
            <div key={label} className={`flex items-center gap-3 px-4 py-3 text-[15px] ${i < 2 ? 'border-b border-line' : ''}`}>
              <Icon name={icon as 'monitor'} size={18} className="text-fg-2" />
              {label}
            </div>
          ))}
        </div>
      </section>
    </div>
  </div>
);

export const members: Screen = {
  id: 3,
  name: 'Member list',
  place: { kind: 'channel', channel: 'omni-os', hash: `#/t/${THREAD.id}` },
  pick: 'A',
  toggle: { key: 'closed', label: 'List off' },
  variants: [
    { key: 'A', name: 'Header facepile', idea: 'Avatars at the header’s right; the list opens as a popover (a sheet on the phone) with Remove per member. The quick card keeps its Lead and Members faces.', desktop: desktopA, phone: phoneA },
    { key: 'B', name: 'Members strip', idea: 'A row of member chips under the title, always in sight, × to remove.', desktop: desktopB, phone: phoneB },
    { key: 'C', name: 'Quick card', idea: 'An Agents section in the quick card on desktop, and at the top of the thread’s Details on the phone.', desktop: desktopC, phone: phoneC },
  ],
};
