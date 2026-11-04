/* Omni mobile: shared parts. Reads DS components from window.OmniOS at render time. */
const OM = () => window.OmniOS;
const MO_PATHS = {
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3',
  pin: 'M9 4h6l-1 6 4 3v1H6v-1l4-3zM12 14v7',
  share: 'M12 15V3M7 8l5-5 5 5M5 13v7h14v-7'
};
function MoIcon({ name, size = 18 }) {
  if (MO_PATHS[name]) return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={MO_PATHS[name]} /></svg>;
  const { Icon } = OM();
  return <Icon name={name} size={size} />;
}
const moEllipsis = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const moRoleLabel = (r) => (r === 'store-ops' ? 'store-ops' : r);
const moHarness = { 'claude-code': 'Claude Code', codex: 'Codex', cursor: 'Cursor' };

function MoRound({ icon, label, onClick, size = 40, ink, children, quiet }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className="mo-press"
      style={{ width: size, height: size, flex: 'none', borderRadius: 999, border: 0, padding: 0, display: 'grid', placeItems: 'center', cursor: 'pointer',
        background: ink ? 'var(--fg)' : quiet ? 'transparent' : 'var(--surface-2)', color: ink ? 'var(--on-ink)' : 'var(--fg)' }}>
      {children || <MoIcon name={icon} size={18} />}
    </button>
  );
}

function MoHeader({ onBack, title, sub, right, left }) {
  return (
    <header style={{ flex: 'none', paddingTop: 54, background: 'var(--bg)', position: 'relative', zIndex: 2 }}>
      <div style={{ height: 52, display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px' }}>
        {onBack ? <MoRound icon="chevronLeft" label="Back" onClick={onBack} /> : left}
        <div style={{ flex: 1, minWidth: 0 }}>
          {title && <div style={{ font: '500 15px/1.25 var(--font-sans)', ...moEllipsis }}>{title}</div>}
          {sub && <div style={{ font: '400 12px/1.35 var(--font-sans)', color: 'var(--fg-3)', ...moEllipsis }}>{sub}</div>}
        </div>
        {right && <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{right}</div>}
      </div>
    </header>
  );
}

function MoTitle({ title, sub }) {
  return (
    <div style={{ padding: '4px 20px 14px' }}>
      <h1 style={{ margin: 0, font: '500 30px/1.1 var(--font-head)', letterSpacing: '-0.01em' }}>{title}</h1>
      {sub && <div style={{ marginTop: 6, font: '400 13px/1.4 var(--font-sans)', color: 'var(--fg-3)', fontVariantNumeric: 'tabular-nums' }}>{sub}</div>}
    </div>
  );
}

function MoSection({ title, count, right, children, pad = true }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: pad ? '0 16px' : 0 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, padding: '0 4px' }}>
        <span style={{ font: '500 12px/1.3 var(--font-sans)', color: 'var(--fg-3)' }}>{title}</span>
        {count != null && <span style={{ font: '400 12px/1.3 var(--font-sans)', color: 'var(--fg-4)', fontVariantNumeric: 'tabular-nums' }}>{count}</span>}
        <span style={{ flex: 1 }} />{right}
      </div>
      {children}
    </section>
  );
}

function MoAvatar({ role, state, size = 36 }) {
  const { CrewMark, StatusGlyph } = OM();
  return (
    <span style={{ position: 'relative', width: size, height: size, flex: 'none', borderRadius: 999, background: 'var(--surface-2)', color: 'var(--fg-2)', display: 'grid', placeItems: 'center' }}>
      <CrewMark role={role} size={Math.round(size * 0.46)} />
      {state && <span style={{ position: 'absolute', right: -1, bottom: -1, width: 14, height: 14, borderRadius: 999, background: 'var(--bg)', display: 'grid', placeItems: 'center' }}><StatusGlyph state={state} size={8} /></span>}
    </span>
  );
}

function MoDiff({ add, del }) {
  return <span style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}><span style={{ color: 'var(--fg-2)' }}>+{add}</span> <span style={{ color: 'var(--fg-3)' }}>−{del}</span></span>;
}

