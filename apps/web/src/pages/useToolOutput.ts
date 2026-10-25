import { useEffect, useMemo, useRef, useState } from 'react';
import { getToolOutput, openToolTail } from '../api.ts';
import { IDLE, toolOutput, type OutputIO, type OutputTarget } from '../tool-output.ts';

/**
 * The output of one open tool row (#225). Call it where the row's body mounts: the loader starts with the body and
 * is released when the body unmounts, the target changes (a running call got its result) or the thread changes.
 */
export function useToolOutput(threadId: string, target: OutputTarget | null) {
  const io = useMemo<OutputIO>(() => ({ chunk: (event, offset, signal) => getToolOutput(threadId, event, offset, signal), tail: (tool, onData) => openToolTail(threadId, tool, onData) }), [threadId]);
  const [state, setState] = useState(IDLE);
  const loader = useRef<ReturnType<typeof toolOutput> | null>(null);
  const key = target && `${target.kind}:${target.kind === 'saved' ? target.event : target.tool}`;
  useEffect(() => {
    if (!target) {
      setState(IDLE);
      return;
    }
    const l = (loader.current = toolOutput(io, target, setState));
    return () => {
      l.release();
      if (loader.current === l) loader.current = null;
    };
    // The key says everything about the target.
  }, [io, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return { ...state, more: () => loader.current?.more() };
}
