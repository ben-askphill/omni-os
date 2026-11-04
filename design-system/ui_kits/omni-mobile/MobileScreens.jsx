/* Omni mobile: tab roots (Activity, Channels, Library) and Settings. */
function MoScroll({ children, bottom = 120 }) {
  return <div className="mo-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingBottom: bottom, display: 'flex', flexDirection: 'column', gap: 22 }}>{children}</div>;
}

function MoEmpty({ children }) {
  return <p style={{ margin: 0, padding: '18px 20px', font: '400 14px/1.5 var(--font-sans)', color: 'var(--fg-3)', textWrap: 'pretty' }}>{children}</p>;
}

function ActivityScreen({ app }) {
  const { OmniMark, Segmented } = OM();
  const [f, setF] = React.useState(app.initialFilter || 'all');
  const all = app.items;
  const needs = all.filter((t) => t.state === 'needs');
  const open = needs.filter((t) => !app.resolved[t.id]);
  const running = all.filter((t) => t.state === 'running');
  const done = all.filter((t) => t.state === 'done');
  const opts = [{ id: 'all', label: 'All' }, { id: 'needs', label: 'Needs you', count: open.length }, { id: 'running', label: 'Running', count: running.length }, { id: 'done', label: 'Done', count: done.length }];
  const rows = (list) => <div style={{ display: 'flex', flexDirection: 'column' }}>{list.map((t, i) => <MoRow key={t.id} it={t} last={i === list.length - 1} onOpen={() => app.open(t.id)} />)}</div>;
  const cards = (list) => list.length ? <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{list.map((t) => <MoDecision key={t.id} it={t} app={app} />)}</div> : <MoEmpty>Nothing waits on you. {running.length} threads are running.</MoEmpty>;
  return (
    <>
      <MoHeader
        left={<button type="button" aria-label="Open the Conductor" onClick={() => app.open('T-4F29')} className="mo-press" style={{ all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, padding: '0 6px', height: 40 }}>
          <OmniMark size={30} state={open.length && !app.resolved['T-4F2C'] ? 'attention' : 'delegating'} interactive={false} />
          <span style={{ font: '500 14px/1 var(--font-sans)' }}>Conductor</span>
        </button>}
        right={<MoRound icon="search" label="Search threads" onClick={() => app.setSheet({ name: 'search' })} />}
      />
      <MoScroll>
        <div>
          <MoTitle title="Activity" sub={`Friday 23 October · ${running.length} running · ${open.length} ${open.length === 1 ? 'needs' : 'need'} you`} />
          <div style={{ padding: '0 16px' }}><Segmented options={opts} value={f} onChange={setF} label="Filter" /></div>
        </div>
        {(f === 'all' || f === 'needs') && <MoSection title="Needs you" count={open.length}>{cards(needs)}</MoSection>}
        {(f === 'all' || f === 'running') && <MoSection title="Running" count={running.length}>{rows(running)}</MoSection>}
        {(f === 'all' || f === 'done') && <MoSection title="Done today" count={done.length}>{rows(done)}</MoSection>}
      </MoScroll>
    </>
  );
}

function ChannelsScreen({ app }) {
  const { Monogram, StatusGlyph, OmniMark } = OM();
  const chs = window.MOBILE.channels;
  const groups = [['Clients', 'client'], ['Internal', 'internal'], ['Personal', 'personal']];
  const total = chs.reduce((n, c) => n + (c.running || 0), 0);
  const counts = (c) => <>
    {c.needs > 0 && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><StatusGlyph state="needs" size={8} />{c.needs}</span>}
    {c.running > 0 && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><StatusGlyph state="running" size={8} />{c.running}</span>}
  </>;
  return (
    <>
      <MoHeader left={<span style={{ width: 40 }} />} right={<>
        <MoRound icon="search" label="Search channels" onClick={() => app.setSheet({ name: 'search' })} />
        <MoRound label="Settings" onClick={() => app.push({ name: 'settings' })}><span style={{ font: '600 14px/1 var(--font-rounded)' }}>B</span></MoRound>
      </>} />
      <MoScroll>
        <MoTitle title="Channels" sub={`${chs.length} channels · ${total} threads running`} />
        <div style={{ padding: '0 16px' }}>
          <MoGroup><MoListRow icon={<OmniMark size={22} state="delegating" interactive={false} />} label="Conductor" sub="Delegates to crew threads in every channel" onClick={() => app.open('T-4F29')} last /></MoGroup>
        </div>
        {groups.map(([label, kind]) => {
          const list = chs.filter((c) => c.kind === kind);
          return (
            <MoSection key={kind} title={label} count={list.length}>
              <MoGroup>{list.map((c, i) => <MoListRow key={c.id} icon={<Monogram code={c.code} name={c.name} size={30} />} label={'#' + c.name} sub={c.domain || c.repo} right={counts(c)} onClick={() => app.push({ name: 'channel', id: c.id })} last={i === list.length - 1} />)}</MoGroup>
            </MoSection>
          );
        })}
      </MoScroll>
    </>
  );
}