function MoRow({ it, onOpen, last }) {
  const settled = it.state === 'done';
  const meta = ['#' + it.ch, it.state === 'running' ? it.meta : null, it.state === 'needs' ? 'Needs you' : null].filter(Boolean).join(' · ');
  return (
    <button type="button" onClick={onOpen} className="mo-row" style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left', border: 0, background: 'transparent', color: 'inherit', padding: '10px 4px', cursor: 'pointer', font: 'inherit' }}>
      <MoAvatar role={it.role} state={it.state} />
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2, paddingBottom: 10, marginBottom: -10, borderBottom: last ? 0 : '1px solid var(--line)' }}>
        <span style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
          <span style={{ flex: 1, minWidth: 0, font: '400 15px/1.3 var(--font-sans)', color: settled ? 'var(--fg-2)' : 'var(--fg)', ...moEllipsis }}>{it.title}</span>
          <span style={{ flex: 'none', font: '400 12px/1 var(--font-sans)', color: 'var(--fg-3)', fontVariantNumeric: 'tabular-nums' }}>{it.time}</span>
        </span>
        <span style={{ display: 'flex', gap: 8, alignItems: 'center', font: '400 12.5px/1.35 var(--font-sans)', color: 'var(--fg-3)' }}>
          <span style={{ flex: 1, minWidth: 0, ...moEllipsis }}>{meta}</span>
          {it.diff && <MoDiff add={it.diff[0]} del={it.diff[1]} />}
          {it.artifact && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><MoIcon name="file" size={13} />1</span>}
        </span>
      </span>
    </button>
  );
}

function MoRadio({ on }) {
  return <span style={{ width: 20, height: 20, flex: 'none', borderRadius: 999, boxShadow: on ? 'none' : 'inset 0 0 0 1.5px var(--line-strong)', background: on ? 'var(--fg)' : 'transparent', display: 'grid', placeItems: 'center' }}>{on && <span style={{ width: 8, height: 8, borderRadius: 999, background: 'var(--bg)' }} />}</span>;
}

function MoDecisionBody({ it, pick, setPick }) {
  const { Chip } = OM();
  if (it.kind === 'draft') return (
    <div style={{ background: 'var(--elev)', boxShadow: 'var(--shadow-card)', borderRadius: 14, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ font: '500 12px/1.3 var(--font-sans)', color: 'var(--fg-3)' }}>Draft to maartje@volero.nl</span>
      <p style={{ margin: 0, font: '400 14px/1.5 var(--font-sans)', color: 'var(--fg-2)', textWrap: 'pretty' }}>{it.quote}</p>
    </div>
  );
  if (it.kind === 'choice') return (
    <div style={{ background: 'var(--elev)', boxShadow: 'var(--shadow-card)', borderRadius: 14, overflow: 'hidden' }}>
      {it.options.map((o, i) => (
        <button key={i} type="button" onClick={() => setPick(i)} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', width: '100%', textAlign: 'left', border: 0, borderTop: i ? '1px solid var(--line)' : 0, background: 'transparent', color: 'inherit', padding: '12px 14px', cursor: 'pointer', font: 'inherit' }}>
          <span style={{ paddingTop: 1 }}><MoRadio on={pick === i} /></span>
          <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ display: 'flex', gap: 8, alignItems: 'center', font: '500 14.5px/1.3 var(--font-sans)' }}>{o.l}{o.rec && <Chip tone="outline">Recommended</Chip>}</span>
            <span style={{ font: '400 13px/1.4 var(--font-sans)', color: 'var(--fg-3)' }}>{o.s}</span>
          </span>
        </button>
      ))}
    </div>
  );
  return <p style={{ margin: 0, font: '400 14px/1.5 var(--font-sans)', color: 'var(--fg-2)', textWrap: 'pretty' }}>{it.body}</p>;
}

