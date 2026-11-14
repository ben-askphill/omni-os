// The browser side of a thread's shell: the xterm theme and the two ways to attach a terminal to the server's stream. One
// watches (the phone), one types (the desktop). TerminalView.tsx owns the terminal itself and the chrome around it.
import type { Terminal } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';
import { api, errorText, openSSE } from '../api.ts';

export type TerminalMessage =
  | { kind: 'snapshot'; data: string; running: boolean; code: number | null }
  | { kind: 'data'; data: string }
  | { kind: 'exit'; code: number | null };

// Dark in both themes, like the sidebar: ANSI colors are picked for a dark background.
export const THEME = {
  background: '#141518',
  foreground: '#eceae5',
  cursor: '#eceae5',
  cursorAccent: '#141518',
  selectionBackground: 'rgba(236, 234, 229, 0.22)',
  black: '#2a2c31',
  red: '#ff7b72',
  green: '#7ee787',
  yellow: '#e3b341',
  blue: '#79c0ff',
  magenta: '#d2a8ff',
  cyan: '#76e3ea',
  white: '#d0cfca',
  brightBlack: '#6f6e69',
  brightRed: '#ffa198',
  brightGreen: '#aff5b4',
  brightYellow: '#f2cc60',
  brightBlue: '#a5d6ff',
  brightMagenta: '#e2c5ff',
  brightCyan: '#b3f0ff',
  brightWhite: '#ffffff',
};

export const exitLine = (code: number | null) => `\r\n\x1b[2m[process exited${code != null ? ` with code ${code}` : ''}]\x1b[0m\r\n`;


/** What a session reports back to the view. */
export interface TerminalSink {
  setState: (s: { running: boolean; code: number | null }) => void;
  setError: (message: string | null) => void;
}

/** What GET /threads/:id/terminal says about the thread's shell. */
interface ShellInfo {
  open: boolean;
  running?: boolean;
  cols?: number;
  rows?: number;
}

/**
 * Start the thread's shell if it has none, with a deliberate POST: the stream only attaches (PRD #667, no GET starts a
 * process). A shell that exited stays exited until Ben presses Restart, so this leaves an open one alone.
 */
export async function ensureShell(base: string, size: { cols: number; rows: number }): Promise<void> {
  const info = await api.get<ShellInfo>(base);
  if (!info.open) await api.post(base, size);
}

/** Watch the shell without typing: it keeps the shell's own size, so the terminal is resized to the server's. Returns the cleanup. */
export function attachReadOnly(term: Terminal, base: string, { setState, setError }: TerminalSink): () => void {
  let closed = false;
  const sse = openSSE(
    () => `/api${base}/stream`,
    (d) => {
      const m = d as TerminalMessage & { cols?: number; rows?: number };
      if (m.kind === 'snapshot') {
        term.reset();
        term.write(m.data);
        if (!m.running) term.write(exitLine(m.code));
        setState({ running: m.running, code: m.code });
        setError(null);
      } else if (m.kind === 'data') term.write(m.data);
      else if (m.kind === 'exit') {
        setState({ running: false, code: m.code });
        term.write(exitLine(m.code));
      }
    },
    { onDown: () => setError('Terminal disconnected. Reconnecting.') },
  );
  void api
    .get<ShellInfo>(base)
    .then((info) => {
      if (closed) return;
      // The phone only watches: it never starts a shell, and the stream has nothing to attach to.
      if (!info.open) {
        sse.close();
        setError('No shell is running in this thread. Open the Terminal tab on the desktop to start one.');
        return;
      }
      if (info.cols && info.rows) term.resize(info.cols, info.rows);
    })
    .catch(() => {});
  return () => {
    closed = true;
    sse.close();
    term.dispose();
  };
}

/** Type into the shell: keystrokes go out in order, the terminal is fitted to its box and the server told its size. Returns the cleanup. */
export function attachInteractive(term: Terminal, fit: FitAddon, el: HTMLElement, base: string, { setState, setError }: TerminalSink): () => void {
  let closed = false;
  try {
    fit.fit();
  } catch {
    // Not laid out yet; the observer below fits it.
  }

  // Keystrokes go out in order, batched while a request is in flight.
  let pending = '';
  let sending = false;
  const flush = async () => {
    if (sending || !pending) return;
    sending = true;
    while (pending && !closed) {
      const data = pending;
      pending = '';
      try {
        await api.post(`${base}/input`, { data });
      } catch (e) {
        // 409: the shell exited; the stream says so.
        if ((e as { status?: number }).status !== 409) setError(errorText(e));
      }
    }
    sending = false;
  };
  const input = term.onData((d) => {
    pending += d;
    void flush();
  });

  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  const resize = term.onResize(({ cols, rows }) => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => void api.post(`${base}/resize`, { cols, rows }).catch(() => {}), 80);
  });
  const ro = new ResizeObserver(() => {
    if (!el.clientWidth || !el.clientHeight) return;
    try {
      fit.fit();
    } catch {
      // detached
    }
  });
  ro.observe(el);

  // Open the shell with a POST before attaching, and again if the server restarted under a live view. Until the
  // first POST lands the stream waits, so it never asks the server to start one.
  let sse: { close: () => void } | null = null;
  const ensure = () => ensureShell(base, { cols: term.cols, rows: term.rows });
  const attach = () => {
    if (closed || sse) return;
    sse = openSSE(
      () => `/api${base}/stream?cols=${term.cols}&rows=${term.rows}`,
      (d) => {
        const m = d as TerminalMessage;
        if (m.kind === 'snapshot') {
          term.reset();
          term.write(m.data);
          if (!m.running) term.write(exitLine(m.code));
          setState({ running: m.running, code: m.code });
          setError(null);
          // The server's size may be stale from another client; tell it ours.
          if (m.running) void api.post(`${base}/resize`, { cols: term.cols, rows: term.rows }).catch(() => {});
        } else if (m.kind === 'data') term.write(m.data);
        else if (m.kind === 'exit') {
          setState({ running: false, code: m.code });
          term.write(exitLine(m.code));
        }
      },
      {
        onDown: () => {
          setError('Terminal disconnected. Reconnecting.');
          void ensure().catch(() => {});
        },
      },
    );
  };
  void ensure()
    .then(attach)
    .catch((e) => {
      if (!closed) setError(errorText(e));
    });
  term.focus();

  return () => {
    closed = true;
    sse?.close();
    ro.disconnect();
    clearTimeout(resizeTimer);
    input.dispose();
    resize.dispose();
    term.dispose();
  };
}
