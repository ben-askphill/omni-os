import { useRef, useState, type ReactNode } from 'react';
import { DELIVERY_STATE_LABELS, deliveryStages, type TriggerDeliveryState } from '@omni/shared/automation-triggers.ts';
import { api, errorText, refusedDelivery, type DeliveryPage, type DeliveryView } from '../api.ts';
import { describeDeliverySource, expiryFact, fullDate, httpUrl, mergeDeliveries, receivedAgo, relTime } from '../format.ts';
import { href } from '../router.ts';
import { DeliveryStages } from './DeliveryStages.tsx';
import { Button, Chip, ErrorNote, Icon, InlineConfirm, LinkButton, StatusDot, type ChipTone } from './ui.tsx';

const DELIVERY_TONE: Record<TriggerDeliveryState, ChipTone> = {
  received: 'default',
  accepted: 'default',
  queued: 'default',
  started: 'done',
  failed: 'needs',
  skipped: 'outline',
};

const PAGE = 20;

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="min-w-0 break-words text-fg-4">{label}</dt>
      <dd className="min-w-0 break-words whitespace-pre-wrap text-fg-2">{children}</dd>
    </>
  );
}

const FACTS = 'grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-[12px]';

/** What the server kept of the event: fields it bounded already, shown as text, and a web link as a link. */
function ContextFacts({ context }: { context: Record<string, string> }) {
  // By key, as the Mac app lists them: the server's order does not survive its JSON decoder.
  const fields = Object.entries(context).filter(([, value]) => value.trim()).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  if (!fields.length) return null;
  return (
    <dl className={`${FACTS} mt-2 border-t border-line pt-2`}>
      {fields.map(([key, value]) => {
        const url = httpUrl(value);
        return (
          <Fact key={key} label={key}>
            {url ? (
              <a href={url} target="_blank" rel="noreferrer" className="underline underline-offset-2 break-all">
                {value}
              </a>
            ) : (
              value
            )}
          </Fact>
        );
      })}
    </dl>
  );
}

