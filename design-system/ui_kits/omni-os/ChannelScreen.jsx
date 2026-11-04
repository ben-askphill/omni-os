/* Channel page (web/src pages/Channel.tsx): avatar + #name header, link pills, segmented tabs, big composer, thread groups. */
function ChannelScreen({ channel, onOpenConductor }) {
  const { ThreadRow, ThreadGroup, Monogram, Segmented, Composer, Icon, StatusGlyph } = window.OmniOS;
  const D = window.OMNI_DATA;
  const isVo = channel.id === 'vo';
  const [tab, setTab] = React.useState('threads');
  const [filter, setFilter] = React.useState('all');
  const hot = isVo ? D.hot : D.hot.slice(0, (channel.needs || 0) + (channel.running || 0)).map((t, i) => ({ ...t, state: i < (channel.needs || 0) ? 'needs' : 'running' }));
  const quiet = isVo ? D.quiet : D.quiet.slice(8, 22);
  const all = [...hot, ...quiet];
  const n = (s) => all.filter((t) => t.state === s).length;
  const pass = (t) => filter === 'all' || t.state === filter;
  const byGroup = [];
  quiet.forEach((t) => { let g = byGroup.find((x) => x[0] === t.group); if (!g) byGroup.push((g = [t.group, []])); g[1].push(t); });
  const pill = { display: 'inline-flex', alignItems: 'center', gap: 6, height: 28, maxWidth: '100%', padding: '0 10px', borderRadius: 999, background: 'var(--surface)', font: '400 12px/1 var(--font-sans)', color: 'var(--fg-2)', textDecoration: 'none' };
  return (
    <div style={{ flex: 1, minWidth: 0, overflowY: 'auto' }}>
      <div style={{ maxWidth: 768, margin: '0 auto', padding: '40px clamp(16px, 4vw, 32px) 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Monogram name={channel.name} size={44} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="om-caption" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              Client
              {channel.running > 0 && <span className="om-badge" style={{ letterSpacing: 'inherit' }}><StatusGlyph state="running" size={6} />{channel.running} running</span>}
              {channel.needs > 0 && <span className="om-badge om-badge--needs" style={{ letterSpacing: 'inherit' }}><StatusGlyph state="needs" size={7} />{channel.needs} need you</span>}
            </div>
            <h1 className="om-display" style={{ margin: 0, fontSize: 30, lineHeight: 1.1, display: 'flex', gap: 4 }}><span style={{ color: 'var(--fg-4)' }}>#</span><span>{channel.name}</span></h1>
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 16 }}>
          <a href="#" style={pill}><Icon name="globe" size={13} style={{ color: 'var(--fg-3)' }} />{channel.domain || channel.name.toLowerCase().replace(/\s+/g, '') + '.com'}</a>
          <a href="#" style={pill}><Icon name="branch" size={13} style={{ color: 'var(--fg-3)' }} />{channel.repo || channel.name.toLowerCase().replace(/\s+/g, '-') + '/theme'}</a>
          <span style={{ ...pill, background: 'transparent', boxShadow: 'inset 0 0 0 1px var(--line)', font: '400 11px/1 var(--font-mono)', color: 'var(--fg-4)' }}>{channel.path || '~/work/' + channel.id}</span>
        </div>
        <div style={{ marginTop: 20 }}><Segmented value={tab} onChange={setTab} options={[{ id: 'threads', label: 'Threads' }, { id: 'prs', label: 'PRs', count: 2 }, { id: 'settings', label: 'Settings' }]} /></div>
      </div>
      <div style={{ maxWidth: 768, margin: '0 auto', padding: '24px clamp(16px, 4vw, 32px) 64px' }}>
        <Composer big up={false} hints={false} placeholder={'Start a thread in #' + channel.name} role="builder" channel={{ name: channel.name }} />
        <div style={{ margin: '28px 0 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <Segmented size="sm" value={filter} onChange={setFilter} options={[{ id: 'all', label: 'All', count: all.length }, { id: 'needs', label: 'Needs you', count: n('needs') }, { id: 'running', label: 'Running', count: n('running') }, { id: 'done', label: 'Just done', count: n('done') }]} />
          <button type="button" className="om-btn om-btn--ghost om-btn--sm" onClick={onOpenConductor}>Ask the Conductor</button>
        </div>
        <div style={{ display: 'grid', gap: 16 }}>
          {[['Needs you', 'needs'], ['Running', 'running'], ['Just done', 'done']].map(([label, s]) => {
            const rows = hot.filter((t) => t.state === s && pass(t));
            return rows.length > 0 && <ThreadGroup key={s} label={label} count={rows.length}>{rows.map((t) => <ThreadRow key={t.taskId} {...t} onClick={t.taskId === 'T-4F2C' ? onOpenConductor : undefined} />)}</ThreadGroup>;
          })}
          {filter === 'all' && byGroup.map(([g, rows]) => <ThreadGroup key={g} label={g} count={rows.length}>{rows.map((t) => <ThreadRow key={t.taskId} {...t} />)}</ThreadGroup>)}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { ChannelScreen });
