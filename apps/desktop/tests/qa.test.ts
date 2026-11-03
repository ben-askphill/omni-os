import { describe, expect, it } from 'vitest';
import { appExecutable, attachRefusal, liveDataDirs, swiftUICondition, type MenuNode, parseArgs, parseScript, parseSize, parseStep, readScriptSource, refusal, resolveMenuPath, stepCeilingMs, withDeadline } from '../scripts/qa.ts';

const BASE = { port: 4766, dataDir: '/qa/data' };

describe('parseStep', () => {
  it('reads the SwiftUI harness steps that carry over', () => {
    expect(parseStep({ route: '#/settings' })).toEqual({ kind: 'route', route: '#/settings' });
    expect(parseStep({ snapshot: 'home' })).toEqual({ kind: 'screenshot', name: 'home' });
    expect(parseStep({ sleep: 1.5 })).toEqual({ kind: 'wait', ms: 1500 });
    expect(parseStep({ wait: { for: '#root', timeout: 30 } })).toEqual({ kind: 'waitFor', selector: '#root', timeoutMs: 30_000 });
    expect(parseStep({ openThread: 'abc-123' })).toEqual({ kind: 'openWindow', route: '#/t/abc-123', timeoutMs: 10_000 });
    expect(parseStep({ appearance: 'dark' })).toEqual({ kind: 'appearance', appearance: 'dark' });
    expect(parseStep({ quit: true })).toEqual({ kind: 'quit' });
  });

  it('reads waits as ms or a selector', () => {
    expect(parseStep({ wait: 250 })).toEqual({ kind: 'wait', ms: 250 });
    expect(parseStep({ wait: 'text=Settings' })).toEqual({ kind: 'waitFor', selector: 'text=Settings', timeoutMs: 10_000 });
    expect(parseStep({ wait: 'button:has-text("Send")' })).toEqual({ kind: 'waitFor', selector: 'button:has-text("Send")', timeoutMs: 10_000 });
  });

  it('refuses the SwiftUI harness conditions and names a selector to use', () => {
    expect(parseStep({ wait: 'sidebarLoaded' })).toEqual({ error: expect.stringContaining('[data-channel-id]') });
    expect(parseStep({ wait: { for: 'serverState:running', timeout: 30 } })).toEqual({ error: expect.stringContaining('SwiftUI harness condition') });
    expect(parseStep({ wait: 'connection:open' })).toEqual({ error: expect.stringContaining('drop the step') });
    expect(parseStep({ wait: 'channel:inbox' })).toEqual({ error: expect.stringContaining('[data-channel-id=\\"inbox\\"]') });
    expect(parseStep({ wait: 'thread:abc' })).toEqual({ error: expect.stringContaining('{"openThread": "abc"}') });
    expect(parseStep({ wait: 'browserFrame' })).toEqual({ error: expect.stringContaining('SwiftUI harness condition') });
    expect(swiftUICondition('thread')).toBeNull();
  });

  it('reads the page steps', () => {
    expect(parseStep({ click: 'text=Skip setup', timeout: 5 })).toEqual({ kind: 'click', selector: 'text=Skip setup', timeoutMs: 5000 });
    expect(parseStep({ fill: { selector: 'textarea', text: 'hi' } })).toEqual({ kind: 'fill', selector: 'textarea', text: 'hi', timeoutMs: 10_000 });
    expect(parseStep({ press: 'Control+K' })).toEqual({ kind: 'press', key: 'Control+K' });
    expect(parseStep({ type: 'hello' })).toEqual({ kind: 'type', text: 'hello' });
    expect(parseStep({ expect: 'h1' })).toEqual({ kind: 'expect', selector: 'h1', text: null, timeoutMs: 10_000 });
    expect(parseStep({ expect: { selector: 'h1', text: 'Settings' } })).toEqual({ kind: 'expect', selector: 'h1', text: 'Settings', timeoutMs: 10_000 });
  });

  it('reads the app steps', () => {
    expect(parseStep({ command: 'settings' })).toEqual({ kind: 'command', command: 'settings' });
    expect(parseStep({ menu: 'View > Zoom In' })).toEqual({ kind: 'menu', path: ['View', 'Zoom In'] });
    expect(parseStep({ window: 'quick-prompt' })).toEqual({ kind: 'window', target: 'quick-prompt', timeoutMs: 10_000 });
    expect(parseStep({ openWindow: '#/settings' })).toEqual({ kind: 'openWindow', route: '#/settings', timeoutMs: 10_000 });
    expect(parseStep({ zoom: 1.2 })).toEqual({ kind: 'zoom', factor: 1.2 });
    expect(parseStep({ size: [1100, 800] })).toEqual({ kind: 'size', size: { width: 1100, height: 800 } });
  });

  it('rejects a bad step with the reason', () => {
    expect(parseStep({ route: 'settings' })).toEqual({ error: expect.stringContaining('hash route') });
    expect(parseStep({ route: '#/x', click: 'a' })).toEqual({ error: expect.stringContaining('exactly one') });
    expect(parseStep({ nope: 1 })).toEqual({ error: expect.stringContaining('exactly one') });
    expect(parseStep({ command: 'reboot' })).toEqual({ error: expect.stringContaining('command is one of') });
    expect(parseStep({ window: 'settings' })).toEqual({ error: expect.stringContaining('main, quick-prompt or newest') });
    expect(parseStep({ screenshot: '../escape' })).toEqual({ error: expect.stringContaining('file name') });
    expect(parseStep({ menu: 'Quit' })).toEqual({ error: expect.stringContaining('path') });
    expect(parseStep({ openThread: 'a/b' })).toEqual({ error: expect.stringContaining('thread id') });
    expect(parseStep({ wait: { for: 'x', timeout: 0 } })).toEqual({ error: expect.stringContaining('seconds') });
    expect(parseStep('route')).toEqual({ error: expect.stringContaining('object') });
  });
});

