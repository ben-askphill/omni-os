import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { api, errorText } from '../api.ts';
import { shortPath } from '../format.ts';
import { THEME, attachInteractive, attachReadOnly } from './terminal-session.ts';
import { TerminalSelectionDock, useSelectedText, useTapToPick } from './TerminalSelection.tsx';
import { Button, ErrorNote, Icon, IconButton } from './ui.tsx';

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
    const sink = { setState, setError };
    return readOnly ? attachReadOnly(term, base, sink) : attachInteractive(term, fit, el, base, sink);
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
