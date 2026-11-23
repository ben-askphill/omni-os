import { describe, expect, it } from 'vitest';
import { agentFace, agentLook } from '../agent-avatar.ts';
import { branchShows, eyesFor, laneShows, rowShows } from '../crew-eyes.ts';

// What the avatar leading a row, a lane or a branch shows (ADR 0021, D23, D29; ADR 0019), one rule for the Web UI's
// desktop and phone layouts and the iOS app, which each read it here.

const seats = (lead: 'needs' | 'working' | 'done' | 'idle', other: 'needs' | 'working' | 'done' | 'idle' = 'needs') => [
  { lead: false, state: other },
  { lead: true, state: lead },
];

describe('rowShows: the avatar leading a thread row', () => {
  it("shows the row's mark", () => {
    expect(rowShows('working')).toEqual({ mark: 'working' });
    expect(rowShows('question', { members: [] })).toEqual({ mark: 'question' });
    expect(eyesFor(rowShows('queued'))).toBe('waiting');
  });

  it('shows the done arcs once Ben marked the thread done, whatever its mark says', () => {
    expect(rowShows('stopped', { done: true })).toEqual({ mark: 'done' });
    expect(rowShows('question', { done: true })).toEqual({ mark: 'done' });
    expect(eyesFor(rowShows('stopped', { done: true }))).toBe('done');
    expect(rowShows('stopped', { done: false })).toEqual({ mark: 'stopped' });
  });

  it("shows a group thread's lead's own state, not the busiest of its agents the row's mark draws", () => {
    // The mark is another seat's question; the lead itself works.
    expect(rowShows('question', { members: seats('working') })).toEqual({ member: 'working' });
    expect(eyesFor(rowShows('question', { members: seats('working') }))).toBe('working');
    expect(eyesFor(rowShows('working', { members: seats('needs', 'working') }))).toBe('needs');
    // Seats with no lead keep the row's mark.
    expect(rowShows('working', { members: [{ lead: false, state: 'needs' }] })).toEqual({ mark: 'working' });
  });

  it("shows the done arcs on a group thread marked done, over its lead's state", () => {
    expect(rowShows('question', { done: true, members: seats('working') })).toEqual({ mark: 'done' });
  });

  it('shows idle eyes on a row with no mark, unless a group lead says otherwise', () => {
    expect(rowShows(null)).toBeUndefined();
    expect(rowShows(undefined, { members: [] })).toBeUndefined();
    expect(eyesFor(rowShows(null))).toBe('idle');
    expect(rowShows(null, { members: seats('working') })).toEqual({ member: 'working' });
  });
});

describe('laneShows: one agent lane of a message several answered', () => {
  it("shows its own turn's state: working while it runs, waiting while queued, then its end", () => {
    expect(laneShows('running')).toEqual({ eyes: 'working' });
    expect(laneShows('queued')).toEqual({ eyes: 'waiting' });
    expect(laneShows('done')).toEqual({ eyes: 'done' });
    expect(laneShows('failed')).toEqual({ eyes: 'needs' });
    expect(laneShows('stopped')).toEqual({ eyes: 'idle' });
  });

  it("works in focus too: a lane's mark is not the open thread's, so it never thinks", () => {
    expect(eyesFor(laneShows('running'), true)).toBe('working');
    const face = agentFace({ id: 'builder' }, { size: 22, shows: laneShows('running'), placement: 'focus' });
    expect(face).toMatchObject({ kind: 'character', eyes: 'working' });
  });
});

describe('branchShows: a thread the open one delegated, on its card or row', () => {
  it('shows its status mark, read without opening it (D29)', () => {
    expect(branchShows('running')).toEqual({ mark: 'working' });
    for (const [status, eyes] of [
      ['running', 'working'],
      ['queued', 'waiting'],
      ['done', 'done'],
      ['failed', 'needs'],
      ['stopped', 'idle'],
    ] as const)
      expect(eyesFor(branchShows(status)), status).toBe(eyes);
  });
});

describe('agentFace rings a photo or an icon for the eyes it has no room for (D8)', () => {
  const photo = { id: 'designer', avatar: { image: '/api/crew/designer/avatar?v=0123456789ab' } };
  const icon = { id: 'designer', avatar: { icon: '🎨' } };

  it('rings Working while the agent thinks or works, Needs you when Ben has the ball, else nothing', () => {
    expect(agentFace(photo, { size: 32, shows: { member: 'working' } })).toMatchObject({ kind: 'image', ring: 'working' });
    expect(agentFace(photo, { size: 32, shows: { mark: 'working' }, placement: 'focus' })).toMatchObject({ ring: 'working' });
    expect(agentFace(icon, { size: 22, shows: { member: 'failed' } })).toMatchObject({ kind: 'icon', ring: 'needs' });
    expect(agentFace(icon, { size: 22, shows: { mark: 'question' } })).toMatchObject({ ring: 'needs' });
    for (const shows of [undefined, { member: 'done' as const }, { mark: 'queued' as const }, { eyes: 'idle' as const }])
      expect(agentFace(icon, { size: 22, shows }), JSON.stringify(shows)).toMatchObject({ kind: 'icon', ring: null });
  });

  it('shows it in a character\'s eyes instead, whose ring stays the outline\'s foreground', () => {
    expect(agentFace({ id: 'builder' }, { size: 24, shows: { mark: 'working' } })).toMatchObject({ kind: 'character', eyes: 'working', ring: 'fg' });
  });
});

describe('agentLook finds an agent for its avatar', () => {
  it('takes the listed agent, else its built-in name, else its id', () => {
    const designer = { id: 'designer', name: 'Designer', avatar: { icon: '🎨' } };
    expect(agentLook('designer', [designer])).toBe(designer);
    expect(agentLook('builder', [designer])).toEqual({ id: 'builder', name: 'Builder' });
    expect(agentLook('gone', [])).toEqual({ id: 'gone', name: 'gone' });
  });
});
