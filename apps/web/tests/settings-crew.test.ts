// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Channel, CrewRole } from '../src/api.ts';

// Settings > Agents' agent page (`#/settings/crew/builder`): the form and Advanced > Edit as Markdown are one draft, so
// an edit in either survives a switch to the other and a save from it, and a key only the file has stays. Hide shows
// the role hidden at once. The Memory group counts the lessons that wait for you and adds one of yours. The Identity
// block is the one place the avatar is set: it opens on the agent's crew character, an SVG on a color saves with Save,
// and any source but a photo upload takes an uploaded image away.

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

const lesson = { id: 'm1', role: 'builder', channel_id: 'acme', text: 'Run the check script before you report.', status: 'proposed', proposed_by: 'agent', created_at: 1, approved_at: null, source_thread_id: 't1' };

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
      // Two lessons its threads proposed wait for you (GET /api/crew lists the count; the role's own GET does not).
      if (url === '/api/crew?all=1') return Response.json([{ ...detail.role, memoryWaiting: 2 }]);
      if (url === '/api/crew/builder/memory') {
        if (method === 'POST') return Response.json({ id: 'm-new', role: 'builder', channel_id: null, text: body.text, status: 'approved', proposed_by: 'user' }, { status: 201 });
        return Response.json({ memories: [lesson], waiting: 2 });
      }
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
  // Builder's page, as #/settings/crew/builder opens it.
  await act(async () => root.render(createElement(CrewSection, { agent: 'builder' })));
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

const toMarkdown = async () => {
  // The fold's button also carries its summary.
  await click([...host.querySelectorAll<HTMLButtonElement>('button[aria-expanded]')].find((b) => b.textContent?.startsWith('Advanced'))!);
  await click(button('Edit as Markdown'));
};

it('keeps a Form edit when you switch to Markdown and save from there', async () => {
  await type(q<HTMLTextAreaElement>('#crew-desc'), 'Builds and tests.');
  await toMarkdown();
  const md = q<HTMLTextAreaElement>('#crew-md').value;
  expect(md).toContain('description: Builds and tests.');
  // The key the form does not show is still in the file.
  expect(md).toContain('runtime: vps-agent');

  await click(button('Save'));
  expect(saves().map((c) => c.body)).toEqual([{ markdown: md }]);
});

it('reads a Markdown edit into the form, and a Form save keeps it and the keys the form does not show', async () => {
  await toMarkdown();
  await type(q<HTMLTextAreaElement>('#crew-md'), '---\nruntime: vps-agent\ndescription: From the file.\ncharter_mode: append\n---\nUse pnpm.\n');
  await click(button('Back to form'));
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
  expect(host.textContent).toContain('Hidden');
  // The page keeps the role's name, though the app's crew list no longer has it.
  expect(host.querySelector('h1')?.textContent).toBe('Builder');
});

