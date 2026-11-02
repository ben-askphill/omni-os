// The server failure screen and the activity monitor's pure parts.
import { describe, expect, it, vi } from 'vitest';

// quick-prompt.ts sets Electron switches as it loads, which needs a running app.
vi.mock('../src/quick-prompt.ts', () => ({ installQuickPrompt: () => {} }));
import { actionOf, screenHtml } from '../src/server-screen.ts';
import { isMonitorPage, monitorEnv } from '../src/activity-monitor.ts';

describe('server screen', () => {
  it('reads its buttons and nothing else', () => {
    expect(actionOf('https://omni-server-screen.invalid/try-again')).toBe('try-again');
    expect(actionOf('https://omni-server-screen.invalid/open-log')).toBe('open-log');
    expect(actionOf('https://omni-server-screen.invalid/quit')).toBe('quit');
    expect(actionOf('https://omni-server-screen.invalid/rm')).toBeNull();
    expect(actionOf('https://example.com/quit')).toBeNull();
    expect(actionOf('not a url')).toBeNull();
  });

  it('shows the message and log tail as text, with Open Log only when there is a log', () => {
    const html = screenHtml({ kind: 'failed', message: 'Port 1 <b>busy</b>', logTail: 'line <script>\n', logExists: true });
    expect(html).toContain('Server problem');
    expect(html).toContain('Port 1 &lt;b&gt;busy&lt;/b&gt;');
    expect(html).toContain('line &lt;script&gt;');
    expect(html).toContain('Last lines of the log');
    expect(html).toContain('>Try Again<');
    expect(html).toContain('>Open Log<');
    expect(html).toContain('>Quit<');
    const bare = screenHtml({ kind: 'failed', message: 'x', logTail: '', logExists: false });
    expect(bare).not.toContain('Open Log');
    expect(bare).not.toContain('Last lines of the log');
    expect(screenHtml({ kind: 'starting', port: 4747 })).toContain('Starting the server on port 4747');
  });
});

describe('activity monitor', () => {
  it('knows its page by title', () => {
    expect(isMonitorPage(200, '<html><head><title>Omni Activity</title>')).toBe(true);
    expect(isMonitorPage(200, '<title>Something else</title>')).toBe(false);
    expect(isMonitorPage(404, '<title>Omni Activity</title>')).toBe(false);
  });

  it('runs the sampler as Node on its port, with no keys or tokens', () => {
    const env = monitorEnv({ HOME: '/h', PATH: '/bin', ANTHROPIC_API_KEY: 'sk', OMNI_TOKEN: 't', CODEX_HOME: '/c' }, 4791);
    expect(env).toEqual({ HOME: '/h', PATH: '/bin', CODEX_HOME: '/c', ELECTRON_RUN_AS_NODE: '1', MONITOR_PORT: '4791' });
  });
});
