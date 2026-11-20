// PROTOTYPE, throwaway: the made-up agents, threads and messages every screen draws. Nothing here is the real shape.

const svg = (body: string) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${body}</svg>`)}`;

/** An image Ben uploaded for Builder. */
const BUILDER_ART = svg(
  `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff9a52"/><stop offset="1" stop-color="#ff4420"/></linearGradient></defs>` +
    `<rect width="64" height="64" fill="url(#g)"/><path d="M10 50 26 22l9 15 6-9 13 22Z" fill="#17181a" opacity=".88"/><circle cx="45" cy="17" r="6" fill="#fff3d9"/>`,
);
/** The avatar Hermes offered when it connected. */
const HERMES_ART = svg(
  `<defs><linearGradient id="h" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b3bff"/><stop offset="1" stop-color="#15207a"/></linearGradient></defs>` +
    `<rect width="64" height="64" fill="url(#h)"/><path d="M13 41c9-15 23-21 39-24-6 7-11 11-19 15 7 0 12-1 17-3-6 9-19 16-37 12Z" fill="#eef0ff"/>`,
);
/** An image Ben uploaded for Designer. */
const DESIGNER_ART = svg(
  `<rect width="64" height="64" fill="#c6f52b"/><circle cx="24" cy="26" r="12" fill="#17181a"/><rect x="30" y="30" width="22" height="22" rx="6" fill="#fff" stroke="#17181a" stroke-width="3"/>`,
);

export type AgentId = 'builder' | 'reviewer' | 'hermes' | 'designer' | 'researcher' | 'writer' | 'nomos' | 'conductor';

export interface Agent {
  id: AgentId;
  name: string;
  kind: 'local' | 'remote';
  /** An uploaded or offered image. Without one, the initials disc. */
  avatar?: string;
  /** The avatar came from the server when it connected. */
  offered?: boolean;
  /** The agent's own color: its image's main color. An initials disc's color is taken from its id instead. */
  accent?: string;
  harness: string;
  harnessName: string;
  model: string;
  description: string;
  server?: { url: string; kind: 'Runs API' | 'eve'; key: string; cap: number; seen: string };
}

export const AGENTS: Record<AgentId, Agent> = {
  builder: {
    id: 'builder',
    name: 'Builder',
    kind: 'local',
    avatar: BUILDER_ART,
    accent: '#ff6a2b',
    harness: 'claude-code',
    harnessName: 'Claude Code',
    model: 'Opus 5.5',
    description: 'Writes code in a repo channel. Bug fixes, UI changes, features. Works in the thread’s worktree and opens PRs.',
  },
  reviewer: {
    id: 'reviewer',
    name: 'Reviewer',
    kind: 'local',
    harness: 'codex',
    harnessName: 'Codex',
    model: 'GPT-6.1 Sol',
    description: 'Reviews a change against its brief. Has no file-edit tools.',
  },
  hermes: {
    id: 'hermes',
    name: 'Hermes',
    kind: 'remote',
    avatar: HERMES_ART,
    accent: '#2b3bff',
    offered: true,
    harness: 'hermes',
    harnessName: 'Hermes',
    model: 'hermes-4-405b',
    description: 'Ben’s own agent on the VPS. Knows the bridges, the relay and their logs.',
    server: { url: 'https://hermes.tail2f1c.ts.net', kind: 'Runs API', key: 'HERMES_API_KEY', cap: 2, seen: '2 min ago' },
  },
  nomos: {
    id: 'nomos',
    name: 'Nomos',
    kind: 'remote',
    harness: 'custom:nomos',
    harnessName: 'Nomos',
    model: 'eve',
    description: 'An eve agent for contracts and terms. Talks only.',
    server: { url: 'https://nomos.vercel.app', kind: 'eve', key: 'NOMOS_KEY', cap: 1, seen: 'yesterday' },
  },
  designer: {
    id: 'designer',
    name: 'Designer',
    kind: 'local',
    avatar: DESIGNER_ART,
    accent: '#c6f52b',
    harness: 'claude-code',
    harnessName: 'Claude Code',
    model: 'Sonnet 5.5',
    description: 'Mockups, design system work and UI review.',
  },
  researcher: {
    id: 'researcher',
    name: 'Researcher',
    kind: 'local',
    harness: 'claude-code',
    harnessName: 'Claude Code',
    model: 'Opus 5.5',
    description: 'Research, audits and answers to questions.',
  },
  writer: {
    id: 'writer',
    name: 'Writer',
    kind: 'local',
    harness: 'codex',
    harnessName: 'Codex',
    model: 'GPT-6.1',
    description: 'Release notes, docs and longer writing.',
  },
  conductor: {
    id: 'conductor',
    name: 'Conductor',
    kind: 'local',
    harness: 'claude-code',
    harnessName: 'Claude Code',
    model: 'Auto',
    description: 'Front agent. Routes real work to another agent’s thread.',
  },
};

