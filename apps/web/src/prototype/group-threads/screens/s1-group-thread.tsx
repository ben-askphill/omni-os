// PROTOTYPE, throwaway. Screen 1: a group thread. The lead (Builder, an uploaded avatar) and two members, Reviewer
// (local, the initials disc) and Hermes (remote, the avatar it offered), each with its name and face on its replies.
// Harness and model show only with Show technical details on (the bar's Tech switch).
import { GROUP, THREAD, AGENTS } from '../data.ts';
import { Messages, type Style } from '../messages.tsx';
import { AgentAvatar, ComposerBox, DesktopThread, Facepile, PhoneComposer, PhoneThread, QuickBottom, QuickCard, QuickRow, QuickTop, RunPill, TechRow, ThreadHead } from '../parts.tsx';
import type { Screen } from './types.ts';

const OMNI = { name: 'Omni OS', bg: '#17181a' };

function Quick() {
  return (
    <QuickCard>
      <QuickTop />
      <QuickRow icon="delegate">
        <span className="shrink-0 text-fg-3">Lead</span>
        <AgentAvatar a={AGENTS.builder} size={18} />
        <span className="truncate">Builder</span>
      </QuickRow>
      <QuickRow icon="user">
        <span className="shrink-0 text-fg-3">Members</span>
        <Facepile ids={['reviewer', 'hermes']} size={18} />
        <span className="truncate">Reviewer, Hermes</span>
      </QuickRow>
      <TechRow />
      <QuickBottom status="Done · 3 agents" />
    </QuickCard>
  );
}

const desktop = (style: Style) => () => (
  <DesktopThread
    head={<ThreadHead channel={OMNI} title={THREAD.title} status="done" />}
    quick={<Quick />}
    composer={
      <ComposerBox>
        <RunPill label="Builder · Opus 5.5" />
      </ComposerBox>
    }
  >
    <Messages list={GROUP} style={style} />
  </DesktopThread>
);

const phone = (style: Style) => () => (
  <PhoneThread
    title={THREAD.title}
    sub={
      <span className="inline-flex items-center gap-1.5">
        #Omni OS · <Facepile ids={['builder', 'reviewer', 'hermes']} size={14} /> Builder and 2 more
      </span>
    }
    composer={<PhoneComposer placeholder="Reply to Builder" />}
  >
    <Messages list={GROUP} style={style} phone />
  </PhoneThread>
);

export const groupThread: Screen = {
  id: 1,
  name: 'Group thread',
  place: { kind: 'channel', channel: 'omni-os', hash: `#/t/${THREAD.id}` },
  variants: [
    { key: 'A', name: 'Gutter', idea: 'Avatar in a left gutter, bold name over the reply, chat style.', desktop: desktop('gutter'), phone: phone('gutter') },
    { key: 'B', name: 'Byline', idea: 'A 20px avatar and the name on a quiet line over the reply, as the phone already shows the Conductor.', desktop: desktop('byline'), phone: phone('byline') },
    { key: 'C', name: 'Turn cards', idea: 'Each agent turn in a surface card headed by its face and name.', desktop: desktop('card'), phone: phone('card') },
  ],
};
