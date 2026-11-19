// A connector's tile (@omni/shared/connectors.ts): its brand mark on a small rounded square, the way Claude's apps
// mark a connector in a tool row, the Context list and the step line. Omni's own servers wear the ring; a brand with
// no mark its initial; a server Omni does not know a neutral plug. Desktop web, the phone layout and the desktop app.
import type { Connector } from '@omni/shared/connectors.ts';
import { LINK_ICONS } from '@omni/shared/link-icons.ts';
import { StaticMark } from './brand.tsx';
import { Icon } from './ui.tsx';

function Mark({ connector, size }: { connector: Connector; size: number }) {
  const m = connector.mark;
  if (m.type === 'omni') return <StaticMark size={size} title="" className="text-fg" />;
  if (m.type === 'generic') return <Icon name="plug" size={size} className="text-fg-2" />;
  if (m.type === 'letter')
    return (
      <span aria-hidden className="font-semibold text-fg leading-none" style={{ fontSize: Math.round(size * 0.95) }}>
        {m.text}
      </span>
    );
  const layers = LINK_ICONS[m.icon] ?? LINK_ICONS.link;
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden className="block shrink-0 text-fg">
      {layers.map((l, i) =>
        l.stroke ? (
          <path key={i} d={l.d} fill="none" stroke={l.fill ?? 'currentColor'} strokeWidth={l.stroke} strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <path key={i} d={l.d} fill={l.fill ?? 'currentColor'} />
        ),
      )}
    </svg>
  );
}

/** The tile, `size` px square. Its mark fills about two thirds of it. */
export function ConnectorMark({ connector, size = 20, className = '' }: { connector: Connector; size?: number; className?: string }) {
  return (
    <span
      role="img"
      aria-label={connector.name}
      title={connector.name}
      data-connector={connector.id}
      className={`inline-grid shrink-0 place-items-center rounded-[var(--r-xs)] bg-surface shadow-[inset_0_0_0_1px_var(--line-strong)] ${className}`}
      style={{ width: size, height: size }}
    >
      <Mark connector={connector} size={Math.round(size * 0.62)} />
    </span>
  );
}

/** A step's "Now:" line, with the tile of the connector it uses: "Now: [G] Using Granola". */
export function NowWithConnector({ now, connector, prefix = 'Now: ' }: { now: string; connector?: Connector | null; prefix?: string }) {
  if (!connector) return <>{`${prefix}${now}`}</>;
  return (
    <span className="inline-flex max-w-full min-w-0 items-center gap-[5px] align-top">
      {prefix.trim() && <span className="shrink-0">{prefix.trim()}</span>}
      <ConnectorMark connector={connector} size={15} />
      <span className="min-w-0 truncate">{now}</span>
    </span>
  );
}