it('counts the lessons that wait on the Memory group, lists them there, and adds one of yours for every channel', async () => {
  const waiting = [...host.querySelectorAll('section')].find((el) => el.querySelector('h2')?.textContent === 'Memory')!;
  expect(waiting.textContent).toContain('2 waiting');
  expect(host.textContent).toContain('Run the check script before you report.');
  expect(host.textContent).toContain('#acme only');

  await type(q<HTMLInputElement>('input[aria-label="New lesson"]'), 'Name the test command you ran.');
  await click(button('Add lesson'));
  expect(calls.filter((c) => c.method === 'POST' && c.url === '/api/crew/builder/memory').map((c) => c.body)).toEqual([{ text: 'Name the test command you ran.', channel: null }]);
  // Enter in the field adds it too. The editor's own form, which the tab sits in, saves nothing either way.
  await type(q<HTMLInputElement>('input[aria-label="New lesson"]'), 'Say which checks you could not run.');
  await act(async () => q<HTMLInputElement>('input[aria-label="New lesson"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  await flush();
  expect(calls.filter((c) => c.method === 'POST' && c.url === '/api/crew/builder/memory')).toHaveLength(2);
  expect(saves()).toHaveLength(0);
});

it("leaves an agent page's address alone when the Agents list sits under it, as the phone's screen stack keeps it", async () => {
  const { SettingsPage } = await import('../src/pages/Settings.tsx');
  // happy-dom fires hashchange late, after the render below; the router reads the address on the event, as in a browser.
  const go = (hash: string) => {
    location.hash = hash;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  };
  go('#/settings/crew/builder');
  await act(async () => root.render(createElement(SettingsPage, { section: 'crew' })));
  await flush();
  expect(location.hash).toBe('#/settings/crew/builder');
  // Without an agent in the address, the list still puts its section's own address in.
  go('#/settings/general');
  await act(async () => root.render(createElement(SettingsPage, { section: 'crew' })));
  await flush();
  expect(location.hash).toBe('#/settings/crew');
});

/** A choice in the radio group labelled `group`, by its text or its label. */
const radio = (group: string, label: string) => [...host.querySelectorAll<HTMLButtonElement>(`[aria-label="${group}"] [role="radio"]`)].find((b) => b.textContent?.trim() === label || b.getAttribute('aria-label') === label)!;
const pick = async (input: HTMLInputElement, file: File) => {
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
  await flush();
};
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="#283c62"/></svg>';

it('holds every avatar control in the one Identity block, and nowhere else on the page', async () => {
  expect(host.querySelectorAll('[data-agent-identity]')).toHaveLength(1);
  const identity = q('[data-agent-identity]');
  expect([...host.querySelectorAll('[aria-label="Avatar"] [role="radio"]')].map((b) => b.textContent)).toEqual(['Character', 'Emoji', 'Icon', 'Upload']);
  // An agent with no look of its own opens on its character, on the shape its id picks.
  expect(radio('Avatar', 'Character').getAttribute('aria-checked')).toBe('true');
  expect(host.querySelectorAll('[role="radiogroup"][aria-label="Shape"] [role="radio"]')).toHaveLength(17);
  expect(radio('Shape', 'Default, squircle').getAttribute('aria-checked')).toBe('true');
  expect(radio('Shape', 'Squircle, built-in')).toBeDefined();
  // No other upload, icon or color control outside the block.
  const outside = [...host.querySelectorAll('input[type="file"], input[type="color"], [aria-label="Background swatches"]')].filter((el) => !identity.contains(el));
  expect(outside).toHaveLength(0);
  expect(button('Upload image')).toBeUndefined();
});

it('saves an uploaded SVG on the background color picked, with Save', async () => {
  await click(radio('Avatar', 'Upload'));
  // A photo fills the circle, so no color shows until the file is an SVG.
  expect(host.querySelector('[aria-label="Background swatches"]')).toBeNull();
  await pick(q<HTMLInputElement>('input[aria-label="Upload an image or SVG for Builder"]'), new File([SVG], 'mark.svg', { type: 'image/svg+xml' }));
  await click(host.querySelector<HTMLButtonElement>('[aria-label="Background swatches"] button[aria-label="Azure"]')!);
  // The preview draws the SVG as an image before anything is saved.
  expect(q('[aria-label="Avatar preview"] img')?.getAttribute('src')).toContain('data:image/svg+xml');
  expect(saves()).toHaveLength(0);
  expect(host.textContent).toContain('Unsaved changes');

  await click(button('Save'));
  expect(saves().map((c) => c.body.fields.avatar)).toEqual([{ icon: `svg:${SVG}`, bg: '#0093e4' }]);
  // Builder had no uploaded image, so nothing goes to the avatar endpoint.
  expect(calls.filter((c) => c.url === '/api/crew/builder/avatar')).toHaveLength(0);
});

it('takes an uploaded photo away when another source is saved, so the preview is what shows', async () => {
  detail = { ...detail, role: { ...detail.role, avatar: { image: '/api/crew/builder/avatar?v=abcdef', icon: 'icon:zap' } } };
  state.crew = [detail.role as unknown as CrewRole];
  act(() => root.unmount());
  root = createRoot(host);
  await act(async () => root.render(createElement(CrewSection, { agent: 'builder' })));
  await flush();
  expect(radio('Avatar', 'Upload').getAttribute('aria-checked')).toBe('true');
  expect(button('Replace')).toBeDefined();
  expect(host.querySelector('[aria-label="Background swatches"]')).toBeNull();

  await click(radio('Avatar', 'Icon'));
  // The icon it had under the photo comes back as the pick.
  expect(host.querySelector('[role="radiogroup"][aria-label="Icon"] [aria-checked="true"]')?.getAttribute('aria-label')).toBe('zap');
  await click(button('Save'));
  expect(calls.filter((c) => c.method === 'PUT' && c.url === '/api/crew/builder/avatar').map((c) => c.body)).toEqual([{ image: null }]);
});