export const agent = (id: AgentId) => AGENTS[id];

export type Author = 'ben' | AgentId;

export interface Msg {
  id: number;
  author: Author;
  at: string;
  text: string;
  /** Agents the message names, in order. */
  mentions?: AgentId[];
  /** The turn's steps, folded: "9 steps · Read 6 files, ran 2 commands". */
  steps?: string;
  /** Still running: the thinking line's label. */
  running?: string;
  /** Files this turn changed. */
  files?: string[];
  /** Agents this message of Ben's seated: the transcript says "Designer joined" under it. */
  joined?: AgentId[];
}

export const THREAD = {
  id: '9a1c0e52-1d4f-4c8e-9b0a-4f3d2a7c1b01',
  channel: 'omni-os',
  title: 'Running mark sticks after a handoff',
  branch: 'omni/9a1c0e52',
};

export const REMOTE_THREAD = {
  id: '4be2a771-0c55-4b0e-8f0e-7a9e6f1d2c02',
  channel: 'volero',
  title: 'Why the price flashes on the product page',
};

/** The group thread: Ben, the lead (Builder) and two members, Reviewer (local) and Hermes (remote). */
export const GROUP: Msg[] = [
  {
    id: 1,
    author: 'ben',
    at: '12:02',
    text: 'After I hand a thread to the MacBook, its mark here stays on Working until I reload. Find out why.',
  },
  {
    id: 2,
    author: 'builder',
    at: '12:06',
    steps: '9 steps · Read 6 files, ran 2 commands',
    files: ['apps/server/sync/handlers/thread.ts', 'apps/server/tests/sync-thread.test.ts'],
    text:
      'Found it. The handoff moves the session, but this machine never applies the status change that comes back, so the list keeps the last `running` it saw.\n\n' +
      '- `apps/server/sync/handlers/thread.ts` drops a status change that arrives while the thread is held elsewhere.\n' +
      '- The fix applies the status and skips only the session fields.\n\n' +
      'The change is on this branch, with a test for the held case.',
  },
  {
    id: 3,
    author: 'ben',
    at: '12:09',
    mentions: ['reviewer', 'hermes'],
    joined: ['reviewer', 'hermes'],
    text: '@Reviewer check Builder’s change before I merge. @Hermes did the VPS bridge log the same stale status last week?',
  },
  {
    id: 4,
    author: 'reviewer',
    at: '12:11',
    steps: '4 steps · Read the diff and 3 files',
    text:
      'The change is right. One gap: the new test only covers a held thread that finishes. Add the failed case too, since `failed` goes through the same branch.\n\n' +
      'Nothing else. The diff is 2 files, +38 −6.',
  },
  {
    id: 5,
    author: 'hermes',
    at: '12:11',
    text:
      'Yes. The bridge logged 14 `status=running` rows for threads that had already finished on the Mac, between 11 and 14 Nov, each right after a handoff. ' +
      'None since the 15th, when the MacBook was off. That matches what Builder found.',
  },
  {
    id: 6,
    author: 'ben',
    at: '12:14',
    text: 'Add the failed case, then open the PR.',
  },
  {
    id: 7,
    author: 'builder',
    at: '12:17',
    steps: '6 steps · Edited 1 file, ran the tests',
    text: 'Added the failed case. Both tests pass. Opened PR #902: Keep a handed-off thread’s status in step on both machines.',
  },
];

export const BEN = { name: 'Ben Rosenberg', first: 'Ben' };

/** The file both agents changed in screen 4. */
export const COLLIDED = 'apps/web/src/components/ui/status.tsx';

/** Screen 4: Ben names Builder and Designer in one message; both run at once and both edit status.tsx. */
export const PARALLEL: Msg[] = [
  GROUP[0],
  GROUP[1],
  {
    id: 8,
    author: 'ben',
    at: '12:20',
    mentions: ['builder', 'designer'],
    joined: ['designer'],
    text: '@Builder clear the mark in the sidebar as soon as the handoff starts. @Designer give a thread that is moving to the other machine its own mark while it moves.',
  },
];

export const CHANNELS = {
  omni: { name: 'Omni OS', bg: '#17181a' },
  volero: { name: 'Volero', bg: '#283c62' },
};
