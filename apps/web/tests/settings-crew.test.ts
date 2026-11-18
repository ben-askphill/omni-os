// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Channel, CrewRole } from '../src/api.ts';

// Settings > Crew's editor: the Form and Markdown tabs are one draft, so an edit in either survives a switch to the
// other and a save from it, and a key only the file has stays. Hide shows the role hidden at once.

const state = vi.hoisted(() => ({ channels: [] as Channel[], crew: [] as CrewRole[] }));
vi.mock('../src/store.tsx', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/store.tsx')>()),
  useApp: () => ({ ...state, status: null, subscribe: () => () => {} }),
  useFeed: () => {},
}));

import { CrewSection } from '../src/pages/SettingsCrew.tsx';

const shippedRole = { id: 'builder', name: 'Builder', description: 'Writes code.', model: 'auto', mcp: [], delegateOnly: false, delegatable: true, kind: 'shipped', hidden: false, charter: 'You write code.' };
const ownFile = '---\nruntime: vps-agent\ncharter_mode: append\n---\nUse pnpm.\n';

type Detail = { role: Record<string, unknown>; own: string; charters: { builtIn: string; own: string; effective: string } } & Record<string, unknown>;
let detail: Detail;
let calls: { method: string; url: string; body?: any }[];
let root: Root;
let host: HTMLDivElement;

const bodyOf = (text: string) => text.split('---\n').slice(2).join('---\n').trim();

/** POST /api/crew/draft as the server answers it: the file a save would write over `own`, and the role it makes. */
function draft({ own, save }: { own?: string; save: { markdown?: string; fields?: Record<string, unknown>; charter?: string } }) {
  const markdown =
    save.markdown ??
    (() => {
      const [, frontmatter] = (own ?? detail.own).split('---\n');
      const keys = Object.entries(save.fields ?? {}).map(([k, v]) => `${k}: ${v}\n`).join('');
      return `---\n${frontmatter}${keys}---\n${save.charter ?? bodyOf(own ?? detail.own)}\n`;
    })();
  const description = /^description: (.*)$/m.exec(markdown)?.[1] ?? shippedRole.description;
  return { markdown, detail: { ...detail, own: markdown, role: { ...detail.role, description }, charters: { ...detail.charters, own: bodyOf(markdown) } } };
}

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Element.prototype.scrollIntoView = vi.fn();
  state.channels = [{ id: 'inbox', name: 'Inbox', kind: 'system' }] as Channel[];
  detail = {
    role: { ...shippedRole, kind: 'edited', charterMode: 'append', charter: 'You write code.\n\nUse pnpm.' },
    builtIn: shippedRole,
    shipped: '---\nname: Builder\ndescription: Writes code.\nmodel: auto\n---\nYou write code.\n',
    own: ownFile,
    shippedHash: 'abc',
    charters: { builtIn: 'You write code.', own: 'Use pnpm.', effective: 'You write code.\n\nUse pnpm.' },
  };
  state.crew = [detail.role as unknown as CrewRole];
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      calls.push({ method, url, body });
      if (url === '/api/crew?all=1') return Response.json([detail.role]);
      if (url === '/api/crew/draft') return Response.json(draft(body));
      if (url === '/api/crew/builder/hidden') {
        detail = { ...detail, role: { ...detail.role, hidden: body.hidden } };
        // The app's crew list, which the pickers read, leaves a hidden role out.
        state.crew = body.hidden ? [] : [detail.role as unknown as CrewRole];
        return Response.json(detail);
      }
      if (url === '/api/crew/builder') return Response.json(detail);
      if (url.startsWith('/api/harnesses')) return Response.json([]);
      return Response.json({});
    }),
  );
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(createElement(CrewSection)));
  await flush();
  // Open Builder's editor.
  const row = [...host.querySelectorAll<HTMLButtonElement>('ul[aria-label="Crew roles"] button')].find((b) => b.textContent?.includes('Builder'))!;
  await act(async () => row.click());
  await flush();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const flush = async () => {
  for (let i = 0; i < 3; i++) await act(async () => {});
};
const q = <T extends Element>(sel: string) => host.querySelector<T>(sel)!;
const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === label)!;
const click = async (el: HTMLElement) => {
  await act(async () => el.click());
  await flush();
};
const type = async (el: HTMLTextAreaElement | HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const saves = () => calls.filter((c) => c.method === 'PUT' && c.url === '/api/crew/builder');

it('keeps a Form edit when you switch to Markdown and save from there', async () => {
  await type(q<HTMLTextAreaElement>('#crew-desc'), 'Builds and tests.');
  await click(button('Markdown'));
  const md = q<HTMLTextAreaElement>('#crew-md').value;
  expect(md).toContain('description: Builds and tests.');
  // The key the form does not show is still in the file.
  expect(md).toContain('runtime: vps-agent');

  await click(button('Save'));
  expect(saves().map((c) => c.body)).toEqual([{ markdown: md }]);
});

it('reads a Markdown edit into the form, and a Form save keeps it and the keys the form does not show', async () => {
  await click(button('Markdown'));
  await type(q<HTMLTextAreaElement>('#crew-md'), '---\nruntime: vps-agent\ndescription: From the file.\ncharter_mode: append\n---\nUse pnpm.\n');
  await click(button('Form'));
  expect(q<HTMLTextAreaElement>('#crew-desc').value).toBe('From the file.');

  await type(q<HTMLTextAreaElement>('#crew-charter'), 'Use pnpm. Run the tests.');
  await click(button('Save'));
  expect(saves()).toHaveLength(1);
  const saved = saves()[0].body.markdown as string;
  expect(saved).toContain('runtime: vps-agent');
  expect(saved).toContain('description: From the file.');
  expect(saved).toContain('Use pnpm. Run the tests.');
});

it('shows the role hidden once Hide is done, offering Show', async () => {
  await click(button('Hide'));
  expect(calls.some((c) => c.url === '/api/crew/builder/hidden' && c.body.hidden === true)).toBe(true);
  expect(button('Hide')).toBeUndefined();
  expect(button('Show')).toBeDefined();
  const dialog = host.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain('Hidden');
  // The title keeps the role's name, though the app's crew list no longer has it.
  expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)?.textContent).toBe('Edit Builder');
});
