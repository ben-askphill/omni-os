import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { api, errorText, openSSE } from '../api.ts';
import { shortPath } from '../format.ts';
import { TerminalSelectionDock, useSelectedText, useTapToPick } from './TerminalSelection.tsx';
import { Button, ErrorNote, Icon, IconButton } from './ui.tsx';

type TerminalMessage =
  | { kind: 'snapshot'; data: string; running: boolean; code: number | null }
  | { kind: 'data'; data: string }
  | { kind: 'exit'; code: number | null };

// Dark in both themes, like the sidebar: ANSI colors are picked for a dark background.
const THEME = {
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

const exitLine = (code: number | null) => `\r\n\x1b[2m[process exited${code != null ? ` with code ${code}` : ''}]\x1b[0m\r\n`;

/**
 * The thread's shell, in its working directory. The shell lives on the server: switching tabs or
 * reloading reattaches to it and replays its recent output. `readOnly` (the phone) only watches: no keys, and it
 * keeps the shell's own size instead of reflowing it to a phone's width, scrolling sideways when it is wider.
 */
export function TerminalView({ threadId, cwd, readOnly }: { threadId: string; cwd: string; readOnly?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<{ running: boolean; code: number | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped by Restart, so the stream reconnects to the fresh shell.
  const [generation, setGeneration] = useState(0);
  // The live terminal, for the dock that adds what is selected in it to the thread's next message.
  const termRef = useRef<Terminal | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const term = new Terminal({
      theme: THEME,
      fontFamily: '"SF Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: readOnly ? 11 : 12,
      lineHeight: 1.2,
      cursorBlink: !readOnly,
      disableStdin: readOnly,
      scrollback: 5000,
      allowProposedApi: false,
      macOptionIsMeta: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    termRef.current = term;
    const base = `/threads/${encodeURIComponent(threadId)}/terminal`;
    let closed = false;

    if (readOnly) {
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
        .get<{ open: boolean; cols?: number; rows?: number }>(base)
        .then((info) => {
          if (!closed && info.cols && info.rows) term.resize(info.cols, info.rows);
        })
        .catch(() => {});
      return () => {
        closed = true;
        sse.close();
        term.dispose();
      };
    }

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

    const sse = openSSE(
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
      { onDown: () => setError('Terminal disconnected. Reconnecting.') },
    );
    term.focus();

    return () => {
      closed = true;
      sse.close();
      ro.disconnect();
      clearTimeout(resizeTimer);
      input.dispose();
      resize.dispose();
      term.dispose();
    };
  }, [threadId, generation, readOnly]);

  // After the effect above, which makes the terminal: these watch it from the same render on.
  const termKey = `${threadId}:${generation}:${readOnly}`;
  const selected = useSelectedText(termRef, termKey);
  useTapToPick(termRef, host, !!readOnly, termKey);

  const restart = async () => {
    setError(null);
    try {
      await api.post(`/threads/${encodeURIComponent(threadId)}/terminal`, {});
      setGeneration((g) => g + 1);
    } catch (e) {
      setError(errorText(e));
    }
  };

  const hangUp = async () => {
    try {
      await api.del(`/threads/${encodeURIComponent(threadId)}/terminal`);
    } catch (e) {
      setError(errorText(e));
    }
  };

  const exited = state && !state.running;
  const dock = <TerminalSelectionDock threadId={threadId} cwd={cwd} term={termRef} text={selected} />;

  if (readOnly) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {error && <ErrorNote className="mb-2">{error}</ErrorNote>}
        <div className="relative min-h-0 flex-1">
          <div className="h-full overflow-auto rounded-[20px] bg-[#141518] p-3">
            <div ref={host} className="inline-block" data-terminal />
          </div>
          {dock}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col px-2.5 pb-2.5">
      <div className="flex h-8 shrink-0 items-center gap-2 px-1 text-[12px] text-fg-3">
        <Icon name="terminal" size={13} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]" title={cwd}>
          {shortPath(cwd)}
        </span>
        {exited ? (
          <Button size="sm" variant="secondary" icon="refresh" onClick={() => void restart()}>
            Restart
          </Button>
        ) : (
          <IconButton icon="trash" label="Close the shell" onClick={() => void hangUp()} disabled={!state} />
        )}
      </div>
      {error && <ErrorNote className="mb-2">{error}</ErrorNote>}
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl bg-[#141518] p-2">
        <div ref={host} className="h-full w-full" data-terminal />
        {dock}
      </div>
    </div>
  );
}