describe('parseScript', () => {
  it('takes an object with the run settings, and flags win', () => {
    const script = parseScript({ ...BASE, appearance: 'light', zoom: 1.1, size: { width: 1200, height: 800 }, steps: [{ snapshot: 'home' }] }, { appearance: 'dark', port: 4777 });
    expect(script).toEqual({
      port: 4777,
      dataDir: '/qa/data',
      appUrl: null,
      appearance: 'dark',
      zoom: 1.1,
      size: { width: 1200, height: 800 },
      steps: [{ kind: 'screenshot', name: 'home' }],
    });
  });

  it('takes a bare list of steps when the flags name the server', () => {
    const script = parseScript([{ route: '#/' }], { port: 4766, dataDir: '/qa/data' });
    expect(script).toMatchObject({ port: 4766, dataDir: '/qa/data', appearance: null, zoom: null, size: null });
  });

  it('takes the URL of a Vite in front of the stack, without a path', () => {
    expect(parseScript({ ...BASE, appUrl: 'http://127.0.0.1:4786/', steps: [{ quit: true }] })).toMatchObject({ appUrl: 'http://127.0.0.1:4786' });
    expect(parseScript({ ...BASE, appUrl: 'file:///x', steps: [{ quit: true }] })).toEqual({ error: expect.stringContaining('appUrl') });
    expect(parseArgs(['--script', 'x', '--out', 'y', '--app-url', 'http://127.0.0.1:4786'])).toMatchObject({ overrides: { appUrl: 'http://127.0.0.1:4786' } });
  });

  it('needs a port, a data dir and steps', () => {
    expect(parseScript({ dataDir: '/qa', steps: [{ quit: true }] })).toEqual({ error: expect.stringContaining('port') });
    expect(parseScript({ port: 4766, steps: [{ quit: true }] })).toEqual({ error: expect.stringContaining('dataDir') });
    expect(parseScript({ ...BASE, steps: [] })).toEqual({ error: expect.stringContaining('no steps') });
    expect(parseScript({ ...BASE })).toEqual({ error: expect.stringContaining('list of steps') });
  });

  it('names the step that is wrong', () => {
    expect(parseScript({ ...BASE, steps: [{ route: '#/' }, { zoom: 9 }] })).toEqual({ error: expect.stringMatching(/^step 2: zoom/) });
    expect(parseScript({ ...BASE, appearance: 'sepia', steps: [{ quit: true }] })).toEqual({ error: expect.stringContaining('appearance') });
  });
});

describe('refusal', () => {
  it('refuses the live port and a checkout data dir', () => {
    expect(refusal({ port: 4747, dataDir: '/qa/data' }, [])).toMatch(/4747/);
    expect(refusal({ port: 4766, dataDir: '/repo/data/' }, ['/repo/data'])).toMatch(/live data dir/);
    expect(refusal({ port: 4766, dataDir: '/link' }, ['/repo/data'], (p) => (p === '/link' ? '/repo/data' : p))).toMatch(/live data dir/);
    expect(refusal({ port: 4766, dataDir: '/qa/data' }, ['/repo/data'])).toBeNull();
  });

  it('counts the main checkout of a worktree as live', () => {
    expect(liveDataDirs('/wt/omni', () => '/home/me/omni-os/.git')).toEqual(['/wt/omni/data', '/home/me/omni-os/data']);
    expect(liveDataDirs('/home/me/omni-os', () => '/home/me/omni-os/.git')).toEqual(['/home/me/omni-os/data']);
    expect(liveDataDirs('/x/omni', () => null)).toEqual(['/x/omni/data']);
  });
});

