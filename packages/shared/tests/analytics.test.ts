import { describe, expect, it } from 'vitest';
import { cleanEvent, cleanException, configSetting, exceptionOf, fileName, harnessToken, stackFrames } from '../analytics.ts';

describe('analytics events', () => {
  it('keeps a listed event with only its listed properties, each the right kind', () => {
    expect(cleanEvent('thread_created', { harness: 'codex', source: 'manual', delegated: true, title: 'Volero PDP', prompt: 'fix it', quick: 'yes' })).toEqual({
      event: 'thread_created',
      props: { harness: 'codex', source: 'manual', delegated: true },
    });
  });

  it('drops an event it does not list', () => {
    expect(cleanEvent('message_text', { text: 'hi' })).toBeNull();
    expect(cleanEvent('__proto__', {})).toBeNull();
  });

  it('takes only short lowercase tokens, so a name or a path never passes as one', () => {
    const section = (v: unknown) => cleanEvent('screen_viewed', { surface: 'web', screen: 'thread', section: v })?.props.section;
    expect(section('changes')).toBe('changes');
    for (const bad of ['Volero', '/Users/ben/code', 'acme.myshopify.com', 'ben@example.com', 'a b', 'x'.repeat(40)]) expect(section(bad)).toBeUndefined();
    expect(cleanEvent('screen_viewed', { screen: 'secret-page' })?.props).toEqual({});
  });

  it('names a custom harness custom, never by its slug', () => {
    expect(harnessToken('custom:acme-bot')).toBe('custom');
    expect(harnessToken('claude-code')).toBe('claude-code');
    expect(harnessToken('Weird Name')).toBe('other');
    expect(harnessToken(null)).toBe('unknown');
  });

  it('names a config section, and anything else as config.other', () => {
    expect(configSetting('user')).toBe('config.user');
    expect(configSetting('automations')).toBe('config.other');
  });
});

describe('analytics exceptions', () => {
  const v8 = [
    'TypeError: Cannot read properties of undefined (reading "acme-theme") at /Users/ben/code/acme:1:2',
    '    at renderThread (http://127.0.0.1:4747/assets/Thread-abc123.js:12:34)',
    '    at async loadChannel (/Users/ben/code/omni-os/apps/server/channels-api.ts:88:5)',
    '    at /Users/ben/code/omni-os/node_modules/hono/dist/hono.js:1:2',
  ].join('\n');

  it('keeps file names and functions from a V8 stack, and never a line of the message', () => {
    expect(stackFrames(v8)).toEqual([
      { function: 'renderThread', file: 'Thread-abc123.js', line: 12, col: 34 },
      { function: 'loadChannel', file: 'channels-api.ts', line: 88, col: 5 },
      { file: 'hono.js', line: 1, col: 2 },
    ]);
  });

  it('reads a WebKit stack', () => {
    expect(stackFrames('render@http://127.0.0.1:4747/assets/index-x.js:3:9\n@http://127.0.0.1:4747/assets/index-x.js:1:1')).toEqual([
      { function: 'render', file: 'index-x.js', line: 3, col: 9 },
      { file: 'index-x.js', line: 1, col: 1 },
    ]);
  });

  it('reports an Error by its class and frames, without its message', () => {
    const err = new RangeError('store acme.myshopify.com missing');
    const e = exceptionOf(err, { source: 'server', handled: true, where: '/api/threads/:id' })!;
    expect(e.type).toBe('RangeError');
    expect(JSON.stringify(e)).not.toContain('acme');
    expect(e.where).toBe('/api/threads/:id');
  });

  it('refuses a client exception whose type or frames are not plain names', () => {
    expect(cleanException({ type: 'Error: secret value', frames: [] })).toBeNull();
    expect(cleanException({ type: 'Error', frames: [{ file: '/Users/ben/x.js' }, { file: 'ok.js', function: 'a(b)' }], where: '/api/threads/abc?token=1' })).toEqual({
      type: 'Error',
      frames: [{ file: 'ok.js' }],
      handled: false,
      source: 'web',
    });
  });

  it('takes the last part of a path or URL, without its query', () => {
    expect(fileName('http://h/a/b/index.js?v=2#x')).toBe('index.js');
    expect(fileName('C:\\Users\\ben\\x.ts')).toBe('x.ts');
  });
});
