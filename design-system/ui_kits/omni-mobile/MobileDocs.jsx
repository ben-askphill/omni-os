/* Omni mobile design system page: specimens of the mobile parts + live screens. Needs MobileParts/Screens/Thread/App loaded first. */
const MDS_TOC = [
  ['Foundations', [['principles', 'target', 'Principles'], ['layout', 'grid', 'Layout and touch']]],
  ['Navigation', [['tabbar', 'menu', 'Tab bar'], ['headers', 'chevronLeft', 'Headers'], ['sheets', 'layers', 'Sheets']]],
  ['Activity', [['decisions', 'inbox', 'Decision cards'], ['rows', 'panel', 'Thread rows'], ['lists', 'hash', 'Grouped lists']]],
  ['Thread', [['transcript', 'message', 'Transcript'], ['work', 'tool', 'Work in progress'], ['results', 'file', 'Results'], ['composer', 'send', 'Composer']]],
  ['Screens', [['screens', 'monitor', 'Live screens'], ['lock', 'bell', 'Lock screen']]]
];

function useMockApp() {
  const M = window.MOBILE;
  const [resolved, setR] = React.useState({});
  const noop = () => {};
  return { items: M.items, resolved, find: (id) => (id === M.conductor.id ? M.conductor : M.items.find((t) => t.id === id)), resolve: (id, on) => setR((r) => ({ ...r, [id]: on })), open: noop, push: noop, back: noop, setSheet: noop, toast: noop, theme: 'light', setTheme: noop };
}

function MdsSpec({ name, em, src, w, children }) {
  return (
    <div className={'mds-spec' + (w ? ' w' : '')}>
      <div className="mds-lab"><b>{name}</b>{em && <em>{em}</em>}{src && <span>{src}</span>}</div>
      {children}
    </div>
  );
}

/* A phone-width strip of mobile surface, so parts render at their real width. */
function MdsStrip({ children, h, pad = 0, cut = 0 }) {
  return (
    <div className="mds-strip" style={{ height: h, padding: pad }}>
      <div style={{ marginTop: -cut, display: 'flex', flexDirection: 'column', gap: 10, height: h ? `calc(100% + ${cut}px)` : undefined, position: 'relative' }}>{children}</div>
    </div>
  );
}

function MdsSec({ id, title, intro, min, children }) {
  return (
    <section className="mds-sec" id={id} data-screen-label={title}>
      <h2>{title}</h2>{intro && <p>{intro}</p>}
      <div className="mds-grid" style={{ '--min': (min || 390) + 'px' }}>{children}</div>
    </section>
  );
}

function MdsPhone({ name, note, init, dark, lock }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
      <MoFrame initial={init || {}} dark={dark} lock={lock} />
      <div className="mds-lab" style={{ flexDirection: 'column', alignItems: 'center', gap: 2, textAlign: 'center', maxWidth: 360 }}><b style={{ fontFamily: 'var(--font-sans)', fontSize: 14 }}>{name}</b>{note && <em>{note}</em>}</div>
    </div>
  );
}