describe('attachRefusal', () => {
  it('attaches only to a server that proves it holds the data dir', () => {
    expect(attachRefusal({ kind: 'omni' }, 4766, '/qa/data')).toBeNull();
    expect(attachRefusal({ kind: 'free' }, 4766, '/qa/data')).toMatch(/nothing answers.*qa-stack\.sh up/);
    expect(attachRefusal({ kind: 'no-token' }, 4766, '/qa/data')).toMatch(/no api-token/);
    expect(attachRefusal({ kind: 'not-this-install' }, 4766, '/qa/data')).toMatch(/does not hold/);
    expect(attachRefusal({ kind: 'slow' }, 4766, '/qa/data')).toMatch(/did not answer/);
    expect(attachRefusal({ kind: 'not-omni', detail: 'nothing answered as HTTP' }, 4766, '/qa/data')).toMatch(/not an Omni server/);
  });
});

describe('the step ceiling', () => {
  it('outlasts the step\'s own timeouts', () => {
    expect(stepCeilingMs({ kind: 'expect', selector: 'h1', text: 'x', timeoutMs: 5000 })).toBe(40_000);
    expect(stepCeilingMs({ kind: 'wait', ms: 60_000 })).toBe(90_000);
    expect(stepCeilingMs({ kind: 'screenshot', name: 'x' })).toBe(40_000);
  });

  it('fails work that never answers, and passes work that does', async () => {
    await expect(withDeadline(new Promise(() => {}), 20, 'stuck')).rejects.toThrow('stuck');
    await expect(withDeadline(Promise.resolve(7), 1000, 'stuck')).resolves.toBe(7);
  });
});

describe('parseArgs', () => {
  it('reads the flags', () => {
    expect(parseArgs(['--script', 'run.json', '--out=shots', '--port', '4766', '--data-dir', '/qa/data', '--appearance', 'dark', '--zoom', '1.2', '--size', '1100x800', '--app', 'Omni.app'])).toEqual({
      script: 'run.json',
      out: 'shots',
      app: 'Omni.app',
      overrides: { port: 4766, dataDir: '/qa/data', appearance: 'dark', zoom: 1.2, size: { width: 1100, height: 800 } },
    });
  });

  it('needs a script and an out folder, and refuses what it does not know', () => {
    expect(parseArgs(['--out', 'x'])).toEqual({ error: '--script is required' });
    expect(parseArgs(['--script', 'x'])).toEqual({ error: '--out is required' });
    expect(parseArgs(['--script', 'x', '--out', 'y', '--port', '0'])).toEqual({ error: expect.stringContaining('--port') });
    expect(parseArgs(['--script', 'x', '--out', 'y', '-serverPort', '4766'])).toEqual({ error: 'unknown argument -serverPort' });
  });
});

describe('readScriptSource', () => {
  it('takes the JSON itself or a path to it', () => {
    expect(readScriptSource('[{"quit": true}]', () => '')).toEqual([{ quit: true }]);
    expect(readScriptSource('run.json', (p) => (p === 'run.json' ? '{"steps": []}' : ''))).toEqual({ steps: [] });
    expect(readScriptSource('missing.json', () => { throw new Error('ENOENT'); })).toEqual({ error: expect.stringContaining('cannot read') });
    expect(readScriptSource('{nope', () => '')).toEqual({ error: expect.stringContaining('not JSON') });
  });
});

describe('resolveMenuPath', () => {
  const item = (label: string, items: MenuNode[] = [], more: Partial<MenuNode> = {}): MenuNode => ({ label, visible: true, enabled: true, items, ...more });
  const menu = [
    item('&File', [item('&Quick Prompt…'), item('', [], { enabled: false }), item('Close Window')]),
    item('View', [item('Zoom In'), item('Hidden', [], { visible: false }), item('Actual Size', [], { enabled: false })]),
  ];

  it('matches labels without the mnemonic, the ellipsis or case', () => {
    expect(resolveMenuPath(menu, ['File', 'Quick Prompt'])).toEqual([0, 0]);
    expect(resolveMenuPath(menu, ['file', 'close window'])).toEqual([0, 2]);
    expect(resolveMenuPath(menu, ['View', 'Zoom In...'])).toEqual([1, 0]);
  });

  it('says why a path does not reach an item', () => {
    expect(resolveMenuPath(menu, ['Edit', 'Copy'])).toEqual({ error: 'no menu item "Edit" (have: &File, View)' });
    expect(resolveMenuPath(menu, ['View', 'Hidden'])).toEqual({ error: expect.stringContaining('no menu item "Hidden"') });
    expect(resolveMenuPath(menu, ['View', 'Actual Size'])).toEqual({ error: '"Actual Size" is disabled' });
  });
});

describe('appExecutable and parseSize', () => {
  it('finds the binary inside Omni.app, and takes anything else as is', () => {
    expect(appExecutable('/Applications/Omni.app', () => ['Omni'])).toBe('/Applications/Omni.app/Contents/MacOS/Omni');
    expect(appExecutable('/x/Omni.AppImage', () => [])).toBe('/x/Omni.AppImage');
  });

  it('reads a size in three shapes and keeps it sane', () => {
    expect(parseSize('1100x800')).toEqual({ width: 1100, height: 800 });
    expect(parseSize({ width: 390, height: 844 })).toEqual({ width: 390, height: 844 });
    expect(parseSize([10, 10])).toBeNull();
  });
});
