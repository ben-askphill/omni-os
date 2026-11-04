/* Omni OS desktop shell (web/src App.tsx): white canvas, 252px sidebar, main pane as a 22px-radius card. */
function App() {
  const { Rail, TabStack, CommandPalette, IconButton, Toast, HarnessLogo } = window.OmniOS;
  const D = window.OMNI_DATA;
  const q = new URLSearchParams(location.search);
  const [view, setView] = React.useState(q.get('screen') === 'channel' ? 'vo' : (q.get('screen') === 'switchboard' ? 'conductor' : q.get('screen')) || 'conductor');
  const [theme, setTheme] = React.useState(q.get('theme') || 'light');
  const [density, setDensity] = React.useState(q.get('density') || 'comfortable');
  const [panel, setPanel] = React.useState(() => q.get('panel') !== '0' && window.innerWidth >= 1200);
  const [palette, setPalette] = React.useState(q.get('palette') === '1');
  const [resolved, setResolved] = React.useState(false);
  const [extra, setExtra] = React.useState([]);
  const [thinking, setThinking] = React.useState(false);
  const [toast, setToast] = React.useState(null);

  React.useEffect(() => {
    const t = theme === 'system' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme;
    document.documentElement.dataset.theme = t;
  }, [theme]);
  React.useEffect(() => { document.documentElement.dataset.density = density; }, [density]);
  React.useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((p) => !p); }
      else if (e.key === 'Escape') setPalette(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  React.useEffect(() => {
    if (q.get('toast') === '0') return;
    const t = setTimeout(() => setToast({ title: 'Klaviyo abandoned-cart flow', body: 'Finished in #Volero' }), 2600);
    return () => clearTimeout(t);
  }, []);

  const onSend = (text) => {
    const now = '14:' + String(15 + extra.length).padStart(2, '0');
    setExtra((x) => [...x, { role: 'user', text, time: now }]);
    setThinking(true);
    setTimeout(() => { setThinking(false); setExtra((x) => [...x, { role: 'agent', time: now, text: 'On it. I’ll fold that into T-4F2B and report back here when the checks settle.' }]); }, 1800);
  };

  const channels = D.channels.map((c) => {
    if (c.id === 'vo' && resolved) return { ...c, needs: 1 };
    if (c.id === 'conductor' && resolved) return { ...c, threads: [{ id: 't-4f29', title: 'Volero checkout drop-off', state: 'running' }] };
    return c;
  });
  const conductor = { state: thinking ? 'thinking' : resolved ? 'delegating' : 'attention', needs: resolved ? 0 : 1, running: 1 };
  const ch = D.channels.find((c) => c.id === view && c.id !== 'conductor');
  const tabs = [
    { id: 'conductor', title: 'Volero checkout drop-off', taskId: 'T-4F29', state: resolved ? 'running' : 'needs' },
    { id: 'vo', title: '#Volero', kind: 'panel' },
    { id: 't2b', title: 'Patch shipping-rate script', taskId: 'T-4F2B', state: 'running' },
    { id: 'art', title: 'funnel-before-after.html', kind: 'artifact', state: 'done' },
    { id: 't2c', title: 'WEEKEND15 automation', taskId: 'T-4F2C', state: resolved ? 'settled' : 'needs' },
    { id: 'te11', title: 'Returns page copy review', taskId: 'T-4E11' }
  ];
  const go = (id) => {
    if (id === 'home') return setView('conductor');
    if (id === 'conductor' || D.channels.some((c) => c.id === id)) return setView(id);
    setView('conductor');
  };
  const onPick = (it) => {
    setPalette(false);
    if (it.action === 'light' || it.action === 'dark') setTheme(it.action);
    else if (it.action === 'density') setDensity((d) => (d === 'compact' ? 'comfortable' : 'compact'));
    else if (it.target) go(it.target);
  };
  const active = ch ? ch.id : view;

  return (
    <div style={{ position: 'relative', display: 'flex', height: '100vh', padding: '8px 8px 8px 0', boxSizing: 'border-box', background: 'var(--chrome)', color: 'var(--fg)', overflow: 'hidden' }}>
      <Rail channels={channels} activeId={active} onSelect={go} conductor={conductor} onJump={() => setPalette(true)} onNew={() => setView('vo')}
        usage={D.usage} usageFooter={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>{[['claude-code', '4/6'], ['codex', '2/4'], ['cursor', '1/2']].map(([h, n]) => <span key={h} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><HarnessLogo harness={h} size={11} />{n}</span>)}<span>running</span></span>} theme={theme} onTheme={setTheme} />
      <main style={{ position: 'relative', flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', borderRadius: 22, background: 'var(--bg)', boxShadow: 'var(--shadow-card)', overflow: 'hidden' }}>
        <TabStack tabs={tabs} activeId={view === 'conductor' ? 'conductor' : active} visible={3} onSelect={go}>
          <IconButton label={density === 'compact' ? 'Comfortable density' : 'Compact density'} icon="sliders" iconSize={15} active={density === 'compact'} onClick={() => setDensity((d) => (d === 'compact' ? 'comfortable' : 'compact'))} />
          {view === 'conductor' && <IconButton label="PR panel" icon="panel" iconSize={15} active={panel} onClick={() => setPanel(!panel)} />}
        </TabStack>
        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
          {view === 'conductor' && <ConductorScreen resolved={resolved} onResolve={() => setResolved(true)} extra={extra} onSend={onSend} thinking={thinking} showPanel={panel} />}
          {ch && <ChannelScreen key={ch.id} channel={ch} onOpenConductor={() => setView('conductor')} />}
        </div>
      </main>
      {toast && <div style={{ position: 'absolute', right: 20, bottom: 20, zIndex: 60 }}><Toast status="done" title={toast.title} body={toast.body} onAction={() => { setToast(null); setView('vo'); }} onDismiss={() => setToast(null)} /></div>}
      {palette && <CommandPalette items={D.palette} onSelect={onPick} onClose={() => setPalette(false)} initialQuery={q.get('q') || ''} />}
    </div>
  );
}

Object.assign(window, { App });
