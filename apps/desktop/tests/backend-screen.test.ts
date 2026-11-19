// The server failure screen and the activity monitor's pure parts.
import { readFileSync } from 'node:fs';
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

  it('shows the message and log tail as text, with Show server log only when there is a log', () => {
    const html = screenHtml({ kind: 'failed', message: 'Port 1 <b>busy</b>', logTail: 'line <script>\n', logExists: true });
    expect(html).toContain('Server problem');
    expect(html).toContain('Port 1 &lt;b&gt;busy&lt;/b&gt;');
    expect(html).toContain('line &lt;script&gt;');
    expect(html).toContain('Last lines of the server log');
    expect(html).toContain('>Try again<');
    expect(html).toContain('>Show server log<');
    expect(html).toContain('>Quit<');
    const bare = screenHtml({ kind: 'failed', message: 'x', logTail: '', logExists: false });
    expect(bare).not.toContain('Show server log');
    expect(bare).not.toContain('Last lines of the server log');
    expect(screenHtml({ kind: 'starting', port: 4747 })).toContain('Starting the server on port 4747');
  });

  it('runs no script: its CSP allows none, and the log opens at its last line by CSS', () => {
    for (const html of [
      screenHtml({ kind: 'failed', message: 'x', logTail: 'a\nb\n', logExists: true }),
      screenHtml({ kind: 'starting', port: 4747 }),
    ]) {
      const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] ?? '';
      expect(csp).toBe("default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'");
      expect(csp).not.toContain('script-src');
      expect(html).not.toContain('<script');
    }
    expect(screenHtml({ kind: 'failed', message: 'x', logTail: 'a\nb\n', logExists: true })).toContain('<pre><span>a\nb</span></pre>');
  });

  it('announces the start and slows its spinner under reduced motion', () => {
    const html = screenHtml({ kind: 'starting', port: 4747 });
    expect(html).toContain('<p class="progress" role="status">Starting the server on port 4747</p>');
    expect(html).toContain('<div class="spinner" aria-hidden="true">');
    expect(html).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \.spinner \{ animation-duration: \d+s; \} \}/);
  });

  it("keeps the Web UI's tokens, one light-dark() value each", () => {
    const web = readFileSync(new URL('../../web/src/index.css', import.meta.url), 'utf8');
    const html = screenHtml({ kind: 'starting', port: 4747 });
    const root = /:root \{([^}]+)\}/.exec(html)![1];
    expect(html).not.toContain('prefers-color-scheme');
    const tokens = [...root.matchAll(/(--[\w-]+): ([^;]+);/g)];
    expect(tokens.length).toBe(11);
    for (const [, name, value] of tokens) {
      expect(value, name).toMatch(/^light-dark\(/);
      // The screen's --ink is its primary button, which flips with the scheme. The Web UI's --ink is status ink.
      if (name !== '--ink') expect(web, name).toContain(`  ${name}: ${value};`);
    }
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
