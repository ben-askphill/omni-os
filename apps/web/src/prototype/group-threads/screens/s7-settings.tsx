// PROTOTYPE, throwaway. Screen 7: Settings > Agents. Builder shows the avatar Ben uploaded, Reviewer its initials, and
// Hermes, a connected remote agent, is listed as an agent like any other: its server is a detail inside it, not a
// harness in the pickers. Ben is editing Hermes: its avatar (the one Hermes offered, which he can replace) and its server.
import type { ReactNode } from 'react';
import { AGENTS, type Agent, type AgentId } from '../data.ts';
import { AgentAvatar, RemoteTag } from '../parts.tsx';
import { Button, Chip, Icon, IconButton, PageHeader } from '../../../components/ui.tsx';
import { Advanced, Card, InfoList, InfoRow } from '../../../pages/settings-parts.tsx';
import { MoRound } from '../../../mobile/parts.tsx';
import { useTechnical } from '../../../display.ts';
import { useParams } from '../url-state.ts';
import type { Screen } from './types.ts';

/** The bar's "Local agent" switch: edit Reviewer (no avatar yet, so its initials) in place of Hermes. */
const useEditing = (): Agent => (useParams().get('local') === '1' ? AGENTS.reviewer : AGENTS.hermes);

const ORDER: AgentId[] = ['conductor', 'builder', 'reviewer', 'researcher', 'designer', 'hermes', 'nomos', 'writer'];
const host = (a: Agent) => a.server?.url.replace(/^https:\/\//, '') ?? '';

function RunLine({ a }: { a: Agent }) {
  const technical = useTechnical();
  if (a.kind === 'remote')
    return (
      <>
        Remote agent · connected {a.server!.seen}
        {technical && ` · ${host(a)} · ${a.server!.kind}`}
      </>
    );
  return <>{technical ? `${a.harnessName} · ${a.model}` : 'Auto'}</>;
}

function AgentList({ selected, compact }: { selected?: AgentId; compact?: boolean }) {
  return (
    <ul className="-mx-1 divide-y divide-line" aria-label="Agents">
      {ORDER.map((id) => {
        const a = AGENTS[id];
        return (
          <li key={id}>
            <button
              type="button"
              aria-current={selected === id || undefined}
              className={`hov group flex w-full min-w-0 items-start gap-3 rounded-[14px] px-1 py-2.5 text-left [--hov:var(--surface-2)] ${selected === id ? 'bg-surface-2' : ''}`}
            >
              <AgentAvatar a={a} size={30} />
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="truncate text-[13px] font-medium">{a.name}</span>
                  {a.kind === 'remote' ? <RemoteTag /> : ['conductor', 'builder', 'reviewer', 'writer'].includes(id) && <Chip tone="outline">Built-in</Chip>}
                </span>
                {!compact && <span className="mt-0.5 line-clamp-2 block text-[12.5px] text-fg-3">{a.description}</span>}
                <span className="mt-0.5 block truncate text-[12px] text-fg-3">
                  <RunLine a={a} />
                </span>
              </span>
              <Icon name="chevronRight" size={14} className="mt-1 shrink-0 text-fg-3" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** The avatar field: the picture, where it came from, Upload and Use initials. */
function AvatarField({ a, big }: { a: Agent; big?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-4">
      <span className="relative">
        <AgentAvatar a={a} size={big ? 72 : 60} />
        <span className="absolute -right-1 -bottom-1 grid h-7 w-7 place-items-center rounded-full bg-bg text-fg-2 shadow-[var(--shadow-card)]">
          <Icon name="camera" size={14} />
        </span>
      </span>
      <div className="min-w-0 flex-1 basis-48">
        <div className="text-[12.5px] text-fg-3">
          {a.offered ? `Offered by ${a.name} when it connected.` : a.avatar ? 'Uploaded on omarchy. Syncs to your other machines.' : 'No image yet: its initials, on a color from its name.'}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" icon="image">
            Upload image
          </Button>
          {a.avatar && (
            <Button size="sm" variant="ghost">
              Use initials
            </Button>
          )}
        </div>
        <div className="mt-1.5 text-[11.5px] text-fg-3">PNG, JPG or WebP. Omni crops it to a circle.</div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-[12.5px] font-medium text-fg-2">{label}</div>
      {children}
    </div>
  );
}

function ServerRows({ a }: { a: Agent }) {
  const technical = useTechnical();
  const s = a.server!;
  return (
    <InfoList>
      <InfoRow label="Address">
        <span className="min-w-0 truncate font-mono text-[12px]">{s.url}</span>
      </InfoRow>
      <InfoRow label="Connected">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-done shadow-[0_0_0_1px_var(--done-edge)]" /> Last seen {s.seen}
        </span>
      </InfoRow>
      {technical && (
        <>
          <InfoRow label="Kind">{s.kind}</InfoRow>
          <InfoRow label="Key">
            <span className="font-mono text-[12px]">{s.key}</span>
            <span className="text-fg-3">· kept on this server</span>
          </InfoRow>
          <InfoRow label="At once">{s.cap} turns</InfoRow>
        </>
      )}
    </InfoList>
  );
}

function ServerActions() {
  return (
    <div className="flex flex-wrap gap-2 pt-1">
      <Button size="sm" icon="refresh">
        Test connection
      </Button>
      <Button size="sm" variant="danger" icon="trash">
        Remove agent
      </Button>
    </div>
  );
}

function SettingsPage({ children }: { children: ReactNode }) {
  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[64rem] gap-6 md:px-4 lg:gap-10">
        <div className="min-w-0 max-w-2xl flex-1">
          <PageHeader eyebrow="Settings" title="Agents" subtitle="The agents threads run as: their charters, run defaults and powers." />
          <div className="space-y-5 px-4 pt-2 pb-16 md:px-8">{children}</div>
        </div>
      </div>
    </div>
  );
}

const listCard = (
  <Card
    title="Agents"
    subtitle="A thread started as an agent runs with its charter. Remote agents run on their own servers and only talk."
    actions={
      <>
        <Button size="sm" icon="globe">
          Add remote agent
        </Button>
        <Button size="sm" icon="plus">
          New agent
        </Button>
      </>
    }
  >
    <AgentList selected="hermes" />
  </Card>
);

// ---------- A: the editor as today's modal, the server folded at its foot ----------

function EditorBody({ a }: { a: Agent }) {
  return (
    <div className="space-y-6">
      <fieldset className="space-y-3">
        <legend className="caption mb-2">Identity</legend>
        <Field label="Avatar">
          <AvatarField a={a} />
        </Field>
        <Field label="Name">
          <input className="field" defaultValue={a.name} />
        </Field>
        <Field label="Description">
          <textarea className="field min-h-[64px] resize-y" defaultValue={a.description} />
        </Field>
      </fieldset>
      {a.server ? (
        <Advanced title="Server" summary={`${host(a)} · connected`} open>
          <ServerRows a={a} />
          <ServerActions />
        </Advanced>
      ) : (
        <>
          <Advanced title="Run" summary="Auto">
            <span />
          </Advanced>
          <Advanced title="Powers" summary="No file edits · reviews">
            <span />
          </Advanced>
        </>
      )}
    </div>
  );
}

function DesktopA() {
  const a = useEditing();
  return (
  <div className="relative h-full">
    <SettingsPage>{listCard}</SettingsPage>
    <div className="absolute inset-0 z-30 grid place-items-center bg-[var(--scrim)] p-6">
      <div className="flex max-h-full w-[min(36rem,100%)] flex-col overflow-hidden rounded-[28px] bg-bg shadow-[var(--shadow-menu)]">
        <div className="flex items-center gap-3 px-6 pt-5 pb-3">
          <h2 className="min-w-0 flex-1 text-[17px] font-semibold">Edit {a.name}</h2>
          <IconButton icon="x" label="Close" />
        </div>
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-6 pb-4">
          <EditorBody a={a} />
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-6 py-3.5">
          <Button variant="ghost">Cancel</Button>
          <Button variant="primary">Save</Button>
        </div>
      </div>
    </div>
  </div>
  );
}

function PhoneA() {
  const a = useEditing();
  return (
  <div className="flex h-full flex-col bg-bg">
    <header className="shrink-0 border-b border-line bg-bg">
      <div className="flex h-[52px] items-center gap-2.5 px-4">
        <span className="text-[15px] text-fg-2">Cancel</span>
        <span className="min-w-0 flex-1 text-center text-[15px] font-medium">Edit {a.name}</span>
        <span className="text-[15px] font-semibold">Save</span>
      </div>
    </header>
    <div className="mo-scroll min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-10">
      <EditorBody a={a} />
    </div>
  </div>
  );
}
const desktopA = () => <DesktopA />;
const phoneA = () => <PhoneA />;

// ---------- B: an agent page, the server a card of its own ----------

function DesktopB() {
  const a = useEditing();
  return (
  <div className="scroll-thin h-full overflow-y-auto">
    <div className="mx-auto max-w-[64rem] px-4 md:px-8">
      <div className="pt-6 pb-4 md:pt-10">
        <div className="flex items-center gap-1 text-[12.5px] text-fg-3">
          Settings <Icon name="chevronRight" size={12} /> Agents
        </div>
      </div>
      <div className="flex gap-6 pb-16">
        <div className="w-64 shrink-0">
          {/* Connect lives here now, next to the agent list (Ben, 2026-11-20). */}
          <div className="mb-2 flex flex-wrap gap-2">
            <Button size="sm" icon="plus">
              New agent
            </Button>
            <Button size="sm" icon="globe">
              Add remote agent
            </Button>
          </div>
          <AgentList selected={a.id} compact />
        </div>
        <div className="min-w-0 max-w-xl flex-1 space-y-5">
          <div className="flex items-center gap-4">
            <AgentAvatar a={a} size={72} />
            <div className="min-w-0">
              <h1 className="flex items-center gap-2 font-display text-[26px] leading-tight font-semibold">
                {a.name} {a.kind === 'remote' && <RemoteTag />}
              </h1>
              <p className="mt-1 text-[13px] text-fg-3">{a.description}</p>
            </div>
          </div>
          <Card title="Avatar" subtitle={`Shown on every message ${a.name} writes.`}>
            <AvatarField a={a} />
          </Card>
          {a.server ? (
            <>
              <Card title="Server" subtitle={`Where ${a.name} runs. It answers from there and never changes a thread’s files.`} actions={<ServerActions />}>
                <ServerRows a={a} />
              </Card>
              <Card title="In threads" subtitle={`What ${a.name} may do where it is seated.`}>
                <InfoList>
                  <InfoRow label="Sees">A thread’s messages and git-tracked files, only where the channel lets remote agents see its work</InfoRow>
                  <InfoRow label="Channels">#Omni OS lets them · #Volero does not</InfoRow>
                </InfoList>
              </Card>
            </>
          ) : (
            <Card title="Run and powers" subtitle="As today: run defaults, where it works, its powers and memory." />
          )}
        </div>
      </div>
    </div>
  </div>
  );
}
const desktopB = () => <DesktopB />;

function PhoneB() {
  const a = useEditing();
  return (
  <div className="flex h-full flex-col bg-bg">
    <header className="shrink-0 bg-bg">
      <div className="flex h-[52px] items-center gap-2.5 px-3">
        <MoRound icon="chevronLeft" label="Back" />
        <div className="min-w-0 flex-1 truncate text-[15px] font-medium">Agents</div>
      </div>
    </header>
    <div className="mo-scroll min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pt-2 pb-10">
      <div className="flex flex-col items-center gap-2 pt-2 text-center">
        <AgentAvatar a={a} size={88} />
        <span className="text-[14px] font-medium text-live-text">{a.avatar ? 'Change avatar' : 'Add avatar'}</span>
        <div className="flex items-center gap-2 text-[22px] font-semibold">
          {a.name} {a.kind === 'remote' && <RemoteTag />}
        </div>
        <p className="text-[13px] text-fg-3">{a.description}</p>
      </div>
      {a.server ? (
        <>
          <section className="flex flex-col gap-2">
            <div className="px-1 text-[12px] font-medium text-fg-3">Server</div>
            <div className="overflow-hidden rounded-[20px] bg-surface px-4 py-3">
              <ServerRows a={a} />
            </div>
          </section>
          <section className="overflow-hidden rounded-[20px] bg-surface">
            <div className="border-b border-line px-4 py-3 text-[15px]">Test connection</div>
            <div className="px-4 py-3 text-[15px] text-danger-text">Remove agent</div>
          </section>
        </>
      ) : (
        <section className="overflow-hidden rounded-[20px] bg-surface">
          {['Run', 'Where', 'Powers', 'Memory'].map((r, i) => (
            <div key={r} className={`flex items-center px-4 py-3 text-[15px] ${i < 3 ? 'border-b border-line' : ''}`}>
              <span className="flex-1">{r}</span>
              <Icon name="chevronRight" size={14} className="text-fg-3" />
            </div>
          ))}
        </section>
      )}
    </div>
  </div>
  );
}
const phoneB = () => <PhoneB />;

export const settings: Screen = {
  id: 7,
  name: 'Settings > Agents',
  place: { kind: 'settings', hash: '#/settings/crew' },
  pick: 'B',
  toggle: { key: 'local', label: 'Local agent' },
  variants: [
    { key: 'A', name: 'Editor modal', idea: 'Today’s list and editor; a remote agent gets a Remote tag, and its server is a fold at the foot of the editor.', desktop: desktopA, phone: phoneA },
    { key: 'B', name: 'Agent page', idea: 'An agent opens as a page: big avatar on top, Avatar and Server as cards of their own.', desktop: desktopB, phone: phoneB },
  ],
};
