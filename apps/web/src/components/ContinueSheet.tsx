import { useEffect, useMemo, useReducer, useState } from 'react';
import type { ContinueBlock, ContinuePreview } from '@omni/shared/continue.ts';
import { api, errorText, useApi, type HarnessWithRunning, type Thread } from '../api.ts';
import {
  blockOf,
  canStart,
  closesTerminal,
  continueReducer,
  continueTargets,
  defaultRun,
  initContinue,
  previewSections,
  refusalText,
  shownPreview,
  sizeLine,
  slashHint,
  startBody,
  startError,
  workspaceText,
  type ContinueSource,
  type ContinueState,
  type ContinueTargets,
  type PreviewRow,
  type PreviewSection,
} from '../continue.ts';
import { href, navigate } from '../router.ts';
import { EffortPicker, ModelPicker } from './ModelPicker.tsx';
import { Button, Chip, ErrorNote, Icon, Label, Loading, Modal, type ChipTone } from './ui.tsx';

/**
 * One continue sheet's state, for the desktop and the phone: the picked run's preview, asked again whenever the run
 * changes or Ben checks again, and Start. `onStarted` gets the new thread.
 */
export function useContinue(source: ContinueSource, offered: HarnessWithRunning[], onStarted: (t: Thread) => void) {
  const [s, dispatch] = useReducer(continueReducer, offered, (o) => initContinue(defaultRun(o, source.harness)));
  const { run, asked } = s;
  useEffect(() => {
    if (!run) return;
    // A later ask replaces this one: its answer, if it comes last, is stale.
    let alive = true;
    api
      .post<ContinuePreview>(`/threads/${encodeURIComponent(source.id)}/continue/preview`, run)
      .then((preview) => alive && dispatch({ type: 'previewed', run, preview }))
      .catch((e) => alive && dispatch({ type: 'previewFailed', run, error: errorText(e) }));
    return () => {
      alive = false;
    };
  }, [source.id, run, asked]);

  const [closing, setClosing] = useState(false);
  const closeTerminal = async () => {
    setClosing(true);
    try {
      await api.del(`/threads/${encodeURIComponent(source.id)}/terminal`);
      dispatch({ type: 'recheck' });
    } catch (e) {
      dispatch({ type: 'refused', error: { kind: 'error', error: errorText(e) } });
    } finally {
      setClosing(false);
    }
  };

  const start = async () => {
    if (!canStart(s) || !s.run || s.preview.kind !== 'ready') return;
    const { body, attempt } = startBody(s.run, s.text, s.preview.preview.revision, s.attempt);
    dispatch({ type: 'posting', attempt });
    try {
      const res = await api.post<{ thread: Thread; duplicate: boolean }>(`/threads/${encodeURIComponent(source.id)}/continue`, body);
      onStarted(res.thread);
    } catch (e) {
      dispatch({ type: 'refused', error: startError(e) });
    }
  };
  return { s, dispatch, start, recheck: () => dispatch({ type: 'recheck' }), closeTerminal, closing };
}

/** Why the source cannot be continued yet, with Retry, and "Close terminal" when an open shell is why. */
export function BlockNote({ block, onRecheck, onCloseTerminal, closing }: { block: ContinueBlock; onRecheck: () => void; onCloseTerminal: () => void; closing: boolean }) {
  return (
    <ErrorNote onRetry={onRecheck}>
      {block.message}
      {closesTerminal(block) && (
        <div className="mt-2 whitespace-normal">
          <Button size="sm" icon="terminal" busy={closing} onClick={onCloseTerminal}>
            Close terminal
          </Button>
        </div>
      )}
    </ErrorNote>
  );
}

const OPEN_EVENT = 'omni:continue-thread';

/** Open the sheet that continues `source` on another harness, as the thread actions' item does. */
export function openContinue(source: ContinueSource) {
  window.dispatchEvent(new CustomEvent<ContinueSource>(OPEN_EVENT, { detail: source }));
}

