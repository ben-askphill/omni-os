import { useMemo, useState } from 'react';
import { useApi, type HarnessWithRunning, type Thread } from '../api.ts';
import { HarnessLogo, harnessLabel } from '../components/brand.tsx';
import { BlockNote, ExactText, rowTone, useContinue } from '../components/ContinueSheet.tsx';
import { Button, Chip, ErrorNote, Toggle } from '../components/ui.tsx';
import {
  attachmentRows,
  attachmentsSummary,
  blockOf,
  canStart,
  continueTargets,
  previewSections,
  refusalText,
  shownPreview,
  sizeLine,
  slashHint,
  workspaceText,
  type ContinueSource,
  type ContinueTargets,
  type PreviewSection,
} from '../continue.ts';
import { href } from '../router.ts';
import { ModelSheet, runLabel } from './ModelSheet.tsx';
import { MoEmpty, MoGroup, MoListRow, MoSection, MoSheet } from './parts.tsx';
import { useShell } from './shell.tsx';

const TITLE = 'Continue with another harness';

function Top({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex shrink-0 items-center px-3 pt-1.5 pb-2">
      <button type="button" onClick={onClose} className="w-[60px] px-1.5 py-2 text-left text-[15px]">
        Cancel
      </button>
      <span className="min-w-0 flex-1 truncate text-center text-[15px] font-medium">{TITLE}</span>
      <span className="w-[60px]" />
    </div>
  );
}

/** The phone's "Continue with another harness", on the desktop sheet's state: the run, the Carryover, the message. */
export function ContinueSheet({ source }: { source: ContinueSource }) {
  const shell = useShell();
  const close = () => shell.sheet(null);
  const { data: catalog, error, reload } = useApi<HarnessWithRunning[]>('/harnesses');
  const targets = useMemo(() => (catalog ? continueTargets(catalog) : null), [catalog]);
  if (!targets) {
    return (
      <MoSheet full onClose={close} label={TITLE}>
        <Top onClose={close} />
        {error ? (
          <ErrorNote className="mx-4" onRetry={reload}>
            {error}
          </ErrorNote>
        ) : (
          <MoEmpty>Loading</MoEmpty>
        )}
      </MoSheet>
    );
  }
  return (
    <Sheet
      source={source}
      targets={targets}
      onPickerOpen={reload}
      onClose={close}
      onStarted={(t) => {
        close();
        shell.open(href.thread(t.id));
      }}
    />
  );
}

