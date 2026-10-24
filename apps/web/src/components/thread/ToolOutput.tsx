import { createContext, useContext, useLayoutEffect, useRef, type ReactNode } from 'react';
import { outputMeta } from '@omni/shared/tool-output.ts';
import { useToolOutput } from '../../pages/useToolOutput.ts';
import type { ToolCall } from '../../transcript/fold.ts';
import { outputLeft, outputTarget, outputText } from '../../tool-output.ts';
import { Button, Loader } from '../ui.tsx';
import { ClippedNote } from './HistoryEdgeRow.tsx';

/** The thread a tool row belongs to, for the requests behind its output. */
export const ThreadIdCtx = createContext('');

const Truncated = () => <div className="text-[11px] text-fg-4">Output truncated</div>;

/**
 * The body of an open tool row under its input: the call's output, or what it has printed so far. A compact result
 * shows its preview at once, swaps in the first chunk of its saved output and offers the next; a running call follows
 * its tail until the result arrives. The loader starts with this component and ends with it, so a closed row holds
 * nothing. `box` draws the text, and is the element that scrolls. `touch`: the phone's 44px buttons.
 */
export function ToolOutput({ call, running, touch = false, box }: { call: ToolCall; running: boolean; touch?: boolean; box: (text: string) => ReactNode }) {
  const r = call.result;
  const out = useToolOutput(useContext(ThreadIdCtx), outputTarget(call, running));
  const left = outputLeft(out);
  const size = touch ? 'lg' : 'sm';
  // A tail keeps its newest line in view until Ben scrolls up to read.
  const live = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  useLayoutEffect(() => {
    const el = live.current?.firstElementChild;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [out.tail]);
  if (!r) {
    return (
      <>
        {out.tail && (
          <div ref={live} onScrollCapture={(e) => (pinned.current = e.target instanceof HTMLElement && e.target.scrollHeight - e.target.scrollTop - e.target.clientHeight < 24)}>
            {box(out.tail)}
          </div>
        )}
        <div className="text-[11.5px] text-fg-4">
          {running ? 'Waiting for result' : 'No result recorded'}
          {out.skipped && ' · older output not shown'}
        </div>
      </>
    );
  }
  if (!outputMeta(r)) {
    return (
      <>
        {box(r.text)}
        {r.clipped ? <ClippedNote event={r.event} clipped={r.clipped} /> : r.truncated && <Truncated />}
      </>
    );
  }
  return (
    <>
      {box(outputText(out, r.text))}
      {out.error ? (
        <div role="alert" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-fg-3">
          <span className="min-w-0 break-words">{out.error}</span>
          <Button size={size} variant="ghost" onClick={out.more}>
            Retry
          </Button>
        </div>
      ) : left > 0 ? (
        <div>
          <Button size={size} variant="ghost" busy={out.busy} onClick={out.more}>
            Load more ({left.toLocaleString('en-US')} characters left)
          </Button>
        </div>
      ) : out.busy ? (
        <div className="flex items-center gap-1.5 text-[11.5px] text-fg-4">
          <Loader size={11} /> Loading output
        </div>
      ) : (
        out.saved.next === null && out.saved.truncated && <Truncated />
      )}
    </>
  );
}