function MoResolved({ it, onUndo }) {
  const { StatusGlyph } = OM();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 48, padding: '0 8px 0 16px', borderRadius: 999, background: 'var(--surface)' }}>
      <StatusGlyph state="done" size={9} />
      <span style={{ flex: 1, minWidth: 0, font: '400 14px/1.3 var(--font-sans)', color: 'var(--fg-2)', ...moEllipsis }}>{it.doneText}</span>
      <button type="button" onClick={onUndo} className="mo-press" style={{ height: 34, padding: '0 14px', borderRadius: 999, border: 0, background: 'transparent', color: 'var(--fg)', font: '500 13px var(--font-sans)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}><MoIcon name="undo" size={14} />Undo</button>
    </div>
  );
}

/* The decision card: the agent's question and the buttons to answer it, in the list or the thread. */
function MoDecision({ it, app, inThread }) {
  const { Button } = OM();
  const [pick, setPick] = React.useState(0);
  if (app.resolved[it.id]) return <MoResolved it={it} onUndo={() => app.resolve(it.id, false)} />;
  return (
    <div style={{ background: 'var(--surface)', borderRadius: 20, padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {!inThread && (
        <button type="button" onClick={() => app.open(it.id)} style={{ all: 'unset', cursor: 'pointer', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <MoAvatar role={it.role} state="needs" />
          <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{ font: '400 12px/1.3 var(--font-sans)', color: 'var(--fg-3)' }}>#{it.ch} · {moRoleLabel(it.role)}{it.via ? ' · via Conductor' : ''}</span>
            <span style={{ font: '500 16px/1.3 var(--font-sans)', textWrap: 'pretty' }}>{it.title}</span>
          </span>
          <span style={{ font: '400 12px/1.3 var(--font-sans)', color: 'var(--fg-3)', fontVariantNumeric: 'tabular-nums' }}>{it.time}</span>
        </button>
      )}
      {inThread && <span style={{ font: '500 16px/1.3 var(--font-sans)', textWrap: 'pretty' }}>{it.title}</span>}
      <MoDecisionBody it={it} pick={pick} setPick={setPick} />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button variant="needs" size="lg" onClick={() => app.resolve(it.id, true)}>{it.yes}</Button>
        {it.no && <Button variant="secondary" size="lg" onClick={() => (it.kind === 'draft' ? app.open(it.id) : app.resolve(it.id, true, 'Kept it running'))}>{it.no}</Button>}
      </div>
    </div>
  );
}

function MoTabBar({ tab, onTab, onNew, needs }) {
  const { StatusGlyph } = OM();
  const tabs = [{ id: 'activity', icon: 'inbox', label: 'Activity' }, { id: 'channels', icon: 'hash', label: 'Channels' }, { id: 'library', icon: 'layers', label: 'Library' }];
  const i = Math.max(0, tabs.findIndex((t) => t.id === tab));
  return (
    <div style={{ position: 'absolute', left: 14, right: 14, bottom: 28, display: 'flex', gap: 10, zIndex: 20 }}>
      <nav aria-label="Tabs" style={{ flex: 1, position: 'relative', display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', height: 60, padding: 4, borderRadius: 999, background: 'var(--elev)', boxShadow: 'var(--shadow-menu)' }}>
        <span aria-hidden="true" style={{ position: 'absolute', top: 4, bottom: 4, left: 4, width: 'calc((100% - 8px) / 3)', transform: `translateX(${i * 100}%)`, borderRadius: 999, background: 'var(--surface-2)', transition: 'transform 420ms var(--ease-spring)' }} />
        {tabs.map((t) => (
          <button key={t.id} type="button" onClick={() => onTab(t.id)} aria-current={t.id === tab ? 'page' : undefined}
            style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, border: 0, background: 'transparent', cursor: 'pointer', color: t.id === tab ? 'var(--fg)' : 'var(--fg-3)', font: '500 11px/1 var(--font-sans)' }}>
            <span style={{ position: 'relative', display: 'grid' }}>
              <MoIcon name={t.icon} size={20} />
              {t.id === 'activity' && needs > 0 && <span style={{ position: 'absolute', top: -3, right: -7, width: 13, height: 13, borderRadius: 999, background: 'var(--elev)', display: 'grid', placeItems: 'center' }}><StatusGlyph state="needs" size={8} /></span>}
            </span>
            {t.label}
          </button>
        ))}
      </nav>
      <button type="button" aria-label="New delegation" onClick={onNew} className="mo-press" style={{ width: 60, height: 60, flex: 'none', borderRadius: 999, border: 0, cursor: 'pointer', background: 'var(--fg)', color: 'var(--on-ink)', display: 'grid', placeItems: 'center', boxShadow: 'var(--shadow-menu)' }}><MoIcon name="plus" size={22} /></button>
    </div>
  );
}

function MoSheet({ onClose, children, full }) {
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 40 }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'var(--scrim)', animation: 'mo-fade 240ms var(--ease-out)' }} />
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, top: full ? 56 : 'auto', maxHeight: 'calc(100% - 56px)', display: 'flex', flexDirection: 'column', background: 'var(--bg)', borderRadius: '28px 28px 0 0', boxShadow: 'var(--shadow-menu)', animation: 'mo-up 460ms var(--ease-out)', paddingBottom: 30, overflow: 'hidden' }}>
        <div style={{ flex: 'none', width: 36, height: 5, borderRadius: 99, background: 'var(--surface-3)', margin: '8px auto 2px' }} />
        {children}
      </div>
    </div>
  );
}