function Sheet({
  source,
  targets,
  onPickerOpen,
  onClose,
  onStarted,
}: {
  source: ContinueSource;
  targets: ContinueTargets;
  onPickerOpen: () => void;
  onClose: () => void;
  onStarted: (t: Thread) => void;
}) {
  const { s, dispatch, start, recheck, closeTerminal, closing } = useContinue(source, targets.offered, onStarted);
  const [picking, setPicking] = useState(false);
  const { run } = s;
  const p = shownPreview(s.preview);
  const block = blockOf(s);
  const note = refusalText(s.refusal);
  const hint = slashHint(s.text);
  const loading = s.preview.kind === 'loading';
  return (
    <>
      <MoSheet full onClose={onClose} label={TITLE}>
        <Top onClose={onClose} />
        <div className="mo-scroll flex min-h-0 flex-1 flex-col gap-[22px] overflow-y-auto pb-3">
          <p className="m-0 px-5 text-[13px] leading-[1.45] text-pretty text-fg-3">
            A new thread picks up <span className="text-fg">{source.title || 'this thread'}</span> on the harness you pick. The two threads link to each other.
          </p>
          <MoSection title="Continue on">
            <MoGroup>
              <MoListRow
                icon={
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-surface-2 text-fg">
                    {run ? <HarnessLogo harness={run.harness} size={13} /> : null}
                  </span>
                }
                label={run ? runLabel(targets.offered, run, run.effort) : 'Pick a model'}
                sub={run ? harnessLabel(run.harness) : 'No local harness is ready'}
                disabled={s.posting}
                onClick={() => {
                  onPickerOpen();
                  setPicking(true);
                }}
                last
              />
            </MoGroup>
            {targets.refused.map((r) => (
              <p key={r.id} className="m-0 px-1 text-[12.5px] leading-[1.4] text-pretty text-fg-3">
                {r.reason}
              </p>
            ))}
          </MoSection>
          {p && p.carryover.attachments.length > 0 && (
            <MoSection title="Attachments">
              <MoGroup>
                {attachmentRows(p.carryover).map((r, i, all) => (
                  <div key={r.id} className={`flex items-start gap-3 px-4 py-2.5 ${i < all.length - 1 ? 'border-b border-line' : ''}`}>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className={`truncate text-[14px] leading-[1.4] ${r.selectable ? '' : 'text-fg-3'}`}>{r.name}</span>
                        {r.tag && <Chip tone="outline">{r.tag}</Chip>}
                      </span>
                      <span className="text-[12.5px] leading-[1.35] text-fg-3 tabular-nums">{r.meta}</span>
                      <span className="text-[12.5px] leading-[1.35] text-pretty text-fg-3">{r.note}</span>
                    </span>
                    <Toggle checked={r.selected} disabled={s.posting || !r.selectable} label={`Carry ${r.name}`} onChange={() => dispatch({ type: 'attach', id: r.id })} />
                  </div>
                ))}
              </MoGroup>
              <p className="m-0 px-1 text-[12.5px] leading-[1.4] text-fg-3">{attachmentsSummary(p.carryover)}</p>
            </MoSection>
          )}
          <div className="flex flex-col gap-2.5 px-3">
            <div className="rounded-[26px] bg-surface px-2 pt-3 pb-2.5">
              <textarea
                value={s.text}
                onChange={(e) => dispatch({ type: 'text', text: e.target.value })}
                rows={4}
                aria-label="Your message"
                placeholder="What should it do next? It reads this after the carryover."
                className="w-full resize-none bg-transparent px-2 text-[16px] leading-[1.45] text-fg outline-none placeholder:text-fg-4"
              />
            </div>
            {hint && <p className="m-0 px-3 text-[12.5px] leading-[1.4] text-fg-3">{hint}</p>}
            {block && <BlockNote block={block} onRecheck={recheck} onCloseTerminal={() => void closeTerminal()} closing={closing} />}
            {note && <ErrorNote>{note}</ErrorNote>}
            <Button variant="primary" size="lg" busy={s.posting} disabled={!canStart(s)} onClick={() => void start()}>
              Start
            </Button>
          </div>
          {run && (
            <MoSection title="Carryover" right={p && <span className="text-[12px] leading-[1.3] text-fg-4 tabular-nums">{sizeLine(p.carryover)}</span>}>
              {s.preview.kind === 'failed' ? (
                <ErrorNote onRetry={recheck}>{s.preview.error}</ErrorNote>
              ) : (
                <p className="m-0 px-1 text-[13px] leading-[1.45] text-fg-3">{p ? workspaceText(p) : 'Building the preview'}</p>
              )}
            </MoSection>
          )}
          {run && p && (
            <div aria-busy={loading || undefined} className={`flex flex-col gap-[22px] transition-opacity ${loading ? 'opacity-50' : ''}`}>
              {previewSections(p.carryover).map((sec) => (
                <Section key={sec.id} section={sec} />
              ))}
              <div className="px-4">
                <ExactText text={p.carryover.text} />
              </div>
            </div>
          )}
        </div>
      </MoSheet>
      {picking && (
        <ModelSheet
          harnesses={targets.offered}
          choice={{ harness: run?.harness ?? '', model: run?.model ?? '' }}
          effort={run?.effort ?? ''}
          offerAuto={false}
          onChange={(choice, effort) => dispatch({ type: 'pick', run: { harness: choice.harness, model: choice.model, effort } })}
          onClose={() => setPicking(false)}
        />
      )}
    </>
  );
}

function Section({ section }: { section: PreviewSection }) {
  const lines = section.rows.length + (section.more ? 1 : 0);
  return (
    <MoSection title={section.title} count={section.count}>
      <MoGroup>
        {section.rows.map((r, i) => (
          <div key={r.key} className={`flex items-start gap-2.5 px-4 py-2.5 ${i < lines - 1 ? 'border-b border-line' : ''}`}>
            {r.label && <span className="w-[52px] shrink-0 text-[13px] leading-[1.4] text-fg-3">{r.label}</span>}
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className={`line-clamp-4 break-words whitespace-pre-wrap ${r.code ? 'font-mono text-[13px] leading-[1.4]' : 'text-[14px] leading-[1.4]'}`}>{r.text}</span>
              {r.sub && <span className={`line-clamp-2 break-words whitespace-pre-wrap text-[12.5px] leading-[1.35] text-fg-3 ${r.subCode ? 'font-mono' : ''}`}>{r.sub}</span>}
            </span>
            {r.tag && <Chip tone={rowTone(r)}>{r.tag}</Chip>}
          </div>
        ))}
        {section.more && <div className="px-4 py-2.5 text-[13px] leading-[1.4] text-fg-3">{section.more}</div>}
      </MoGroup>
    </MoSection>
  );
}