/** Mounted once in the desktop app, so the thread actions open the sheet for any thread, open or not. */
export function ContinueSheetHost() {
  const [source, setSource] = useState<ContinueSource | null>(null);
  useEffect(() => {
    const onOpen = (e: Event) => setSource((e as CustomEvent<ContinueSource>).detail);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);
  return source ? <ContinueSheet key={source.id} source={source} onClose={() => setSource(null)} /> : null;
}

/** "Continue with another harness": pick a local run, read what the new thread will be given, write the first message. */
export function ContinueSheet({ source, onClose }: { source: ContinueSource; onClose: () => void }) {
  const { data: catalog, error, reload } = useApi<HarnessWithRunning[]>('/harnesses');
  const targets = useMemo(() => (catalog ? continueTargets(catalog) : null), [catalog]);
  return (
    <Modal open onClose={onClose} wide title="Continue with another harness">
      {targets ? (
        <ContinueForm source={source} targets={targets} onPickerOpen={reload} onClose={onClose} />
      ) : error ? (
        <ErrorNote className="mx-6 mb-6" onRetry={reload}>
          {error}
        </ErrorNote>
      ) : (
        <div className="px-6 pb-4">
          <Loading label="Loading harnesses" />
        </div>
      )}
    </Modal>
  );
}

function ContinueForm({ source, targets, onPickerOpen, onClose }: { source: ContinueSource; targets: ContinueTargets; onPickerOpen: () => void; onClose: () => void }) {
  const { s, dispatch, start, recheck, closeTerminal, closing } = useContinue(source, targets.offered, (t) => {
    onClose();
    navigate(href.thread(t.id));
  });
  const { run } = s;
  const note = refusalText(s.refusal);
  const hint = slashHint(s.text);
  return (
    <div className="grid gap-x-8 gap-y-6 px-6 pt-1 pb-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <div className="flex min-w-0 flex-col gap-4">
        <p className="text-[13px] leading-relaxed text-fg-2">
          A new thread picks up <span className="text-fg">{source.title || 'this thread'}</span> on the harness you pick, with its own branch and session. The two threads link to each other.
        </p>
        <div>
          <Label hint={run ? undefined : 'No local harness is ready. The list says how to set one up.'}>Continue on</Label>
          <div className="flex flex-wrap items-center gap-1.5">
            <ModelPicker
              harnesses={targets.offered}
              value={{ harness: run?.harness ?? '', model: run?.model ?? '' }}
              offerAuto={false}
              onOpen={onPickerOpen}
              disabled={s.posting}
              onChange={(c) => dispatch({ type: 'pick', run: { harness: c.harness, model: c.model, effort: '' } })}
            />
            {run && (
              <EffortPicker
                harnesses={targets.offered}
                choice={{ harness: run.harness, model: run.model }}
                value={run.effort}
                disabled={s.posting}
                onChange={(effort) => dispatch({ type: 'pick', run: { ...run, effort } })}
              />
            )}
          </div>
          {targets.refused.length > 0 && (
            <ul className="mt-2 space-y-1 px-1 text-[12px] leading-snug text-fg-3">
              {targets.refused.map((r) => (
                <li key={r.id}>{r.reason}</li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <Label htmlFor="continue-message" hint="It reads this after the carryover, and it is never cut.">
            Your message
          </Label>
          <textarea
            id="continue-message"
            autoFocus
            rows={6}
            value={s.text}
            placeholder="What should it do next?"
            className="field min-h-[132px] resize-y leading-relaxed"
            onChange={(e) => dispatch({ type: 'text', text: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void start();
              }
            }}
          />
          {hint && <p className="mt-1.5 px-1 text-[12px] leading-snug text-fg-3">{hint}</p>}
        </div>
        {note && <ErrorNote>{note}</ErrorNote>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" busy={s.posting} disabled={!canStart(s)} onClick={() => void start()}>
            Start
          </Button>
        </div>
      </div>
      {run && <PreviewPane s={s} onRecheck={recheck} onCloseTerminal={() => void closeTerminal()} closing={closing} />}
    </div>
  );
}

function PreviewPane({ s, onRecheck, onCloseTerminal, closing }: { s: ContinueState; onRecheck: () => void; onCloseTerminal: () => void; closing: boolean }) {
  const p = shownPreview(s.preview);
  const block = blockOf(s);
  const loading = s.preview.kind === 'loading';
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3 px-1">
        <span className="caption">Carryover</span>
        {p && <span className="font-num text-[11.5px] text-fg-3">{sizeLine(p.carryover)}</span>}
      </div>
      {block && <BlockNote block={block} onRecheck={onRecheck} onCloseTerminal={onCloseTerminal} closing={closing} />}
      {s.preview.kind === 'failed' && <ErrorNote onRetry={onRecheck}>{s.preview.error}</ErrorNote>}
      {loading && !p && <Loading label="Building the preview" />}
      {p && (
        <div aria-busy={loading || undefined} className={`flex flex-col gap-3 transition-opacity ${loading ? 'opacity-50' : ''}`}>
          <p className="px-1 text-[12.5px] leading-snug text-fg-3">{workspaceText(p)}</p>
          {previewSections(p.carryover).map((sec) => (
            <SectionView key={sec.id} section={sec} />
          ))}
          <ExactText text={p.carryover.text} />
        </div>
      )}
    </div>
  );
}

/** A preview row's tag: a check's result in its status colour, any other word quiet. */
export const rowTone = (r: PreviewRow): ChipTone => (r.tone === 'pass' ? 'done' : r.tone === 'fail' ? 'needs' : 'outline');

function SectionView({ section }: { section: PreviewSection }) {
  return (
    <section>
      <div className="mb-1 flex items-baseline gap-1.5 px-1">
        <span className="caption">{section.title}</span>
        {section.count != null && <span className="font-num text-[11px] text-fg-4">{section.count}</span>}
      </div>
      <div className="divide-y divide-line rounded-[18px] bg-surface">
        {section.rows.map((r) => (
          <div key={r.key} className="flex min-w-0 items-start gap-2.5 px-3.5 py-2 text-[12.5px] leading-snug">
            {r.label && <span className="w-12 shrink-0 text-fg-3">{r.label}</span>}
            <div className="min-w-0 flex-1">
              <div className={`line-clamp-4 break-words whitespace-pre-wrap text-fg ${r.code ? 'font-mono text-[11.5px]' : ''}`}>{r.text}</div>
              {r.sub && <div className={`mt-0.5 line-clamp-2 break-words whitespace-pre-wrap text-[11.5px] text-fg-3 ${r.subCode ? 'font-mono' : ''}`}>{r.sub}</div>}
            </div>
            {r.tag && <Chip tone={rowTone(r)}>{r.tag}</Chip>}
          </div>
        ))}
        {section.more && <div className="px-3.5 py-2 text-[12px] text-fg-3">{section.more}</div>}
      </div>
    </section>
  );
}

/** The Carryover exactly as the new session reads it, folded until asked for. */
export function ExactText({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="inline-flex items-center gap-1 px-1 text-[12.5px] font-medium text-fg-2 hover:text-fg">
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={13} />
        Show exact text
      </button>
      {open && (
        <pre className="scroll-thin mt-1.5 max-h-[360px] overflow-auto rounded-xl bg-surface px-3 py-2.5 font-mono text-[11.5px] leading-relaxed break-words whitespace-pre-wrap text-fg-2">{text}</pre>
      )}
    </div>
  );
}
