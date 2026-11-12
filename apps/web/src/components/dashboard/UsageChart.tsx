import { useEffect, useRef, useState } from 'react';
import type { UsageDay, UsageSource } from '@omni/shared/insights.ts';
import { compact, dayLabel, SOURCE_COLOR, SOURCE_NAME, usd } from './numbers.ts';

const H = 180;
const PAD = { top: 18, right: 8, bottom: 22, left: 40 };

/** A round ceiling for the y axis: 1, 2, 2.5 or 5 times a power of ten. */
function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return ([1, 2, 2.5, 5, 10].find((m) => m * p >= v) ?? 10) * p;
}

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/**
 * Tokens per day, one series per source. Claude Code, usually the largest, is a filled area; the others are lines over
 * it. Gridlines on the y axis, the first, middle and last day under it, the peak day marked, and a tooltip on hover.
 */
export function UsageChart({ days, sources }: { days: UsageDay[]; sources: UsageSource[] }) {
  const [ref, w] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const n = days.length;
  const totalOf = (d: UsageDay) => sources.reduce((s, k) => s + (d.tokens[k] ?? 0), 0);
  const max = niceMax(Math.max(0, ...days.flatMap((d) => sources.map((k) => d.tokens[k] ?? 0))));
  const innerW = Math.max(0, w - PAD.left - PAD.right);
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const pts = (k: UsageSource) => days.map((d, i) => [x(i), y(d.tokens[k] ?? 0)] as const);
  const line = (k: UsageSource) => pts(k).map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join('');
  const area = (k: UsageSource) => `${line(k)}L${x(n - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z`;
  const peak = days.reduce((best, d, i) => (totalOf(d) > totalOf(days[best]) ? i : best), 0);
  const peakTotal = n ? totalOf(days[peak]) : 0;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const labelDays = n === 1 ? [0] : [...new Set([0, Math.floor((n - 1) / 2), n - 1])];
  const area0 = sources.includes('claude-code') ? 'claude-code' : null;

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left;
    const i = n === 1 ? 0 : Math.round(((px - PAD.left) / innerW) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };

  return (
    <div ref={ref} className="relative w-full" style={{ height: H }}>
      {w > 0 && (
        <svg
          width={w}
          height={H}
          role="img"
          aria-label={`Daily processed tokens, ${dayLabel(days[0].day)} to ${dayLabel(days[n - 1].day)}, peak ${compact(peakTotal)} on ${dayLabel(days[peak].day)}`}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
          className="block touch-pan-y"
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={w - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeDasharray={t ? '2 3' : undefined} />
              <text x={PAD.left - 6} y={y(t)} dy="0.32em" textAnchor="end" className="fill-fg-3 font-num text-[10px] tabular-nums">
                {compact(t)}
              </text>
            </g>
          ))}
          {labelDays.map((i) => (
            <text key={i} x={x(i)} y={H - 6} textAnchor={n === 1 ? 'middle' : i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} className="fill-fg-3 text-[10px]">
              {dayLabel(days[i].day)}
            </text>
          ))}
          {area0 && n > 1 && <path d={area(area0)} fill={SOURCE_COLOR[area0]} fillOpacity={0.16} />}
          {n > 1 && sources.map((k) => <path key={k} d={line(k)} fill="none" stroke={SOURCE_COLOR[k]} strokeWidth={k === area0 ? 2 : 1.5} strokeLinejoin="round" strokeLinecap="round" />)}
          {n === 1 && sources.map((k) => <circle key={k} cx={x(0)} cy={y(days[0].tokens[k] ?? 0)} r={4} fill={SOURCE_COLOR[k]} />)}
          {peakTotal > 0 && hover === null && (
            <g>
              <circle cx={x(peak)} cy={y(Math.max(...sources.map((k) => days[peak].tokens[k] ?? 0)))} r={3} fill="var(--fg)" />
              <text
                x={x(peak)}
                y={y(Math.max(...sources.map((k) => days[peak].tokens[k] ?? 0))) - 8}
                textAnchor={x(peak) < PAD.left + 60 ? 'start' : x(peak) > w - 60 ? 'end' : 'middle'}
                className="fill-fg-2 font-num text-[10.5px] font-medium tabular-nums"
              >
                Peak {compact(peakTotal)}
              </text>
            </g>
          )}
          {hover !== null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={y(0)} stroke="var(--line-strong)" />
              {sources.map((k) => (
                <circle key={k} cx={x(hover)} cy={y(days[hover].tokens[k] ?? 0)} r={3.5} fill={SOURCE_COLOR[k]} stroke="var(--bg)" strokeWidth={1.5} />
              ))}
            </g>
          )}
        </svg>
      )}
      {hover !== null && w > 0 && (
        <div
          role="tooltip"
          className="pointer-events-none absolute top-0 z-10 min-w-[150px] rounded-[12px] bg-elev px-3 py-2 text-[11.5px] shadow-[var(--shadow-menu)]"
          style={x(hover) > w / 2 ? { right: w - x(hover) + 10 } : { left: x(hover) + 10 }}
        >
          <div className="mb-1 font-medium text-fg">{dayLabel(days[hover].day)}</div>
          {sources.map((k) => (
            <div key={k} className="flex items-center gap-2 text-fg-2">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: SOURCE_COLOR[k] }} />
              <span className="flex-1">{SOURCE_NAME[k]}</span>
              <span className="font-num tabular-nums">{compact(days[hover].tokens[k] ?? 0)}</span>
            </div>
          ))}
          <div className="mt-1 flex justify-between border-t border-line pt-1 text-fg-3">
            <span>Cost</span>
            <span className="font-num tabular-nums">{usd(days[hover].cost)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
