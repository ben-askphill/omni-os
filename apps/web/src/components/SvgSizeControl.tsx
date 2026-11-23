import { useId } from 'react';
import { scaleSvgIcon, SVG_SCALE_DEFAULT, SVG_SCALE_MAX, SVG_SCALE_MIN, SVG_SCALE_STEP, svgIconScale } from '@omni/shared/channel-icon.ts';
import { Button } from './ui.tsx';

/**
 * How big an uploaded SVG sits in its avatar: a channel's icon (Channel settings) or an agent's (Settings > Agents).
 * The size lives in the markup (scaleSvgIcon), so every client draws it. The avatar beside it previews each step; Save
 * keeps it.
 */
export function SvgSizeControl({ markup, onChange }: { markup: string; onChange: (markup: string) => void }) {
  const id = useId();
  const scale = svgIconScale(markup);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <label htmlFor={id} className="text-fg-2">
        Size
      </label>
      <input
        id={id}
        type="range"
        min={SVG_SCALE_MIN}
        max={SVG_SCALE_MAX}
        step={SVG_SCALE_STEP}
        value={scale}
        aria-valuetext={`${scale}%`}
        onChange={(e) => onChange(scaleSvgIcon(markup, Number(e.target.value)))}
        className="focus-ring w-44 rounded-full accent-fg"
      />
      <output htmlFor={id} className="w-10 tabular-nums text-fg-3">
        {scale}%
      </output>
      {scale !== SVG_SCALE_DEFAULT && (
        <Button type="button" onClick={() => onChange(scaleSvgIcon(markup, SVG_SCALE_DEFAULT))}>
          Reset size
        </Button>
      )}
    </div>
  );
}
