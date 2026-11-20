// PROTOTYPE, throwaway. Screen 4: Ben named Builder and Designer in one message. Both run at once in the one worktree,
// both edited status.tsx, Omni told each of them, and the thread flags the file (a collision).
import type { ReactNode } from 'react';
import { AGENTS, CHANNELS, COLLIDED, PARALLEL, THREAD, type AgentId } from '../data.ts';
import { Messages } from '../messages.tsx';
import { AgentAvatar, ComposerBox, DesktopThread, Facepile, PhoneComposer, PhoneThread, RunPill, TechLine, ThreadHead, Thinking } from '../parts.tsx';
import { Button, Icon, IconButton, StatusDot } from '../../../components/ui.tsx';
import type { Screen } from './types.ts';

const short = (p: string) => p.split('/').slice(-2).join('/');

interface Run {
  id: AgentId;
  label: string;
  time: string;
  steps: { t: string; s: 'done' | 'now' | 'todo' }[];
  files: string[];
}
const RUNS: Run[] = [
  {
    id: 'builder',
    label: 'Clearing the mark on handoff',
    time: '1:48',
    steps: [
      { t: 'Read the handoff path in the sidebar', s: 'done' },
      { t: 'Edit status.tsx and sidebar-view.ts', s: 'done' },
      { t: 'Run the web tests', s: 'now' },
    ],
    files: [COLLIDED, 'apps/web/src/sidebar-view.ts'],
  },
  {
    id: 'designer',
    label: 'Drawing the moving mark',
    time: '1:31',
    steps: [
      { t: 'Sketch a mark for a thread on the move', s: 'done' },
      { t: 'Add the mark to status.tsx', s: 'done' },
      { t: 'Check it in light and dark', s: 'now' },
    ],
    files: [COLLIDED, 'packages/shared/status.ts'],
  },
];
const other = (id: AgentId) => AGENTS[id === 'builder' ? 'designer' : 'builder'].name;

const head = (
  <ThreadHead
    channel={CHANNELS.omni}
    title={THREAD.title}
    right={
      <span className="mr-1 flex items-center gap-1.5 text-[12px] text-fg-3">
        <Facepile ids={['builder', 'designer']} size={22} ring={['builder', 'designer']} /> 2 working
      </span>
    }
  />
);

/** A changed file, with the collision flag when the other agent edited it too. */
function FileRow({ path, by }: { path: string; by?: string }) {
  const hit = path === COLLIDED;
  return (
    <div className={`flex min-w-0 items-center gap-2 rounded-lg px-2 py-1 text-[12.5px] ${hit ? 'bg-[color-mix(in_srgb,var(--warn)_12%,transparent)]' : ''}`}>
      <Icon name={hit ? 'alert' : 'file'} size={13} className={`shrink-0 ${hit ? 'text-warn' : 'text-fg-3'}`} />
      <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]" title={path}>
        {short(path)}
      </span>
      {hit && by && <span className="shrink-0 text-[11.5px] text-fg-2">also {by}</span>}
    </div>
  );
}

