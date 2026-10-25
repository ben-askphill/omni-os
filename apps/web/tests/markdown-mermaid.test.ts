// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Markdown } from '../src/components/Markdown.tsx';

const library = vi.hoisted(() => ({ loaded: vi.fn(), initialize: vi.fn(), render: vi.fn() }));
vi.mock('mermaid', () => {
  library.loaded();
  return { default: { initialize: library.initialize, render: library.render } };
});

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) });
  document.documentElement.dataset.theme = 'light';
  document.documentElement.style.colorScheme = 'light';
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  library.initialize.mockClear();
  library.render.mockReset().mockResolvedValue({ svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>Air to Relay</text></svg>' });
});
afterEach(async () => { await act(() => root.unmount()); host.remove(); });
const flush = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); }); };
const show = async (text: string) => { await act(() => root.render(createElement(Markdown, { text }))); await flush(); };

describe('mermaid in shared Markdown', () => {
  it('keeps ordinary fences and inline code without loading mermaid', async () => {
    await show('`mermaid`\n\n```js\nconst n = 1;\n```');
    expect(library.loaded).not.toHaveBeenCalled();
    expect(host.querySelector('pre > code.language-js')?.textContent).toBe('const n = 1;\n');
  });

  it('renders a mermaid fence as inline SVG and rerenders on a theme change', async () => {
    await show('Before.\n\n```mermaid\nflowchart LR\nAir <--> Relay\n```\n\nAfter.');
    expect(library.loaded).toHaveBeenCalledTimes(1);
    expect(library.render).toHaveBeenCalledWith(expect.stringMatching(/^omni-mermaid-/), 'flowchart LR\nAir <--> Relay\n');
    expect(host.querySelector('[role="img"] svg')).not.toBeNull();
    expect(host.textContent).toContain('After.');
    expect(library.initialize).toHaveBeenLastCalledWith(expect.objectContaining({ theme: 'base', securityLevel: 'strict', startOnLoad: false }));
    document.documentElement.dataset.theme = 'dark';
    document.documentElement.style.colorScheme = 'dark';
    await flush();
    expect(library.initialize).toHaveBeenLastCalledWith(expect.objectContaining({ theme: 'dark' }));
  });

  it('keeps source and surrounding prose when parsing fails, then recovers as the streamed fence completes', async () => {
    library.render.mockRejectedValueOnce(new Error('incomplete diagram'));
    await show('Before.\n\n```mermaid\nflowchart LR\nbroken[\n```\n\nAfter.');
    expect(host.querySelector('pre > code.language-mermaid')?.textContent).toBe('flowchart LR\nbroken[\n');
    expect(host.textContent).toContain('Before.');
    expect(host.textContent).toContain('After.');
    await show('```mermaid\nflowchart LR\nAir --> Relay\n```');
    expect(host.querySelector('svg')).not.toBeNull();
  });

  it('does not let a late render replace a newer streamed fence', async () => {
    let resolve!: (value: { svg: string }) => void;
    library.render.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    await show('```mermaid\nflowchart LR\nOld --> Graph\n```');
    await act(() => root.render(createElement(Markdown, { text: '```mermaid\nflowchart LR\nNew --> Graph\n```' })));
    resolve({ svg: '<svg><text>Old graph</text></svg>' });
    await flush();
    expect(host.textContent).not.toContain('Old graph');
    expect(host.querySelector('svg')).not.toBeNull();
  });
});