function MobileDocs() {
  const { OmniMark, Segmented, StatusGlyph, Status } = OM();
  const M = window.MOBILE;
  const app = useMockApp();
  const [theme, setTheme] = React.useState('light');
  const [tab, setTab] = React.useState('activity');
  React.useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  const it = (id) => app.find(id);
  const LAYOUT = [['Status bar inset', '54', 'Top of every header'], ['Header', '52', '40pt round buttons, 12pt sides'], ['Large title', '30 / 1.1', 'Tab roots only'], ['Tab bar', '60', 'Floats 14pt in, 28pt up'], ['New delegation', '60', 'Ink disc beside the tab bar'], ['Round button', '40', 'Back, search, more, mic, send'], ['List row', '52 min', 'Grouped lists, 16pt inset'], ['Thread row', '36 avatar', 'Status glyph on the avatar'], ['Composer', '52 / r26', 'Chips above, 36pt high'], ['Card radius', '20', 'Decision, group, artifact'], ['Sheet radius', '28', 'Grabber 36 × 5'], ['Bottom inset', '30–34', 'Home indicator clearance']];
  return (
    <div className="mds-doc">
      <nav className="mds-toc scheme-dark" aria-label="Sections">
        <div style={{ height: 44, display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px', font: '500 14px var(--font-sans)', color: 'var(--fg)' }}><OmniMark size={22} state="idle" interactive={false} />Omni mobile</div>
        {MDS_TOC.map(([cap, links]) => (
          <React.Fragment key={cap}>
            <div className="cap">{cap}</div>
            {links.map(([id, ic, l]) => <a key={id} href={'#' + id}><MoIcon name={ic} size={15} />{l}</a>)}
          </React.Fragment>
        ))}
        <div className="cap">Canvas</div>
        <a href="ui_kits/omni-mobile/index.html"><MoIcon name="maximize" size={15} />All 15 phones</a>
      </nav>
      <main className="mds-main">
        <header className="mds-hero">
          <div style={{ flex: 1, minWidth: 280 }}>
            <OmniMark size={40} state="delegating" interactive={false} />
            <h1>Omni on a phone</h1>
            <p>The mobile design system. Same tokens and components as the desktop and Mac apps, recomposed for a thumb: status first, three tabs and a new-delegation button, threads that lead with the outcome. Every specimen is live.</p>
          </div>
          <div style={{ marginLeft: 'auto', width: 200 }}><Segmented options={[{ id: 'light', label: 'Light' }, { id: 'dark', label: 'Dark' }]} value={theme} onChange={setTheme} label="Appearance" /></div>
        </header>

        <section className="mds-sec" id="principles" data-screen-label="Principles">
          <h2>Principles</h2>
          <div className="mds-idx">
            {[['Status before input', 'The phone is for checking on agents. Home is Activity, not a composer. Needs you comes first and is answerable in place.'],
              ['One surface at a time', 'Desktop panels become full-screen pushes from the thread menu. No split views, no drawers.'],
              ['Outcome first', 'A finished thread opens on its summary and artifact. Steps fold into one row.'],
              ['Actions in the thumb zone', 'Tab bar, new delegation, action chips and slide-to-merge all sit in the bottom third.'],
              ['Watch, don’t drive', 'Terminal is read only, the browser is watch only. Secrets, logins and channel setup stay on the Mac.']].map(([b, t]) => <div key={b}><b>{b}</b>{t}</div>)}
          </div>
        </section>

        <MdsSec id="layout" title="Layout and touch" intro="Measurements in points on a 390 × 844 phone. Every hit target is 40pt or larger; primary actions are 48pt and up." min={520}>
          <MdsSpec name="Mobile metrics" em="pt" w>
            <div className="mds-tbl">{LAYOUT.map(([k, v, n]) => <div key={k}><span>{k}</span><code>{v}</code><em>{n}</em></div>)}</div>
          </MdsSpec>
        </MdsSec>

        <MdsSec id="tabbar" title="Tab bar" intro="Three labelled tabs in a floating pill, with the new-delegation disc beside it. The tab thumb springs between tabs. A needs glyph rides the Activity icon while anything waits on you. Hidden on pushed screens.">
          <MdsSpec name="MoTabBar" em="Activity · Channels · Library + new" src="MobileParts.jsx" w>
            <div className="mds-stage"><MdsStrip h={116}><MoTabBar tab={tab} onTab={setTab} onNew={() => {}} needs={3} /></MdsStrip></div>
          </MdsSpec>
        </MdsSec>

        <MdsSec id="headers" title="Headers" intro="Tab roots get a large title under a slim bar. Pushed screens get a back button, a one-line title and subtitle, and at most two trailing actions.">
          <MdsSpec name="MoHeader + MoTitle" em="tab root" src="MobileParts.jsx">
            <MdsStrip cut={54}>
              <MoHeader left={<span style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 6px' }}><OmniMark size={30} state="attention" interactive={false} /><span style={{ font: '500 14px var(--font-sans)' }}>Conductor</span></span>} right={<MoRound icon="search" label="Search" />} />
              <MoTitle title="Activity" sub="Friday 23 October · 4 running · 3 need you" />
            </MdsStrip>
          </MdsSpec>
          <MdsSpec name="MoHeader" em="pushed thread" src="MobileParts.jsx">
            <MdsStrip cut={54}>
              <MoHeader onBack={() => {}} title="Patch shipping-rate script in checkout" sub="#Volero · builder · Claude Code" right={<><Status state="running" /><MoRound icon="more" label="More" /></>} />
              <MoHeader left={<MoRound icon="x" label="Close" />} title={<span style={{ font: '400 13.5px var(--font-mono)' }}>funnel-before-after.html</span>} sub="#Volero · researcher" right={<MoRound icon="share" label="Share" />} />
            </MdsStrip>
          </MdsSpec>
        </MdsSec>

        <MdsSec id="sheets" title="Sheets" intro="Bottom sheets carry secondary choices: the thread menu, attach with model and effort, search, and new delegation. Scrim tap or grabber drag closes.">
          <MdsSpec name="MenuSheet" em="thread menu" src="MobileThread.jsx">
            <MdsStrip h={520}><MenuSheet app={app} id="T-4F2A" /></MdsStrip>
          </MdsSpec>
          <MdsSpec name="PlusSheet" em="attach · model · effort" src="MobileThread.jsx">
            <MdsStrip h={520}><PlusSheet app={app} harness="claude-code" /></MdsStrip>
          </MdsSpec>
        </MdsSec>

        <MdsSec id="decisions" title="Decision cards" intro="An agent question with the buttons to answer it, the same card in Activity and in the thread. Three kinds: confirm, draft to approve, and pick an option. Answering collapses it to a strip with Undo.">
          <MdsSpec name="MoDecision" em="confirm" src="MobileParts.jsx"><MdsStrip pad={16}><MoDecision it={it('T-4F2C')} app={app} /></MdsStrip></MdsSpec>
          <MdsSpec name="MoDecision" em="draft" src="MobileParts.jsx"><MdsStrip pad={16}><MoDecision it={it('T-4F1E')} app={app} /></MdsStrip></MdsSpec>
          <MdsSpec name="MoDecision" em="choice" src="MobileParts.jsx"><MdsStrip pad={16}><MoDecision it={it('T-4E91')} app={app} /></MdsStrip></MdsSpec>
          <MdsSpec name="MoResolved" em="after answering" src="MobileParts.jsx"><MdsStrip pad={16}><MoResolved it={it('T-4F2C')} onUndo={() => {}} /><MoResolved it={it('T-4F1E')} onUndo={() => {}} /></MdsStrip></MdsSpec>
        </MdsSec>

        <MdsSec id="rows" title="Thread rows" intro="One row everywhere a thread is listed: Activity, channel, search. Crew mark with a status glyph, title, channel and progress, diff or artifact count on the right. Settled titles drop to fg-2.">
          <MdsSpec name="MoRow" em="running · done" src="MobileParts.jsx" w>
            <MdsStrip pad={'6px 16px'}>
              <div>{[...M.items.filter((t) => t.state === 'running').slice(0, 2), ...M.items.filter((t) => t.state === 'done').slice(0, 2)].map((t, i) => <MoRow key={t.id} it={t} last={i === 3} onOpen={() => {}} />)}</div>
            </MdsStrip>
          </MdsSpec>
          <MdsSpec name="MoSection" em="list heading with count" src="MobileParts.jsx">
            <MdsStrip pad={'14px 0'}><MoSection title="Running" count={4}><div><MoRow it={M.items[3]} last onOpen={() => {}} /></div></MoSection></MdsStrip>
          </MdsSpec>
          <MdsSpec name="MoAvatar" em="crew mark + status" src="MobileParts.jsx">
            <div className="mds-stage" style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
              {[['builder', 'running'], ['researcher', 'done'], ['store-ops', 'needs'], ['inbox', 'failed'], ['builder', null]].map(([r, s], i) => <MoAvatar key={i} role={r} state={s} />)}
            </div>
          </MdsSpec>
        </MdsSec>

        <MdsSec id="lists" title="Grouped lists" intro="Settings, channels, checks and files use inset groups on surface with hairlines that start after the icon.">
          <MdsSpec name="MoGroup + MoListRow" src="MobileParts.jsx">
            <MdsStrip pad={16}>
              <MoGroup>
                <MoListRow icon="monitor" label="ben-mbp" sub="Connected over Tailscale · synced 1m ago" chevron={false} />
                <MoListRow icon="bell" label="Notifications" sub="Needs you and Done" onClick={() => {}} />
                <MoListRow icon={<StatusGlyph state="failed" size={9} />} label="Merchant Center feed check" sub="Daily 06:00 · Failed today 06:00" chevron={false} last />
              </MoGroup>
            </MdsStrip>
          </MdsSpec>
          <MdsSpec name="Segmented" em="filters on tab roots" src="components/forms">
            <MdsStrip pad={16}>
              <Segmented options={[{ id: 'all', label: 'All' }, { id: 'needs', label: 'Needs you', count: 3 }, { id: 'running', label: 'Running', count: 4 }, { id: 'done', label: 'Done', count: 4 }]} value="needs" onChange={() => {}} label="Filter" />
              <Segmented options={[{ id: 'all', label: 'All' }, { id: 'report', label: 'Reports' }, { id: 'pr', label: 'PRs' }, { id: 'file', label: 'Files' }]} value="all" onChange={() => {}} label="Type" />
            </MdsStrip>
          </MdsSpec>
        </MdsSec>

        <MdsSec id="transcript" title="Transcript" intro="Your message sits right in a bubble, with who sent it above. Agent prose runs full width at 15/1.6. The Conductor's delegation card lists each crew thread with its status and inline answers.">
          <MdsSpec name="MoBubble + prose" src="MobileParts.jsx · MobileThread.jsx">
            <MdsStrip pad={16}>
              <MoBubble caption="Delegated by the Conductor · T-4F2A">{it('T-4F2A').prompt}</MoBubble>
              <MoOutcome it={it('T-4F2A')} />
              <MoProse>{it('T-4F2A').summary}</MoProse>
            </MdsStrip>
          </MdsSpec>
          <MdsSpec name="MoDelegation" em="Conductor → crew" src="MobileThread.jsx">
            <MdsStrip pad={16}><MoDelegation app={app} /></MdsStrip>
          </MdsSpec>
        </MdsSec>

        <MdsSec id="work" title="Work in progress" intro="A running thread shows what it is doing right now, then the plan. All tool calls fold into one steps row that pushes the full log.">
          <MdsSpec name="MoPlan" em="step 5 of 9" src="MobileThread.jsx"><MdsStrip pad={16}><MoPlan it={it('T-4F2B')} /></MdsStrip></MdsSpec>
          <MdsSpec name="MoStepsRow" em="folded tool calls" src="MobileThread.jsx">
            <MdsStrip pad={16}><MoStepsRow it={it('T-4F2A')} onClick={() => {}} /><MoStepsRow it={{ steps: 23 }} live onClick={() => {}} /></MdsStrip>
          </MdsSpec>
        </MdsSec>

        <MdsSec id="results" title="Results" intro="Artifacts preview live inside the thread and open full screen. Code changes show as a file list with the diff count; review pushes the PR screen.">
          <MdsSpec name="MoArtifactCard" em="live report" src="MobileParts.jsx"><MdsStrip pad={16}><MoArtifactCard name="funnel-before-after.html" sub="Funnel, 7 days before and after" live onOpen={() => {}} /></MdsStrip></MdsSpec>
          <MdsSpec name="MoChanges" em="files + diff" src="MobileThread.jsx"><MdsStrip pad={16}><MoChanges it={it('T-4F1B')} onOpen={() => {}} /></MdsStrip></MdsSpec>
        </MdsSec>

        <MdsSec id="composer" title="Composer" intro="Action chips for this thread sit above one line: + for attachments, model and effort; mic until you type, then send. Placeholder names who you're talking to.">
          <MdsSpec name="MoComposer" em="done thread" src="MobileParts.jsx">
            <MdsStrip><MoComposer placeholder="Follow up" actions={[{ label: 'Open report', icon: 'file' }, { label: 'Ask the Conductor', icon: 'delegate' }]} /></MdsStrip>
          </MdsSpec>
          <MdsSpec name="MoComposer" em="running thread" src="MobileParts.jsx">
            <MdsStrip><MoComposer placeholder="Steer the builder" actions={[{ label: 'Stop', icon: 'stop' }, { label: 'Changes so far', icon: 'diff', diff: [214, 38] }]} /></MdsStrip>
          </MdsSpec>
        </MdsSec>

        <section className="mds-sec" id="screens" data-screen-label="Live screens">
          <h2>Live screens</h2>
          <p>Each phone runs the full app. Tap through, answer, merge, start a delegation. <a href="ui_kits/omni-mobile/index.html">See all 15 on the canvas</a>.</p>
          <div className="mds-phones">
            <MdsPhone name="Activity" note="Needs you, Running, Done today" />
            <MdsPhone name="Conductor thread" note="Delegation with an inline answer" init={{ stack: [{ name: 'thread', id: 'T-4F29' }] }} />
            <MdsPhone name="Crew thread, done" note="Outcome, artifact, folded steps" init={{ stack: [{ name: 'thread', id: 'T-4F2A' }] }} />
            <MdsPhone name="Crew thread, running" note="Now, plan, Stop" init={{ stack: [{ name: 'thread', id: 'T-4F2B' }] }} />
            <MdsPhone name="Channels" note="A tab, not a drawer" init={{ tab: 'channels' }} />
            <MdsPhone name="Pull request" note="Checks, files, slide to merge" init={{ stack: [{ name: 'thread', id: 'T-4F2B' }, { name: 'pr' }] }} />
          </div>
        </section>

        <section className="mds-sec" id="lock" data-screen-label="Lock screen">
          <h2>Lock screen</h2>
          <p>Needs you arrives with its answer as an action. Done deep-links to the report. Running crew stays visible as a Live Activity.</p>
          <div className="mds-phones">
            <MdsPhone name="Lock screen" note="Tap Open to land in the thread" lock />
            <MdsPhone name="Activity, dark" note="The dark tokens" dark />
            <MdsPhone name="Library" note="Every artifact across channels" init={{ tab: 'library' }} />
          </div>
        </section>
      </main>
    </div>
  );
}

Object.assign(window, { MobileDocs });
