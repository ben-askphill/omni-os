// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Route } from '../src/router.ts';
import { readPref } from '../src/store.tsx';
import { useSidebarView } from '../src/sidebar-view.ts';

// Classic sidebar: #/inbox (Go > Inbox, the palette) shows the dashboard, so the Inbox list has to be the sidebar's.

let root: Root;
let host: HTMLDivElement;
let seen: string[] = [];
const Probe = ({ route }: { route: Route['name'] }) => {
  const [view] = useSidebarView(route);
  seen.push(view);
  return null;
};
const render = (route: Route['name']) => act(() => root.render(createElement(Probe, { route })));
const last = () => seen[seen.length - 1];

beforeEach(() => {
  localStorage.clear();
  seen = [];
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('the Classic sidebar view', () => {
  it('stays on Projects by default and on other pages', () => {
    render('home');
    expect(last()).toBe('projects');
    render('channel');
    expect(last()).toBe('projects');
  });

  it('opens on the Inbox for #/inbox, from the first render, and remembers it', () => {
    localStorage.setItem('omni.sidebar.view', JSON.stringify('projects'));
    render('inbox');
    expect(seen[0]).toBe('inbox');
    expect(readPref('sidebar.view', 'projects')).toBe('inbox');
  });

  it('switches to the Inbox when Ben goes to #/inbox while it shows Projects', () => {
    render('home');
    expect(last()).toBe('projects');
    render('inbox');
    expect(last()).toBe('inbox');
    render('home');
    expect(last()).toBe('inbox');
  });
});
