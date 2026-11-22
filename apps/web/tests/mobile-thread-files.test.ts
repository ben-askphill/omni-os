// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Artifact, ArtifactWithThread } from '../src/api.ts';
import { CrewFileList, ThreadFileList } from '../src/mobile/CrewFiles.tsx';

// The phone's thread Details lists the thread's own files and screenshots, then its delegated threads' (mobile/CrewFiles.tsx).

const file = (id: number, at: string, over: Partial<Artifact> = {}): Artifact => ({
  id,
  thread_id: 'p',
  path: `/t/p/artifacts/f${id}`,
  name: `f${id}.html`,
  kind: 'html',
  size: 10,
  url: null,
  description: null,
  created_at: at,
  updated_at: at,
  ...over,
});

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const names = () => [...host.querySelectorAll('.font-mono')].map((n) => n.textContent);

describe('ThreadFileList', () => {
  it('lists the thread\'s files and screenshots together, newest first, and opens the one tapped', () => {
    const opened: number[] = [];
    const files = [file(1, '2026-11-20T10:00:00Z'), file(3, '2026-11-20T12:00:00Z')];
    const shots = [file(2, '2026-11-20T11:00:00Z', { kind: 'screenshot', name: 'shot.png' })];
    act(() => root.render(createElement(ThreadFileList, { files, shots, onOpen: (a) => opened.push(a.id) })));
    expect(host.textContent).toContain('Files');
    expect(names()).toEqual(['f3.html', 'shot.png', 'f1.html']);
    act(() => (host.querySelectorAll('button')[1] as HTMLButtonElement).click());
    expect(opened).toEqual([2]);
  });

  it('draws nothing for a thread with no files', () => {
    act(() => root.render(createElement(ThreadFileList, { files: [], shots: [], onOpen: () => {} })));
    expect(host.textContent).toBe('');
  });
});

describe('CrewFileList', () => {
  it('names the delegated thread under each file', () => {
    const crew: ArtifactWithThread = { ...file(9, '2026-11-20T10:00:00Z', { thread_id: 'k' }), thread_title: 'Kid thread', channel_id: 'c' };
    act(() => root.render(createElement(CrewFileList, { files: [crew], shots: [], onOpen: () => {} })));
    expect(host.textContent).toContain('From delegated threads');
    expect(host.textContent).toContain('Kid thread');
  });
});
