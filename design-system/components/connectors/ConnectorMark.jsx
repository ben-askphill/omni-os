// Connector tiles, the inline connector row and the step's Now line, as static markup on omni.css classes. The app's
// own versions: apps/web/src/components/ConnectorMark.tsx and ToolRows.tsx (ConnectorRow). Not in bundle.js: the
// preview card (components/ConnectorMark/preview.html) draws the markup directly.
const NOTION = 'M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.981-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.841-.046.935-.56.935-1.167V6.354c0-.606-.233-.933-.748-.887l-15.177.887c-.56.047-.747.327-.747.933zm14.337.745c.093.42 0 .84-.42.888l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.748 0-.935-.234-1.495-.933l-4.577-7.186v6.952L12.21 19s0 .84-1.168.84l-3.222.186c-.093-.186 0-.653.327-.746l.84-.233V9.854L7.822 9.76c-.094-.42.14-1.026.793-1.073l3.456-.233 4.764 7.279v-6.44l-1.215-.139c-.093-.514.28-.887.747-.933zM1.936 1.035l13.31-.98c1.634-.14 2.055-.047 3.082.7l4.249 2.986c.7.513.934.653.934 1.213v16.378c0 1.026-.373 1.634-1.68 1.726l-15.458.934c-.98.047-1.448-.093-1.962-.747l-3.129-4.06c-.56-.747-.793-1.306-.793-1.96V2.667c0-.839.374-1.54 1.447-1.632z';
const GMAIL = 'M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.91 1.528-1.145C21.69 2.28 24 3.434 24 5.457z';
/** Brand layers for the preview: in the app every mark comes from LINK_ICONS. */
export const SAMPLE_MARKS = { notion: [{ d: NOTION }], gmail: [{ d: GMAIL, fill: '#ea4335' }] };

function Mark({ connector }) {
  const m = connector.mark;
  if (m.type === 'omni')
    return (
      <svg viewBox="-64 -64 128 128" aria-hidden="true">
        <g transform="translate(-4 3) scale(.92) skewX(-10)">
          <circle r="40" fill="none" stroke="currentColor" strokeWidth="20" />
          <circle cx="49.5" cy="-49.5" r="12" fill="currentColor" />
        </g>
      </svg>
    );
  if (m.type === 'generic')
    return (
      <svg className="om-connector__plug" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4" />
      </svg>
    );
  if (m.type === 'letter') return <span className="om-connector__letter" aria-hidden="true">{m.text}</span>;
  const layers = (m.layers ?? SAMPLE_MARKS[m.icon]) || [];
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {layers.map((l, i) => <path key={i} d={l.d} fill={l.fill ?? 'currentColor'} />)}
    </svg>
  );
}

export function ConnectorMark({ connector, size = 20, className = '' }) {
  return (
    <span className={`om-connector ${className}`} role="img" aria-label={connector.name} title={connector.name} style={{ '--om-connector-size': `${size}px` }}>
      <Mark connector={connector} />
    </span>
  );
}

export function NowWithConnector({ now, connector, prefix = 'Now: ' }) {
  if (!connector) return <>{`${prefix}${now}`}</>;
  return (
    <span className="om-connector-now">
      {prefix.trim() && <span>{prefix.trim()}</span>}
      <ConnectorMark connector={connector} size={15} />
      <span>{now}</span>
    </span>
  );
}

/** status 'running' | 'done' | 'failed'; detail: the action ("Search meetings") or "N calls". */
export function ConnectorRow({ connector, status = 'done', detail, failed = 0, children, defaultOpen = false }) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <div>
      <button type="button" className="om-connector-row" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <ConnectorMark connector={connector} size={24} />
        <span className="om-connector-row__label">{status === 'running' ? 'Working on it' : `Used ${connector.name}`}</span>
        {detail && <span className="om-connector-row__detail">{detail}</span>}
        <svg className="om-connector-row__chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
        {status === 'failed' && <span className="om-connectors__kind">{failed > 1 ? `${failed} failed` : 'error'}</span>}
      </button>
      {open && children && <div className="om-connector-row__body">{children}</div>}
    </div>
  );
}
