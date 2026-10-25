import type { DeliveryStage } from '@omni/shared/automation-triggers.ts';

/** The status glyph each tone draws: done is a volt disc, needs a vermilion diamond, live pings, quiet is grey, plain is hollow. */
const GLYPH: Record<DeliveryStage['tone'], string> = { done: 'done', needs: 'needs', live: 'running', quiet: 'settled', plain: 'idle' };

/** A delivery's way from event to outcome, one line per stage: a tone glyph, the stage, what happened, and a note under it. */
export function DeliveryStages({ stages }: { stages: DeliveryStage[] }) {
  return (
    <ol className="space-y-1.5">
      {stages.map((s) => (
        <li key={s.name} className="flex items-start gap-2.5 text-[12.5px]">
          <span aria-hidden="true" data-s={GLYPH[s.tone]} className="glyph mt-[5px]" style={{ width: 8, height: 8 }}>
            {s.tone === 'live' && <i className="ping" />}
            <i />
          </span>
          <span className="w-16 shrink-0 text-fg-4">{s.name}</span>
          <span className="min-w-0 flex-1">
            <span className="font-medium text-fg">{s.label}</span>
            {s.note && <span className="block text-[11.5px] break-words text-fg-3">{s.note}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}
