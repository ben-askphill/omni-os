import type { CreateThreadRequest, CrewRole, Thread } from '@omni/client-core';
import { useCallback, useEffect, useRef, useState } from 'react';

import { toUploadFiles, type Staged } from '../attachments/model';
import { useLiveHub } from '../live/react';
import { attemptFor, newThreadId, startThread, type Attempt, type CreateFailure } from './draft';

/** Null while the roles load, and empty if the request fails. */
export function useCrew(): CrewRole[] | null {
  const hub = useLiveHub();
  const [crew, setCrew] = useState<CrewRole[] | null>(null);
  useEffect(() => {
    let live = true;
    hub
      .request((api) => api.crew())
      .then((roles) => live && setCrew(roles))
      .catch(() => live && setCrew([]));
    return () => {
      live = false;
    };
  }, [hub]);
  return crew;
}

export type StartState = { status: 'idle' } | { status: 'starting' } | { status: 'failed'; failure: CreateFailure };

const IDLE: StartState = { status: 'idle' };

/** One request is out at a time. A retry of the same request reuses its id (see attemptFor). */
export function useStartThread() {
  const hub = useLiveHub();
  const [state, setState] = useState<StartState>(IDLE);
  const [progress, setProgress] = useState<number | null>(null);
  const attempt = useRef<Attempt | null>(null);
  const uploading = useRef<AbortController | null>(null);
  const out = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const start = useCallback(
    async (request: Omit<CreateThreadRequest, 'id'>, files: readonly Staged[] = []): Promise<Thread | null> => {
      if (out.current) return null;
      out.current = true;
      setState({ status: 'starting' });
      attempt.current = attemptFor(attempt.current, request, newThreadId, files);
      const controller = files.length ? new AbortController() : null;
      uploading.current = controller;
      const withFiles = controller && {
        files: toUploadFiles(files),
        signal: controller.signal,
        onProgress: ({ sent, total }: { sent: number; total: number }) => {
          if (mounted.current && total > 0) setProgress(Math.min(1, Math.floor((sent / total) * 100) / 100));
        },
      };
      const outcome = await startThread((body) => hub.request((api) => api.createThread(body, withFiles ?? undefined)), { ...request, id: attempt.current.id });
      uploading.current = null;
      out.current = false;
      if (mounted.current) setProgress(null);
      if (outcome.kind === 'created') {
        hub.applyThread(outcome.thread);
        return outcome.thread;
      }
      if (mounted.current) setState({ status: 'failed', failure: outcome.failure });
      return null;
    },
    [hub],
  );

  const dismiss = useCallback(() => setState((s) => (s.status === 'failed' ? IDLE : s)), []);
  const cancel = useCallback(() => uploading.current?.abort(), []);
  return { state, start, dismiss, progress, cancel };
}
