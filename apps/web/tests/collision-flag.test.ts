// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Collision } from '@omni/shared/collisions.ts';

// A collision flag's Dismiss (ADR 0019): the transcript's flag above the lanes and Changes' banner both take the flag
// down on the server, whether or not the caller wants the flags still up.

const posts: string[] = [];

vi.mock('../src/api.ts', async (importActual) => {
  const actual = await importActual<typeof import('../src/api.ts')>();
  actual.api.post = vi.fn(async (path: string) => {
    posts.push(path);
    return { collisions: [] };
  }) as typeof actual.api.post;
  return actual;
});

import { CollisionFlag } from '../src/components/thread/Collision.tsx';

const flag: Collision = { id: 86, key: 'k', path: 'src/cart/tax.ts', label: 'cart/tax.ts', agents: ['builder', 'designer'], at: '2026-11-20T18:00:00Z', cleared: null };

let root: Root;
let host: HTMLDivElement;
const dismiss = () => [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Dismiss')!;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  posts.length = 0;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe('a collision flag', () => {
  it('dismisses on the server from the transcript, where no one asks for the flags still up', async () => {
    await act(async () => root.render(createElement(CollisionFlag, { c: flag, threadId: 't-1' })));
    await act(async () => void dismiss().click());
    expect(posts).toEqual(['/threads/t-1/collisions/86/dismiss']);
  });

  it('hands Changes the flags still up', async () => {
    const onDismissed = vi.fn();
    await act(async () => root.render(createElement(CollisionFlag, { c: flag, threadId: 't-1', onDismissed })));
    await act(async () => void dismiss().click());
    expect(posts).toHaveLength(1);
    expect(onDismissed).toHaveBeenCalledWith([]);
  });
});