function MoListRow({ icon, label, sub, right, onClick, chevron = true, last }) {
  return (
    <button type="button" onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 14, width: '100%', minHeight: 52, padding: '0 16px', border: 0, background: 'transparent', color: 'inherit', textAlign: 'left', cursor: onClick ? 'pointer' : 'default', font: 'inherit' }}>
      {icon && <span style={{ color: 'var(--fg-2)', display: 'grid' }}>{typeof icon === 'string' ? <MoIcon name={icon} size={18} /> : icon}</span>}
      <span style={{ flex: 1, minWidth: 0, alignSelf: 'stretch', display: 'flex', alignItems: 'center', gap: 10, borderBottom: last ? 0 : '1px solid var(--line)' }}>
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1, padding: '10px 0' }}>
          <span style={{ font: '400 15px/1.3 var(--font-sans)', ...moEllipsis }}>{label}</span>
          {sub && <span style={{ font: '400 12.5px/1.35 var(--font-sans)', color: 'var(--fg-3)', ...moEllipsis }}>{sub}</span>}
        </span>
        {right && <span style={{ font: '400 13px/1 var(--font-sans)', color: 'var(--fg-3)', fontVariantNumeric: 'tabular-nums', display: 'flex', alignItems: 'center', gap: 6 }}>{right}</span>}
        {chevron && onClick && <span style={{ color: 'var(--fg-4)', display: 'grid' }}><MoIcon name="chevronRight" size={16} /></span>}
      </span>
    </button>
  );
}

function MoGroup({ children }) {
  return <div style={{ background: 'var(--surface)', borderRadius: 20, overflow: 'hidden' }}>{children}</div>;
}

