import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { agentFace } from '@omni/shared/agent-avatar.ts';
import { branchShows } from '@omni/shared/crew-eyes.ts';

// A delegated thread's avatar on the Delegation card follows the thread's live status without opening the thread: eyes
// from the status, and the working loop while it runs (ADR 0021, D29). Idle once it finishes, fails or is stopped.
const crew = vi.hoisted(() => ({ roles: [{ id: 'builder', name: 'builder' }] as { id: string; name: string }[] }));
vi.mock('../src/store.tsx', () => ({ useCrewRoles: () => crew.roles, useNow: () => Date.now() }));

import { BranchFace } from '../src/components/Delegation.tsx';

const card = (status: string) => renderToStaticMarkup(createElement(BranchFace, { role: 'builder', title: 'Build it', status, children: null }));
const eyes = (status: string) => card(status).match(/data-eyes="(\w+)"/)?.[1];
const motion = (status: string, reducedMotion = false) => {
  const face = agentFace({ id: 'builder' }, { size: 28, shows: branchShows(status), placement: 'row', reducedMotion });
  if (face.kind !== 'character') throw new Error('no character');
  return face.motion;
};

describe('the Delegation card avatar', () => {
  it('shows working eyes on a running thread, and rests on the eyes of every other state', () => {
    expect(eyes('running')).toBe('working');
    expect(eyes('queued')).toBe('waiting');
    expect(eyes('done')).toBe('done');
    expect(eyes('failed')).toBe('needs');
    expect(eyes('stopped')).toBe('idle');
  });

  it('animates while the thread runs and goes still when it finishes, fails or is stopped', () => {
    expect(motion('running').body).not.toBeNull();
    expect(motion('running').eyes).not.toBeNull();
    for (const status of ['queued', 'done', 'failed', 'stopped']) expect(motion(status), status).toMatchObject({ body: null, eyes: null });
  });

  it('plays nothing under reduced motion, as the avatar in the thread does', () => {
    expect(motion('running', true)).toMatchObject({ body: null, eyes: null, change: null, pop: null });
  });
});