/** The collision flag as a transcript row. */
function CollisionRow({ phone }: { phone?: boolean }) {
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[18px] px-3.5 py-2.5 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--warn)_45%,transparent)] ${phone ? '' : ''}`}>
      <Icon name="alert" size={15} className="shrink-0 text-warn" />
      <span className="min-w-0 flex-1 text-[13px] leading-[1.45]">
        <span className="font-medium">Both edited</span> <span className="font-mono text-[12px]">{short(COLLIDED)}</span>
        <span className="text-fg-3"> · Builder and Designer were each told.</span>
      </span>
      <Button size="sm" icon="diff">
        Compare
      </Button>
    </div>
  );
}

// ---------- A: inline in the transcript ----------

function InlineReply({ r, phone }: { r: Run; phone?: boolean }) {
  const a = AGENTS[r.id];
  return (
    <div>
      <div className="mb-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] leading-none text-fg-3">
        <AgentAvatar a={a} size={20} ring />
        <span className="font-medium text-fg-2">{a.name}</span>
        <TechLine a={a} className="text-[11.5px]" />
      </div>
      <Thinking label={r.label} time={r.time} />
      <div className={`mt-2 space-y-0.5 ${phone ? '' : 'max-w-md'}`}>
        <div className="px-2 text-[11px] font-medium text-fg-3">Changed so far</div>
        {r.files.map((f) => (
          <FileRow key={f} path={f} by={other(r.id)} />
        ))}
      </div>
    </div>
  );
}

const transcriptA = (phone?: boolean) => (
  <>
    <Messages list={PARALLEL} phone={phone} />
    <InlineReply r={RUNS[0]} phone={phone} />
    <InlineReply r={RUNS[1]} phone={phone} />
    <CollisionRow phone={phone} />
  </>
);

const stopComposer = (
  <ComposerBox placeholder="Add to this. Builder and Designer read it at their next step">
    <RunPill label="Builder · Opus 5.5" />
  </ComposerBox>
);

const desktopA = () => (
  <DesktopThread head={head} composer={stopComposer}>
    {transcriptA()}
  </DesktopThread>
);
const phoneA = () => (
  <PhoneThread
    title={THREAD.title}
    sub={
      <span className="inline-flex items-center gap-1.5">
        <Facepile ids={['builder', 'designer']} size={14} ring={['builder', 'designer']} /> 2 working · #Omni OS
      </span>
    }
    composer={<PhoneComposer placeholder="Add to this" />}
  >
    {transcriptA(true)}
  </PhoneThread>
);

// ---------- B: lanes, one per running agent ----------

function Lane({ r, compact }: { r: Run; compact?: boolean }) {
  const a = AGENTS[r.id];
  return (
    <div className="min-w-0 flex-1 rounded-[20px] px-3.5 pt-3 pb-2.5 shadow-[inset_0_0_0_1px_var(--line)]">
      {!compact && (
        <div className="mb-2 flex min-w-0 items-center gap-2 text-[12.5px]">
          <AgentAvatar a={a} size={22} ring />
          <span className="font-medium">{a.name}</span>
          <span className="ml-auto font-num text-[11.5px] text-fg-3 tabular-nums">{r.time}</span>
          <IconButton icon="stop" label={`Stop ${a.name}`} size={13} className="-mr-1.5 h-7 w-7" />
        </div>
      )}
      <ol className="space-y-1">
        {r.steps.map((s) => (
          <li key={s.t} className="flex items-start gap-2 text-[12.5px] leading-[1.4]">
            <span className="mt-[3px] grid w-3 shrink-0 place-items-center">
              {s.s === 'done' ? <Icon name="check" size={12} className="text-fg-3" /> : s.s === 'now' ? <StatusDot mark="working" size={8} /> : <span className="h-1.5 w-1.5 rounded-full bg-fg-4" />}
            </span>
            <span className={s.s === 'now' ? 'shimmer-text font-medium' : 'text-fg-2'}>{s.t}</span>
          </li>
        ))}
      </ol>
      <div className="mt-2.5 border-t border-line pt-2">
        {r.files.map((f) => (
          <FileRow key={f} path={f} by={other(r.id)} />
        ))}
      </div>
    </div>
  );
}

const desktopB = () => (
  <DesktopThread head={head} composer={stopComposer}>
    <Messages list={PARALLEL} />
    <div>
      <CollisionRow />
      <div className="mt-3 flex gap-3">
        <Lane r={RUNS[0]} />
        <Lane r={RUNS[1]} />
      </div>
    </div>
  </DesktopThread>
);

const phoneB = () => (
  <PhoneThread title={THREAD.title} sub="2 working · #Omni OS" composer={<PhoneComposer placeholder="Add to this" />}>
    <Messages list={PARALLEL} phone />
    <div className="space-y-3">
      <div className="grid grid-cols-2 rounded-full bg-surface-2 p-1" role="tablist">
        {RUNS.map((r, i) => (
          <span key={r.id} role="tab" aria-selected={i === 0} className={`flex h-9 items-center justify-center gap-1.5 rounded-full text-[13.5px] font-medium ${i === 0 ? 'bg-bg shadow-[var(--shadow-card)]' : 'text-fg-2'}`}>
            <AgentAvatar a={AGENTS[r.id]} size={20} ring />
            {AGENTS[r.id].name}
            <Icon name="alert" size={13} className="text-warn" />
          </span>
        ))}
      </div>
      <Lane r={RUNS[0]} compact />
      <CollisionRow phone />
    </div>
  </PhoneThread>
);

// ---------- C: a dock above the composer ----------

function Dock({ phone }: { phone?: boolean }) {
  return (
    <div className={`mb-2 rounded-[20px] bg-surface p-1.5 ${phone ? '' : 'shadow-[inset_0_0_0_1px_var(--line)]'}`}>
      {RUNS.map((r) => {
        const a = AGENTS[r.id];
        return (
          <div key={r.id} className="flex min-w-0 items-center gap-2.5 rounded-[14px] px-2.5 py-1.5">
            <AgentAvatar a={a} size={22} ring />
            <span className="shrink-0 text-[13px] font-medium">{a.name}</span>
            <span className="shimmer-text min-w-0 flex-1 truncate text-[12.5px] text-fg-3">{r.label}</span>
            <span className="shrink-0 font-num text-[11.5px] text-fg-3 tabular-nums">{r.time}</span>
            <IconButton icon="stop" label={`Stop ${a.name}`} size={13} className="h-7 w-7" />
          </div>
        );
      })}
      <div className="mt-1 flex min-w-0 items-center gap-2.5 rounded-[14px] bg-[color-mix(in_srgb,var(--warn)_12%,transparent)] px-2.5 py-2">
        <Icon name="alert" size={15} className="shrink-0 text-warn" />
        <span className="min-w-0 flex-1 truncate text-[12.5px]">
          <span className="font-mono text-[11.5px]">{short(COLLIDED)}</span> <span className="text-fg-2">edited by both</span>
        </span>
        <button type="button" className="shrink-0 text-[12.5px] font-medium underline underline-offset-2">
          Compare
        </button>
      </div>
    </div>
  );
}

const quietTranscript = (phone?: boolean): ReactNode => (
  <>
    <Messages list={PARALLEL} phone={phone} />
    <Messages
      phone={phone}
      list={[
        { id: 81, author: 'builder', at: '12:20', text: '', steps: '5 steps so far' },
        { id: 82, author: 'designer', at: '12:20', text: '', steps: '4 steps so far' },
      ]}
    />
  </>
);

const desktopC = () => (
  <DesktopThread
    head={head}
    composer={
      <>
        <Dock />
        {stopComposer}
      </>
    }
  >
    {quietTranscript()}
  </DesktopThread>
);

const phoneC = () => (
  <PhoneThread
    title={THREAD.title}
    sub="2 working · #Omni OS"
    composer={
      <div>
        <div className="px-3">
          <Dock phone />
        </div>
        <PhoneComposer placeholder="Add to this" />
      </div>
    }
  >
    {quietTranscript(true)}
  </PhoneThread>
);

export const parallel: Screen = {
  id: 4,
  name: 'Two running, collision',
  place: { kind: 'channel', channel: 'omni-os', hash: `#/t/${THREAD.id}` },
  variants: [
    { key: 'A', name: 'Inline', idea: 'Each running reply shows what it changed so far; the collision is a row in the transcript.', desktop: desktopA, phone: phoneA },
    { key: 'B', name: 'Lanes', idea: 'The parallel turn splits into a lane per agent with steps and files (tabs on the phone).', desktop: desktopB, phone: phoneB },
    { key: 'C', name: 'Dock', idea: 'The transcript stays calm; a dock over the composer lists who runs, with Stop each, and the collision.', desktop: desktopC, phone: phoneC },
  ],
};