/** One delivery: its summary on a line, and under it, once opened, where it got to, what it carried and what Ben can do. */
function DeliveryRow({ d, onRow, onChanged }: { d: DeliveryView; onRow: (d: DeliveryView) => void; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<'retry' | 'skip' | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Set before the first await: a second click while a request is out finds it taken.
  const acting = useRef(false);

  const act = async (kind: 'retry' | 'skip') => {
    if (acting.current) return;
    acting.current = true;
    setBusy(kind);
    setError(null);
    try {
      const { delivery } = await api.post<{ delivery: DeliveryView }>(`/deliveries/${encodeURIComponent(d.id)}/${kind}`, { attempt: d.attempt });
      onRow(delivery);
      onChanged();
    } catch (e) {
      setError(errorText(e));
      const now = refusedDelivery(e);
      if (now) onRow(now);
    } finally {
      acting.current = false;
      setBusy(null);
    }
  };

  const ago = receivedAgo(d.created_at);
  const expiry = d.expires_at ? expiryFact(d.expires_at) : null;

  const retry = (className = '') => (
    <Button size="sm" variant="secondary" icon="refresh" busy={busy === 'retry'} disabled={busy === 'skip'} onClick={() => void act('retry')} className={className}>
      Retry
    </Button>
  );

  return (
    <li>
      <div className="flex flex-wrap items-center md:flex-nowrap md:gap-2">
        {/* On a phone the summary drops under the chip and the time, and Retry under that, so nothing squeezes it. */}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="hov flex min-h-8 min-w-0 flex-1 basis-full flex-wrap items-center gap-x-2.5 gap-y-0.5 rounded-[18px] px-2 py-1.5 text-left text-[12.5px] [--hov:var(--surface-2)] md:basis-auto md:flex-nowrap md:rounded-full md:py-1"
        >
          <Icon name="chevronRight" size={12} className={`shrink-0 text-fg-3 transition-transform duration-300 [transition-timing-function:var(--ease-settle)] ${open ? 'rotate-90' : ''}`} />
          <Chip tone={DELIVERY_TONE[d.state]}>{DELIVERY_STATE_LABELS[d.state]}</Chip>
          <span className="order-last min-w-0 basis-full pl-[22px] md:order-none md:flex-1 md:basis-auto md:pl-0">
            <span className="line-clamp-2 break-words md:line-clamp-1" title={d.summary}>
              {d.summary}
            </span>
            {(d.reason ?? d.waiting) && (
              <span className="line-clamp-2 text-[11.5px] break-words text-fg-3 md:line-clamp-1" title={d.reason ?? d.waiting ?? undefined}>
                {d.reason ?? d.waiting}
              </span>
            )}
          </span>
          <span className="ml-auto flex shrink-0 items-center justify-end gap-2 md:w-28">
            {d.thread_status && <StatusDot status={d.thread_status} size={7} />}
            <span className="font-num text-[11px] text-fg-4" title={fullDate(d.created_at)}>
              {relTime(d.created_at)}
            </span>
          </span>
        </button>
        {d.can_retry && !open && retry('mb-1 ml-[30px] max-md:h-8 md:m-0')}
      </div>

      {open && (
        <div className="fade-in mx-2 mt-1 mb-2 rounded-2xl bg-bg px-3.5 py-3">
          <DeliveryStages stages={deliveryStages(d)} />
          <dl className={`${FACTS} mt-3 border-t border-line pt-3`}>
            <Fact label="Received">
              {fullDate(d.created_at)}
              {ago && <span className="text-fg-4"> · {ago}</span>}
            </Fact>
            {d.attempt > 1 && <Fact label="Attempt">{d.attempt}</Fact>}
            {expiry && <Fact label={expiry.label}>{expiry.value}</Fact>}
            <Fact label="Source">
              {describeDeliverySource(d.source)}
              <span className="block font-mono text-[11px] break-all text-fg-3">{d.source_id}</span>
            </Fact>
          </dl>
          <ContextFacts context={d.context} />
          {(d.can_retry || d.can_skip || d.thread_id || d.retry_blocked) && (
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
              {d.can_retry && retry('max-md:h-8')}
              {d.can_skip && <InlineConfirm label="Skip" icon="x" confirmLabel="Skip" busyLabel="Skipping" disabled={busy === 'retry'} onConfirm={() => act('skip')} className="md:[--say-h:28px]" />}
              {d.thread_id && (
                <LinkButton href={href.thread(d.thread_id)} icon="arrowRight" size="sm" className="max-md:h-8">
                  Open thread
                </LinkButton>
              )}
              {d.retry_blocked && <span className="min-w-0 basis-full text-[11.5px] text-fg-3 md:flex-1 md:basis-0">{d.retry_blocked}</span>}
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="mx-2 mb-2">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
    </li>
  );
}

/**
 * An automation's deliveries, newest first: the latest few the list carries, and older ones on demand. A reload of the
 * list refreshes the latest few and leaves the rest, and every row keeps its own open state.
 */
export function DeliveryHistory({ automation, latest, latestMore, onChanged }: { automation: string; latest: DeliveryView[]; latestMore: boolean; onChanged: () => void }) {
  const [rows, setRows] = useState(latest);
  const [from, setFrom] = useState(latest);
  if (from !== latest) {
    setFrom(latest);
    setRows(mergeDeliveries(latest, rows));
  }
  // Whether older ones exist, once a page of history has said. Until then the list says.
  const [olderLeft, setOlderLeft] = useState<boolean | null>(null);
  const more = olderLeft ?? latestMore;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadingNow = useRef(false);

  const showOlder = async () => {
    if (loadingNow.current) return;
    loadingNow.current = true;
    setLoading(true);
    setError(null);
    try {
      const page = await api.get<DeliveryPage>(`/automations/${encodeURIComponent(automation)}/deliveries?limit=${PAGE}&before=${encodeURIComponent(rows[rows.length - 1].id)}`);
      setRows((cur) => mergeDeliveries(page.deliveries, cur));
      setOlderLeft(page.more);
    } catch (e) {
      setError(errorText(e));
    } finally {
      loadingNow.current = false;
      setLoading(false);
    }
  };

  return (
    <>
      <ul className="-mx-2">
        {rows.map((d) => (
          <DeliveryRow key={d.id} d={d} onRow={(next) => setRows((cur) => mergeDeliveries([next], cur))} onChanged={onChanged} />
        ))}
      </ul>
      {more && (
        <Button size="sm" variant="ghost" busy={loading} onClick={() => void showOlder()} className="mt-1 -ml-1.5 max-md:h-8">
          Show older
        </Button>
      )}
      {error && (
        <div className="mt-2">
          <ErrorNote onRetry={() => void showOlder()}>{error}</ErrorNote>
        </div>
      )}
    </>
  );
}
