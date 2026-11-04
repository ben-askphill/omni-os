/* Omni mobile: router, new-delegation sheet, lock screen, device frame. */
function NewSheet({ app, target: t0 }) {
  const { HarnessMark, OmniMark, Monogram } = OM();
  const chs = window.MOBILE.channels.slice(0, 6);
  const [target, setTarget] = React.useState(t0 || 'conductor');
  const [v, setV] = React.useState('');
  const ch = chs.find((c) => c.id === target);
  const send = () => {
    if (!v.trim()) return;
    app.setSheet(null);
    app.create({ prompt: v.trim(), ch: ch ? ch.name : 'Conductor', role: ch ? 'builder' : 'conductor' });
  };
  const pill = (on) => ({ flex: 'none', height: 36, display: 'inline-flex', alignItems: 'center', gap: 7, padding: '0 12px 0 6px', borderRadius: 999, border: 0, cursor: 'pointer', font: '500 13.5px/1 var(--font-sans)', background: on ? 'var(--fg)' : 'var(--surface-2)', color: on ? 'var(--on-ink)' : 'var(--fg)' });
  return (
    <MoSheet onClose={() => app.setSheet(null)}>
      <div style={{ display: 'flex', alignItems: 'center', padding: '6px 12px 8px' }}>
        <button type="button" onClick={() => app.setSheet(null)} style={{ border: 0, background: 'transparent', color: 'var(--fg)', font: '400 15px var(--font-sans)', padding: '8px 6px', cursor: 'pointer' }}>Cancel</button>
        <span style={{ flex: 1, textAlign: 'center', font: '500 15px var(--font-sans)' }}>{ch ? 'New thread' : 'New delegation'}</span>
        <span style={{ width: 60 }} />
      </div>
      <div className="mo-scroll" style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '0 16px 12px' }}>
        <button type="button" onClick={() => setTarget('conductor')} style={pill(target === 'conductor')}><span style={{ width: 24, height: 24, borderRadius: 99, background: 'var(--bg)', display: 'grid', placeItems: 'center' }}><OmniMark size={18} state="idle" interactive={false} /></span>Conductor</button>
        {chs.map((c) => <button key={c.id} type="button" onClick={() => setTarget(c.id)} style={pill(target === c.id)}><Monogram code={c.code} name={c.name} size={24} />#{c.name}</button>)}
      </div>
      <div style={{ margin: '0 12px', borderRadius: 26, background: 'var(--surface)', padding: '14px 8px 8px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <textarea value={v} onChange={(e) => setV(e.target.value)} rows={4} placeholder={ch ? `Describe the task for #${ch.name}` : 'Ask the Conductor. It delegates to the crew.'}
          style={{ resize: 'none', border: 0, outline: 'none', background: 'transparent', color: 'var(--fg)', font: '400 16px/1.45 var(--font-sans)', padding: '0 8px' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <MoRound icon="plus" label="Attach" />
          <button type="button" onClick={() => app.toast('Model and effort: tap to change')} style={{ height: 40, display: 'inline-flex', alignItems: 'center', gap: 7, padding: '0 12px', borderRadius: 999, border: 0, cursor: 'pointer', background: 'var(--surface-2)', color: 'var(--fg)', font: '500 13px var(--font-sans)' }}><HarnessMark harness="claude-code" />{ch ? 'Sonnet 5.5' : 'Opus 5.5'} · High</button>
          <span style={{ flex: 1 }} />
          {v.trim() ? <MoRound ink icon="send" label="Send" onClick={send} /> : <MoRound ink icon="mic" label="Dictate" />}
        </div>
      </div>
      <p style={{ margin: 0, padding: '10px 24px 0', font: '400 12.5px/1.45 var(--font-sans)', color: 'var(--fg-3)' }}>{ch ? `Runs in #${ch.name} with its repo, store and browser profile.` : 'The Conductor picks the crew and reports back here. You get a notification when something needs you.'}</p>
    </MoSheet>
  );
}

function MobileApp({ initial = {}, theme, setTheme }) {
  const M = window.MOBILE;
  const [tab, setTabS] = React.useState(initial.tab || 'activity');
  const [stack, setStack] = React.useState(initial.stack || []);
  const [sheet, setSheet] = React.useState(initial.sheet || null);
  const [resolved, setResolved] = React.useState(initial.resolved || {});
  const [extra, setExtra] = React.useState([]);
  const [toast, setToastS] = React.useState(null);
  const tRef = React.useRef();
  const items = [...extra, ...M.items];
  const find = (id) => (id === M.conductor.id ? M.conductor : items.find((t) => t.id === id));
  const showToast = (text) => { clearTimeout(tRef.current); setToastS({ text, k: Date.now() }); tRef.current = setTimeout(() => setToastS(null), 2200); };
  const app = {
    items, resolved, theme, setTheme, find, initialFilter: initial.filter,
    push: (s) => setStack((st) => [...st, s]),
    back: () => setStack((st) => st.slice(0, -1)),
    open: (id) => setStack((st) => [...st, { name: 'thread', id }]),
    setSheet, toast: showToast,
    resolve: (id, on, msg) => { setResolved((r) => ({ ...r, [id]: on })); if (on) showToast(msg || (find(id) || {}).doneText || 'Done'); },
    create: ({ prompt, ch, role }) => {
      const id = 'T-4F3' + (extra.length + 1);
      const t = { id, state: 'running', role, harness: 'claude-code', ch, time: 'now', meta: 'step 1/4', nowVerb: 'Reading', now: 'your ask', title: prompt.length > 60 ? prompt.slice(0, 58) + '…' : prompt, prompt, plan: ['Read the ask', role === 'conductor' ? 'Pick crew roles' : 'Plan the change', role === 'conductor' ? 'Delegate' : 'Make the change', 'Report back'], step: 1 };
      setExtra((x) => [t, ...x]);
      setStack((st) => [...st, { name: 'thread', id }]);
    }
  };
  const setTab = (t) => { setTabS(t); setStack([]); };
  const screen = (s) => {
    switch (s.name) {
      case 'thread': return <ThreadScreen app={app} id={s.id} />;
      case 'channel': return <ChannelScreen app={app} id={s.id} />;
      case 'settings': return <SettingsScreen app={app} />;
      case 'steps': return <StepsScreen app={app} id={s.id} />;
      case 'pr': return <PRScreen app={app} />;
      case 'details': return <DetailsScreen app={app} id={s.id} />;
      case 'terminal': return <TerminalScreen app={app} id={s.id} />;
      case 'browser': return <BrowserScreen app={app} id={s.id} />;
      case 'viewer': return <ViewerScreen app={app} art={s.art} />;
      default: return null;
    }
  };
  const root = tab === 'channels' ? <ChannelsScreen app={app} /> : tab === 'library' ? <LibraryScreen app={app} /> : <ActivityScreen app={app} />;
  const top = stack[stack.length - 1];
  const needs = M.items.filter((t) => t.state === 'needs' && !resolved[t.id]).length;
  const layer = { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg)' };
  return (
    <div data-theme={theme} style={{ position: 'relative', isolation: 'isolate', height: '100%', overflow: 'hidden', background: 'var(--bg)', color: 'var(--fg)', fontFamily: 'var(--font-sans)' }}>
      <div key={'tab-' + tab} style={{ ...layer, animation: 'mo-fade 220ms var(--ease-out)' }}>{root}</div>
      {stack.map((s, i) => <div key={i + s.name + (s.id || '')} style={{ ...layer, zIndex: 10 + i, animation: i === stack.length - 1 ? 'mo-push 420ms var(--ease-spring)' : 'none' }}>{screen(s)}</div>)}
      {!top && <MoTabBar tab={tab} onTab={setTab} onNew={() => setSheet({ name: 'new' })} needs={needs} />}
      {sheet && sheet.name === 'new' && <NewSheet app={app} target={sheet.target} />}
      {sheet && sheet.name === 'search' && <SearchSheet app={app} />}
      {sheet && sheet.name === 'menu' && <MenuSheet app={app} id={sheet.id} />}
      {sheet && sheet.name === 'plus' && <PlusSheet app={app} harness={sheet.harness} />}
      {toast && <MoToast key={toast.k} text={toast.text} />}
    </div>
  );
}

/* Lock screen: Live Activity for running crew + an actionable Needs you notification that deep-links to the decision. */
function LockScreen({ onOpen, resolved, onResolve }) {
  const { StatusGlyph, StaticMark } = OM();
  const M = window.MOBILE;
  const running = M.items.filter((t) => t.state === 'running');
  const glass = { background: 'rgb(236 234 229 / 0.1)', borderRadius: 24, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 };
  const head = (label, time) => <div style={{ display: 'flex', alignItems: 'center', gap: 8, font: '500 12.5px/1 var(--font-sans)', color: '#b8b7b1' }}><span style={{ width: 22, height: 22, borderRadius: 7, background: '#eceae5', color: '#17181a', display: 'grid', placeItems: 'center' }}><StaticMark size={15} /></span>{label}<span style={{ flex: 1 }} />{time}</div>;
  const btn = { flex: 1, height: 40, borderRadius: 999, border: 0, cursor: 'pointer', font: '500 14px var(--font-sans)' };
  return (
    <div className="scheme-dark" style={{ height: '100%', background: 'var(--chrome)', color: '#eceae5', fontFamily: 'var(--font-sans)', display: 'flex', flexDirection: 'column', padding: '70px 12px 44px', boxSizing: 'border-box' }}>
      <div style={{ textAlign: 'center', font: '500 18px/1 var(--font-sans)', color: '#b8b7b1' }}>Friday 23 October</div>
      <div style={{ textAlign: 'center', font: '300 92px/1 var(--font-head)', letterSpacing: '-0.02em', marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>18:42</div>
      <span style={{ flex: 1 }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={glass}>
          {head('Omni', 'now')}
          <button type="button" onClick={() => onOpen('T-4F2C')} style={{ all: 'unset', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 7, font: '600 15px/1.3 var(--font-sans)' }}>{!resolved && <StatusGlyph state="needs" size={8} />}{resolved ? 'Paused WEEKEND15' : 'store-ops needs you in #Volero'}</span>
            <span style={{ font: '400 14.5px/1.4 var(--font-sans)', color: '#d6d4cf' }}>{resolved ? 'store-ops is carrying on. The builder’s fix is in review as #812.' : 'Pause WEEKEND15 until the shipping patch ships? It hides the rate step for about 30% of NL carts.'}</span>
          </button>
          {!resolved && <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={onResolve} className="mo-press" style={{ ...btn, background: 'var(--vermilion)', color: 'var(--ink)' }}>Pause WEEKEND15</button>
            <button type="button" onClick={() => onOpen('T-4F2C')} className="mo-press" style={{ ...btn, background: 'rgb(236 234 229 / 0.14)', color: '#eceae5' }}>Open</button>
          </div>}
        </div>
        <button type="button" onClick={() => onOpen('T-4F2A')} style={{ ...glass, all: undefined, border: 0, textAlign: 'left', color: 'inherit', cursor: 'pointer' }}>
          {head('Omni', '4m ago')}
          <span style={{ display: 'flex', alignItems: 'center', gap: 7, font: '600 15px/1.3 var(--font-sans)' }}><StatusGlyph state="done" size={8} />Done · Checkout drop-off after Friday’s deploy</span>
          <span style={{ font: '400 14.5px/1.4 var(--font-sans)', color: '#d6d4cf' }}>Shipping → payment fell from 78.3% to 52.1% the minute the new script went live. Report attached.</span>
        </button>
        <div style={{ ...glass, gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', font: '500 15px/1 var(--font-sans)' }}>{running.length} running<span style={{ color: '#908f89', fontWeight: 400 }}>&nbsp;· {resolved ? 2 : 3} need you</span></div>
          {running.slice(0, 3).map((t) => (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 9, font: '400 13.5px/1.3 var(--font-sans)' }}>
              <StatusGlyph state="running" size={7} /><span style={{ flex: 1, minWidth: 0, ...moEllipsis }}>{t.title}</span><span style={{ color: '#908f89', fontVariantNumeric: 'tabular-nums' }}>{t.time}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MoFrame({ initial, dark = false, lock = false }) {
  const [theme, setTheme] = React.useState(dark ? 'dark' : 'light');
  const [locked, setLocked] = React.useState(lock);
  const [res, setRes] = React.useState({});
  const [start, setStart] = React.useState(initial || {});
  const onOpen = (id) => { setStart({ stack: [{ name: 'thread', id }], resolved: res }); setLocked(false); };
  return (
    <IOSDevice width={390} height={844} dark={locked || theme === 'dark'}>
      {locked ? <LockScreen resolved={res['T-4F2C']} onResolve={() => setRes({ 'T-4F2C': true })} onOpen={onOpen} />
        : <MobileApp key={JSON.stringify(start)} initial={start} theme={theme} setTheme={setTheme} />}
    </IOSDevice>
  );
}

Object.assign(window, { NewSheet, MobileApp, LockScreen, MoFrame });