/* Composer: action chips for this thread, then one line with + (attach, model, effort), mic or send. */
function MoComposer({ placeholder, actions = [], onSend, onPlus }) {
  const [v, setV] = React.useState('');
  const send = () => { if (!v.trim()) return; onSend && onSend(v.trim()); setV(''); };
  return (
    <div style={{ flex: 'none', padding: '6px 12px 32px', background: 'var(--bg)', position: 'relative', zIndex: 2 }}>
      {actions.length > 0 && (
        <div className="mo-scroll" style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '2px 0 10px' }}>
          {actions.map((a) => (
            <button key={a.label} type="button" onClick={a.onClick} className="mo-press" style={{ flex: 'none', height: 36, padding: '0 14px', borderRadius: 999, border: 0, cursor: 'pointer', background: 'var(--surface-2)', color: 'var(--fg)', font: '500 13.5px/1 var(--font-sans)', display: 'inline-flex', alignItems: 'center', gap: 7 }}>
              {a.icon && <MoIcon name={a.icon} size={15} />}{a.label}{a.diff && <MoDiff add={a.diff[0]} del={a.diff[1]} />}
            </button>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, height: 52, padding: 6, borderRadius: 26, background: 'var(--surface)' }}>
        <MoRound icon="plus" label="Attach, model and effort" onClick={onPlus} />
        <input value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} placeholder={placeholder}
          style={{ flex: 1, minWidth: 0, border: 0, outline: 'none', background: 'transparent', color: 'var(--fg)', font: '400 15px/1.3 var(--font-sans)', padding: '0 4px' }} />
        {v.trim() ? <MoRound ink icon="send" label="Send" onClick={send} /> : <MoRound quiet icon="mic" label="Dictate" />}
      </div>
    </div>
  );
}

function MoBubble({ children, caption }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
      {caption && <span style={{ font: '400 12px/1.3 var(--font-sans)', color: 'var(--fg-3)' }}>{caption}</span>}
      <div style={{ maxWidth: '86%', background: 'var(--bubble)', borderRadius: 20, padding: '10px 14px', font: '400 15px/1.45 var(--font-sans)', textWrap: 'pretty' }}>{children}</div>
    </div>
  );
}

function MoStripes({ label, height = 120, radius = 14 }) {
  return (
    <div style={{ height, borderRadius: radius, background: 'repeating-linear-gradient(135deg, var(--surface-2) 0 8px, var(--surface-3) 8px 9px)', display: 'grid', placeItems: 'center' }}>
      <span style={{ font: '400 11px/1.3 var(--font-mono)', color: 'var(--fg-3)', background: 'var(--surface)', padding: '3px 7px', borderRadius: 6 }}>{label}</span>
    </div>
  );
}

function MoArtifactCard({ name, sub, onOpen, live }) {
  return (
    <button type="button" onClick={onOpen} className="mo-press" style={{ all: 'unset', cursor: 'pointer', display: 'flex', flexDirection: 'column', borderRadius: 20, background: 'var(--surface)', overflow: 'hidden' }}>
      <div style={{ height: 150, overflow: 'hidden', position: 'relative', margin: '8px 8px 0', borderRadius: 14, background: 'var(--elev)', boxShadow: 'var(--shadow-card)' }}>
        {live ? <iframe title={name} srcDoc={window.MOBILE.funnel} style={{ border: 0, width: 640, height: 300, transform: 'scale(0.53)', transformOrigin: '0 0', pointerEvents: 'none', background: '#fff' }} /> : <MoStripes label={name} height={150} radius={0} />}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px 12px' }}>
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ font: '400 13px/1.3 var(--font-mono)', ...moEllipsis }}>{name}</span>
          <span style={{ font: '400 12px/1.3 var(--font-sans)', color: 'var(--fg-3)' }}>{sub}</span>
        </span>
        <span style={{ color: 'var(--fg-3)', display: 'grid' }}><MoIcon name="maximize" size={16} /></span>
      </div>
    </button>
  );
}

function MoToast({ text }) {
  return <div style={{ position: 'absolute', left: '50%', bottom: 112, transform: 'translateX(-50%)', zIndex: 60, background: 'var(--fg)', color: 'var(--on-ink)', borderRadius: 999, padding: '11px 18px', font: '500 13.5px/1 var(--font-sans)', whiteSpace: 'nowrap', boxShadow: 'var(--shadow-menu)', animation: 'mo-toast 320ms var(--ease-spring)' }}>{text}</div>;
}

Object.assign(window, { MoIcon, MoRound, MoHeader, MoTitle, MoSection, MoAvatar, MoDiff, MoRow, MoRadio, MoDecision, MoResolved, MoTabBar, MoSheet, MoListRow, MoGroup, MoComposer, MoBubble, MoStripes, MoArtifactCard, MoToast, moEllipsis, moRoleLabel, moHarness });
