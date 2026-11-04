/* Phone: the Conductor thread over the private network (web/src App.tsx mobile top bar + Thread page). */
function PhoneConductor({ dark = false }) {
  const { OmniMark, Composer, Status, IconButton, OmniLogo } = window.OmniOS;
  const [resolved, setResolved] = React.useState(false);
  return (
    <div data-theme={dark ? 'dark' : 'light'} style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg)', color: 'var(--fg)', fontFamily: 'var(--font-sans)' }}>
      <header style={{ flex: 'none', paddingTop: 54, borderBottom: '1px solid var(--line)', background: 'var(--bg)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, height: 52, padding: '0 8px' }}>
          <IconButton label="Open menu" icon="menu" iconSize={18} />
          <span style={{ padding: '0 4px' }}><OmniLogo height={17} /></span>
          <span style={{ flex: 1, minWidth: 0, marginLeft: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', font: '400 13px var(--font-sans)', color: 'var(--fg-3)' }}>Thread</span>
          <OmniMark size={24} state={resolved ? 'delegating' : 'attention'} interactive={false} onAcknowledge={() => setResolved(true)} />
          <IconButton label="Search or jump to" icon="search" iconSize={17} />
        </div>
      </header>
      <div className="om-thread" style={{ flex: 1, overflowY: 'auto', padding: '0 16px' }}>
        <div style={{ padding: '20px 0 16px' }}>
          <div className="om-caption" style={{ marginBottom: 8 }}>Conductor · T-4F29 · 14:02</div>
          <h1 className="om-display" style={{ margin: 0, fontSize: 22, lineHeight: 1.2 }}>Volero checkout drop-off after Friday’s deploy</h1>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
            <Status state="running" label="1 running" />
            {!resolved && <Status state="needs" label="1 needs you" />}
            <Status state="done" label="1 done" />
          </div>
        </div>
        <ConductorThread resolved={resolved} onResolve={() => setResolved(true)} narrow />
        <div style={{ height: 16 }} />
      </div>
      <div style={{ flex: 'none', padding: '8px 10px 30px', background: 'var(--bg)' }}>
        <Composer hints={false} channel={{ code: 'VO', name: 'Volero' }} placeholder="Reply to the Conductor" />
      </div>
    </div>
  );
}

Object.assign(window, { PhoneConductor });