function ChannelScreen({ app, id }) {
  const { Segmented } = OM();
  const c = window.MOBILE.channels.find((x) => x.id === id) || window.MOBILE.channels[0];
  const [f, setF] = React.useState('active');
  const mine = app.items.filter((t) => t.ch === c.name);
  const active = mine.filter((t) => t.state !== 'done');
  const recent = [...mine.filter((t) => t.state === 'done'), ...(c.id === 'vo' ? window.MOBILE.quiet.slice(0, 8).map((q) => ({ ...q, id: q.taskId, ch: c.name, state: 'done' })) : [])];
  const list = f === 'active' ? active : recent;
  return (
    <>
      <MoHeader onBack={app.back} title={'#' + c.name} sub={[c.kind === 'client' ? 'Client' : c.kind === 'internal' ? 'Internal' : 'Personal', c.domain, c.repo].filter(Boolean).join(' · ')} right={<MoRound icon="more" label="Channel options" onClick={() => app.toast('Channel settings live on the Mac')} />} />
      <MoScroll bottom={20}>
        <div style={{ padding: '8px 16px 0' }}><Segmented options={[{ id: 'active', label: 'Active', count: active.length }, { id: 'recent', label: 'Recent', count: recent.length }]} value={f} onChange={setF} label="Threads" /></div>
        <MoSection title={f === 'active' ? 'Needs you and running' : 'Done'}>
          {list.length ? <div style={{ display: 'flex', flexDirection: 'column' }}>{list.map((t, i) => <MoRow key={t.id + i} it={t} last={i === list.length - 1} onOpen={() => app.open(t.id)} />)}</div>
            : <MoEmpty>Nothing running in #{c.name}. Start a thread below; crew threads the Conductor delegates here show up too.</MoEmpty>}
        </MoSection>
      </MoScroll>
      <div style={{ flex: 'none', padding: '8px 16px 34px' }}>
        <button type="button" onClick={() => app.setSheet({ name: 'new', target: c.id })} className="mo-press" style={{ width: '100%', height: 52, borderRadius: 999, border: 0, cursor: 'pointer', background: 'var(--fg)', color: 'var(--on-ink)', font: '500 15px/1 var(--font-sans)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}><MoIcon name="plus" size={18} />New thread in #{c.name}</button>
      </div>
    </>
  );
}

function LibraryScreen({ app }) {
  const { Segmented } = OM();
  const [f, setF] = React.useState('all');
  const arts = window.MOBILE.artifacts.filter((a) => f === 'all' || a.type === f);
  const openArt = (a) => (a.type === 'pr' ? app.push({ name: 'pr' }) : app.push({ name: 'viewer', art: a }));
  return (
    <>
      <MoHeader left={<span style={{ width: 40 }} />} right={<MoRound icon="search" label="Search artifacts" onClick={() => app.setSheet({ name: 'search' })} />} />
      <MoScroll>
        <div>
          <MoTitle title="Library" sub="Reports, PRs and files from every channel" />
          <div style={{ padding: '0 16px' }}><Segmented options={[{ id: 'all', label: 'All' }, { id: 'report', label: 'Reports' }, { id: 'pr', label: 'PRs' }, { id: 'file', label: 'Files' }]} value={f} onChange={setF} label="Type" /></div>
        </div>
        <div style={{ padding: '0 16px', display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 10 }}>
          {arts.map((a, i) => (
            <button key={a.id} type="button" onClick={() => openArt(a)} className="mo-press" style={{ all: 'unset', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 8, padding: 6, borderRadius: 18, background: 'var(--surface)', gridColumn: i === 0 && f === 'all' ? '1 / -1' : undefined }}>
              <div style={{ height: i === 0 && f === 'all' ? 170 : 110, borderRadius: 13, overflow: 'hidden', background: 'var(--elev)', boxShadow: 'var(--shadow-card)', position: 'relative' }}>
                {a.live ? <iframe title={a.name} srcDoc={window.MOBILE.funnel} style={{ border: 0, width: 640, height: 320, transform: 'scale(0.53)', transformOrigin: '0 0', pointerEvents: 'none', background: '#fff' }} />
                  : a.type === 'pr' ? <div style={{ height: '100%', padding: 12, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}><MoIcon name="pr" size={20} /><span style={{ font: '400 12px/1.3 var(--font-sans)', color: 'var(--fg-3)' }}>{a.name.startsWith('#812') ? <MoDiff add={214} del={38} /> : 'Merged'}</span></div>
                  : <MoStripes label={a.type === 'file' ? a.name.split('.').pop() : 'report'} height={'100%'} radius={0} />}
              </div>
              <div style={{ padding: '0 6px 6px', display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ font: a.type === 'pr' ? '400 13px/1.3 var(--font-sans)' : '400 12.5px/1.3 var(--font-mono)', ...moEllipsis }}>{a.name}</span>
                <span style={{ font: '400 12px/1.3 var(--font-sans)', color: 'var(--fg-3)', ...moEllipsis }}>#{a.ch} · {a.time}</span>
              </div>
            </button>
          ))}
        </div>
      </MoScroll>
    </>
  );
}

function SettingsScreen({ app }) {
  const { Segmented, StatusGlyph } = OM();
  const M = window.MOBILE;
  return (
    <>
      <MoHeader onBack={app.back} title="Settings" sub="Ben · omni on ben-mbp" />
      <MoScroll bottom={40}>
        <MoSection title="Appearance">
          <Segmented options={[{ id: 'light', label: 'Light', icon: 'sun' }, { id: 'dark', label: 'Dark', icon: 'moon' }]} value={app.theme} onChange={app.setTheme} label="Theme" />
        </MoSection>
        <MoSection title="Usage" right={<span style={{ font: '400 12px var(--font-sans)', color: 'var(--fg-3)' }}>5h window</span>}>
          <MoGroup>{M.usage.map((u, i) => (
            <div key={u.name} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderTop: i ? '1px solid var(--line)' : 0 }}>
              <span style={{ width: 56, font: '400 14px var(--font-sans)' }}>{u.name}</span>
              <span style={{ flex: 1, height: 6, borderRadius: 99, background: 'var(--surface-3)', overflow: 'hidden' }}><span style={{ display: 'block', height: '100%', width: u.five * 100 + '%', background: u.five > 0.9 ? 'var(--warn)' : 'var(--fg)', borderRadius: 99 }} /></span>
              <span style={{ width: 36, textAlign: 'right', font: '400 13px var(--font-sans)', color: 'var(--fg-3)', fontVariantNumeric: 'tabular-nums' }}>{Math.round(u.five * 100)}%</span>
            </div>
          ))}</MoGroup>
        </MoSection>
        <MoSection title="Automations" count={M.automations.length}>
          <MoGroup>{M.automations.map((a, i) => <MoListRow key={a.name} icon={<StatusGlyph state={a.state} size={9} />} label={a.name} sub={a.when + ' · ' + a.last} chevron={false} last={i === M.automations.length - 1} />)}</MoGroup>
        </MoSection>
        <MoSection title="Mac">
          <MoGroup>
            <MoListRow icon="monitor" label="ben-mbp" sub="Connected over Tailscale · synced 1m ago" chevron={false} />
            <MoListRow icon="key" label="Secrets" sub="Managed on the Mac" chevron={false} />
            <MoListRow icon="bell" label="Notifications" sub="Needs you and Done" onClick={() => app.toast('Opens iOS notification settings')} last />
          </MoGroup>
        </MoSection>
      </MoScroll>
    </>
  );
}

function SearchSheet({ app }) {
  const [q, setQ] = React.useState('');
  const list = app.items.filter((t) => !q || (t.title + ' ' + t.ch + ' ' + t.id).toLowerCase().includes(q.toLowerCase()));
  return (
    <MoSheet full onClose={() => app.setSheet(null)}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 12px 6px' }}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, height: 44, padding: '0 14px', borderRadius: 999, background: 'var(--surface-2)', color: 'var(--fg-3)' }}>
          <MoIcon name="search" size={16} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Threads, channels, T- ids" style={{ flex: 1, minWidth: 0, border: 0, outline: 'none', background: 'transparent', color: 'var(--fg)', font: '400 15px var(--font-sans)' }} />
        </div>
        <button type="button" onClick={() => app.setSheet(null)} style={{ border: 0, background: 'transparent', color: 'var(--fg)', font: '500 15px var(--font-sans)', padding: '0 6px', cursor: 'pointer' }}>Cancel</button>
      </div>
      <div className="mo-scroll" style={{ flex: 1, overflowY: 'auto', padding: '6px 16px' }}>
        {list.map((t, i) => <MoRow key={t.id} it={t} last={i === list.length - 1} onOpen={() => { app.setSheet(null); app.open(t.id); }} />)}
      </div>
    </MoSheet>
  );
}

Object.assign(window, { MoScroll, MoEmpty, ActivityScreen, ChannelsScreen, ChannelScreen, LibraryScreen, SettingsScreen, SearchSheet });
