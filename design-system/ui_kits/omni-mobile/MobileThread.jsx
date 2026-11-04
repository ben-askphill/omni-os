/* Omni mobile: thread and everything pushed from it. Outcome first, steps folded, one secondary surface at a time. */
function MoStepsRow({ it, onClick, live }) {
  const { StatusGlyph } = OM();
  const n = it.steps || 0;
  return (
    <button type="button" onClick={onClick} className="mo-press" style={{ all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, height: 44, padding: '0 14px', borderRadius: 999, background: 'var(--surface)', font: '400 13.5px/1 var(--font-sans)', color: 'var(--fg-2)' }}>
      <MoIcon name="tool" size={15} />
      <span style={{ flex: 1, fontVariantNumeric: 'tabular-nums' }}>{live ? `${n} steps so far` : `${n} steps`}{it.failed ? <span style={{ color: 'var(--fg-3)' }}> · </span> : null}{it.failed ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><StatusGlyph state="failed" size={7} />{it.failed} failed</span> : null}</span>
      <span style={{ color: 'var(--fg-4)', display: 'grid' }}><MoIcon name="chevronRight" size={15} /></span>
    </button>
  );
}

function MoProse({ children }) {
  return <p style={{ margin: 0, font: '400 15px/1.6 var(--font-sans)', color: 'var(--fg)', textWrap: 'pretty' }}>{children}</p>;
}

function MoOutcome({ it }) {
  const { StatusGlyph } = OM();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, font: '400 12.5px/1.3 var(--font-sans)', color: 'var(--fg-3)', fontVariantNumeric: 'tabular-nums' }}>
      <StatusGlyph state="done" size={8} />Done in {it.dur || '5m'} · {it.steps} steps · {moHarness[it.harness]}
    </div>
  );
}

function MoChanges({ it, onOpen }) {
  const files = it.pr ? window.MOBILE.pr.files : [{ path: 'templates/email/abandoned-cart.liquid', add: 8, del: 3 }, { path: 'templates/email/abandoned-cart-2.liquid', add: 4, del: 1 }, { path: 'locales/nl.json', add: 26, del: 47 }].slice(0, it.files || 2);
  return (
    <div style={{ borderRadius: 20, background: 'var(--surface)', overflow: 'hidden' }}>
      <button type="button" onClick={onOpen} style={{ all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, width: '100%', boxSizing: 'border-box', padding: '12px 16px', font: '500 14px/1 var(--font-sans)' }}>
        Changes <span style={{ color: 'var(--fg-3)', fontWeight: 400 }}>{files.length}</span><span style={{ flex: 1 }} /><span style={{ color: 'var(--fg-4)', display: 'grid' }}><MoIcon name="chevronRight" size={15} /></span>
      </button>
      {files.map((f) => (
        <div key={f.path} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '10px 16px', borderTop: '1px solid var(--line)', font: '400 12.5px/1.3 var(--font-mono)' }}>
          <span style={{ flex: 1, minWidth: 0, direction: 'rtl', textAlign: 'left', ...moEllipsis }}>{f.path}</span><span style={{ font: '400 12.5px var(--font-sans)' }}><MoDiff add={f.add} del={f.del} /></span>
        </div>
      ))}
    </div>
  );
}

function MoPlan({ it }) {
  const { StatusGlyph } = OM();
  return (
    <div style={{ borderRadius: 20, background: 'var(--surface)', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 9 }}>
      <div style={{ display: 'flex', font: '500 13px/1 var(--font-sans)' }}>Plan<span style={{ flex: 1 }} /><span style={{ color: 'var(--fg-3)', fontWeight: 400, fontVariantNumeric: 'tabular-nums' }}>{it.step - 1}/{it.plan.length}</span></div>
      {it.plan.map((p, i) => {
        const st = i < it.step - 1 ? 'done' : i === it.step - 1 ? 'running' : 'idle';
        return <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 10, font: '400 14px/1.35 var(--font-sans)', color: st === 'done' ? 'var(--fg-3)' : st === 'running' ? 'var(--fg)' : 'var(--fg-3)' }}><span style={{ width: 12, display: 'grid', placeItems: 'center' }}><StatusGlyph state={st} size={8} /></span>{p}</div>;
      })}
    </div>
  );
}

function MoDelegation({ app }) {
  const { Status, Button } = OM();
  const kids = window.MOBILE.conductor.children.map(app.find);
  return (
    <div style={{ borderRadius: 20, background: 'var(--surface)', padding: '12px 8px 8px', display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 8px 6px', font: '500 13px/1 var(--font-sans)' }}><MoIcon name="delegate" size={15} />Delegated 3 tasks</div>
      {kids.map((k) => {
        const st = k.state === 'needs' && app.resolved[k.id] ? 'done' : k.state;
        return (
          <div key={k.id} style={{ background: 'var(--elev)', boxShadow: 'var(--shadow-card)', borderRadius: 16, display: 'flex', flexDirection: 'column' }}>
            <button type="button" onClick={() => app.open(k.id)} style={{ all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px' }}>
              <MoAvatar role={k.role} size={32} />
              <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ font: '400 14px/1.3 var(--font-sans)', ...moEllipsis }}>{k.title}</span>
                <span style={{ font: '400 12px/1.3 var(--font-sans)', color: 'var(--fg-3)' }}>{moRoleLabel(k.role)} · {k.id}{k.meta ? ' · ' + k.meta : ''}</span>
              </span>
              <Status state={st} />
            </button>
            {k.state === 'needs' && !app.resolved[k.id] && (
              <div style={{ display: 'flex', gap: 8, padding: '0 12px 12px 54px' }}>
                <Button variant="needs" onClick={() => app.resolve(k.id, true)}>{k.yes}</Button>
                <Button variant="secondary" onClick={() => app.open(k.id)}>Why</Button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ThreadScreen({ app, id }) {
  const { Status, OmniMark, TaskId, StatusGlyph } = OM();
  const it = app.find(id);
  if (!it) return null;
  const isC = it.id === 'T-4F29';
  const state = it.state === 'needs' && app.resolved[it.id] ? 'running' : it.state;
  const report = app.find('T-4F2A');
  const openViewer = (name) => app.push({ name: 'viewer', art: { name, ch: it.ch, live: name === 'funnel-before-after.html' } });
  const actions = [];
  if (isC) { actions.push({ label: 'Open report', icon: 'file', onClick: () => openViewer(report.artifact) }); actions.push({ label: 'Review #812', icon: 'pr', diff: [214, 38], onClick: () => app.push({ name: 'pr' }) }); }
  if (it.artifact) actions.push({ label: 'Open report', icon: 'file', onClick: () => openViewer(it.artifact) });
  if (it.diff) actions.push({ label: 'Review changes', icon: 'diff', diff: it.diff, onClick: () => app.push({ name: 'pr' }) });
  if (it.state === 'running') { actions.push({ label: 'Stop', icon: 'stop', onClick: () => app.toast('Stopped ' + it.id) }); if (it.pr) actions.push({ label: 'Changes so far', icon: 'diff', diff: [214, 38], onClick: () => app.push({ name: 'pr' }) }); }
  if (it.state === 'done' && !isC) actions.push({ label: 'Ask the Conductor', icon: 'delegate', onClick: () => app.setSheet({ name: 'new' }) });
  return (
    <>
      <MoHeader onBack={app.back} title={it.title} sub={isC ? 'Conductor · 3 crew threads' : `#${it.ch} · ${moRoleLabel(it.role)} · ${moHarness[it.harness]}`}
        right={<><Status state={state === 'done' ? 'done' : state} label={isC ? (app.resolved['T-4F2C'] ? '1 running' : 'Needs you') : undefined} /><MoRound icon="more" label="Thread options" onClick={() => app.setSheet({ name: 'menu', id })} /></>} />
      <div className="mo-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '8px 16px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <MoBubble caption={it.via ? 'Delegated by the Conductor · ' + it.id : isC ? 'You · ' + it.time : it.id}>{it.prompt}</MoBubble>
        {isC && <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, font: '400 12.5px/1 var(--font-sans)', color: 'var(--fg-3)' }}><OmniMark size={20} state="delegating" interactive={false} />Conductor</div>
          <MoProse>I split this three ways. The researcher found the cause, the builder is patching it, and store-ops needs your call on a discount before it touches anything.</MoProse>
          <MoDelegation app={app} />
          <div style={{ borderRadius: 20, background: 'var(--surface)', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, font: '500 13px/1 var(--font-sans)' }}><MoAvatar role="researcher" size={26} />Report from researcher<span style={{ flex: 1 }} /><TaskId id="T-4F2A" /></div>
            <MoProse>{report.summary}</MoProse>
            <MoArtifactCard name={report.artifact} sub="Funnel, 7 days before and after" live onOpen={() => openViewer(report.artifact)} />
          </div>
        </>}
        {!isC && it.state === 'done' && <>
          <MoOutcome it={it} />
          <MoProse>{it.summary}</MoProse>
          {it.artifact && <MoArtifactCard name={it.artifact} sub={'#' + it.ch + ' · ' + it.time + ' ago'} live={it.artifact === 'funnel-before-after.html'} onOpen={() => openViewer(it.artifact)} />}
          {it.diff && <MoChanges it={it} onOpen={() => app.push({ name: 'pr' })} />}
          <MoStepsRow it={it} onClick={() => app.push({ name: 'steps', id })} />
        </>}
        {!isC && it.state === 'running' && <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 16, background: 'var(--surface)' }}>
            <StatusGlyph state="running" size={9} />
            <span style={{ flex: 1, minWidth: 0, font: '400 14px/1.35 var(--font-sans)', ...moEllipsis }}>{it.nowVerb} <span style={{ font: '400 13px var(--font-mono)' }}>{it.now}</span></span>
            <span style={{ font: '400 12px var(--font-sans)', color: 'var(--fg-3)', fontVariantNumeric: 'tabular-nums' }}>{it.meta}</span>
          </div>
          <MoPlan it={it} />
          <MoStepsRow it={{ steps: 23 }} live onClick={() => app.push({ name: 'steps', id })} />
        </>}
        {!isC && it.state === 'needs' && <>
          <MoStepsRow it={it} onClick={() => app.push({ name: 'steps', id })} />
          <MoDecision it={it} app={app} inThread />
          {app.resolved[it.id] && <div style={{ display: 'flex', alignItems: 'center', gap: 8, font: '400 12.5px/1 var(--font-sans)', color: 'var(--fg-3)' }}><StatusGlyph state="running" size={8} />{moRoleLabel(it.role)} is carrying on</div>}
        </>}
      </div>
      <MoComposer placeholder={isC ? 'Reply to the Conductor' : it.state === 'running' ? 'Steer the ' + it.role : 'Follow up'} actions={actions} onPlus={() => app.setSheet({ name: 'plus', harness: it.harness })} onSend={(t) => app.toast('Sent to ' + (isC ? 'the Conductor' : it.role))} />
    </>
  );
}

function MenuSheet({ app, id }) {
  const it = app.find(id);
  const go = (s) => { app.setSheet(null); app.push(s); };
  return (
    <MoSheet onClose={() => app.setSheet(null)}>
      <div style={{ padding: '10px 20px 8px', font: '500 15px/1.3 var(--font-sans)', ...moEllipsis }}>{it.title}</div>
      <div style={{ padding: '0 12px' }}>
        <MoGroup>
          {(it.pr || it.diff || it.id === 'T-4F29') && <MoListRow icon="diff" label="Changes" sub="PR #812 · 3 files" onClick={() => go({ name: 'pr' })} />}
          <MoListRow icon="browser" label="Browser" sub="Watch only" onClick={() => go({ name: 'browser', id })} />
          <MoListRow icon="terminal" label="Terminal" sub="Read only" onClick={() => go({ name: 'terminal', id })} />
          <MoListRow icon="info" label="Details" sub="Harness, model, session" onClick={() => go({ name: 'details', id })} last />
        </MoGroup>
        <div style={{ height: 10 }} />
        <MoGroup>
          <MoListRow icon="pin" label="Pin to Activity" chevron={false} onClick={() => { app.setSheet(null); app.toast('Pinned'); }} />
          <MoListRow icon="archive" label="Archive thread" chevron={false} onClick={() => { app.setSheet(null); app.toast('Archived ' + id); }} last />
        </MoGroup>
      </div>
    </MoSheet>
  );
}

function PlusSheet({ app, harness = 'claude-code' }) {
  const { HarnessMark } = OM();
  const close = () => app.setSheet(null);
  return (
    <MoSheet onClose={close}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 8, padding: '12px 12px 10px' }}>
        {[['image', 'Photo'], ['maximize', 'Screenshot'], ['file', 'File']].map(([ic, l]) => (
          <button key={l} type="button" onClick={close} className="mo-press" style={{ height: 76, borderRadius: 18, border: 0, cursor: 'pointer', background: 'var(--surface)', color: 'var(--fg)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, font: '400 13px var(--font-sans)' }}><MoIcon name={ic} size={20} />{l}</button>
        ))}
      </div>
      <div style={{ padding: '0 12px' }}>
        <MoGroup>
          <MoListRow icon={<HarnessMark harness={harness} />} label="Model" right={harness === 'codex' ? 'GPT-5.5' : harness === 'cursor' ? 'Composer 2.5' : 'Sonnet 5.5'} onClick={close} />
          <MoListRow icon="gauge" label="Effort" right="High" onClick={close} last />
        </MoGroup>
      </div>
    </MoSheet>
  );
}

function StepsScreen({ app, id }) {
  const { StatusGlyph } = OM();
  const it = app.find(id);
  return (
    <>
      <MoHeader onBack={app.back} title="Steps" sub={it.title} />
      <div className="mo-scroll" style={{ flex: 1, overflowY: 'auto', padding: '8px 16px 40px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {window.MOBILE.steps.map((s, i) => (
          <div key={i} style={{ borderRadius: 16, background: 'var(--surface)', padding: '11px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <StatusGlyph state={s.ok ? 'done' : 'failed'} size={8} />
              <span style={{ font: '500 13px var(--font-sans)' }}>{s.t}</span>
              <span style={{ flex: 1, minWidth: 0, font: '400 12.5px/1.3 var(--font-mono)', color: 'var(--fg-2)', ...moEllipsis }}>{s.a}</span>
            </div>
            {s.out && <div style={{ marginLeft: 18, font: '400 12px/1.45 var(--font-mono)', color: s.ok ? 'var(--fg-3)' : 'var(--fg)', background: 'var(--surface-2)', borderRadius: 10, padding: '6px 9px' }}>{s.out}</div>}
          </div>
        ))}
      </div>
    </>
  );
}

function PRScreen({ app }) {
  const { Chip, StatusGlyph, SlideToConfirm } = OM();
  const pr = window.MOBILE.pr;
  return (
    <>
      <MoHeader onBack={app.back} title={'#' + pr.number} sub={pr.repo} right={<MoRound icon="external" label="Open on GitHub" onClick={() => app.toast('Opens github.com/volero/theme/pull/812')} />} />
      <div className="mo-scroll" style={{ flex: 1, overflowY: 'auto', padding: '6px 16px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h2 style={{ margin: 0, font: '500 22px/1.25 var(--font-head)', letterSpacing: '-0.01em', textWrap: 'pretty' }}>{pr.title}</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', font: '400 13px var(--font-sans)', color: 'var(--fg-3)' }}><Chip tone="outline">Open</Chip><MoDiff add={pr.additions} del={pr.deletions} /> · {pr.files.length} files · 4 commits</div>
          <span style={{ font: '400 12px/1.3 var(--font-mono)', color: 'var(--fg-3)' }}>{pr.branch} → {pr.base}</span>
        </div>
        <MoSection title="Checks" count={pr.checks.length} pad={false}>
          <MoGroup>{pr.checks.map((c, i) => <MoListRow key={c.name} icon={<StatusGlyph state={c.state} size={9} />} label={c.name} right={c.duration} chevron={false} last={i === pr.checks.length - 1} />)}</MoGroup>
        </MoSection>
        <MoSection title="Files" count={pr.files.length} pad={false}>
          <MoGroup>{pr.files.map((f, i) => (
            <div key={f.path} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '13px 16px', borderTop: i ? '1px solid var(--line)' : 0 }}>
              <span style={{ flex: 1, minWidth: 0, font: '400 12.5px/1.3 var(--font-mono)', ...moEllipsis }}>{f.path}</span><span style={{ font: '400 12.5px var(--font-sans)' }}><MoDiff add={f.add} del={f.del} /></span>
            </div>
          ))}</MoGroup>
        </MoSection>
      </div>
      <div style={{ flex: 'none', padding: '8px 16px 34px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ font: '400 12.5px/1.3 var(--font-sans)', color: 'var(--fg-3)', textAlign: 'center' }}>2 checks still running. Merging now skips them.</span>
        <SlideToConfirm label="Slide to squash and merge" doneLabel="Merged #812" busyLabel="Merging" onConfirm={() => new Promise((r) => setTimeout(r, 900))} />
      </div>
    </>
  );
}

function DetailsScreen({ app, id }) {
  const { HarnessMark } = OM();
  const it = app.find(id);
  const rows = [['Channel', '#' + it.ch], ['Crew role', moRoleLabel(it.role)], ['Harness', <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><HarnessMark harness={it.harness || 'claude-code'} />{moHarness[it.harness || 'claude-code']}</span>], ['Model', it.harness === 'codex' ? 'GPT-5.5' : 'Sonnet 5.5'], ['Effort', 'High'], ['Source', it.via ? 'Conductor' : 'You'], ['Started', 'Today 14:02'], ['Turns', '14']];
  return (
    <>
      <MoHeader onBack={app.back} title="Details" sub={it.id} />
      <div className="mo-scroll" style={{ flex: 1, overflowY: 'auto', padding: '8px 16px 40px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <MoGroup>{rows.map(([k, v], i) => (
          <div key={k} style={{ display: 'flex', alignItems: 'center', minHeight: 48, padding: '0 16px', borderTop: i ? '1px solid var(--line)' : 0, font: '400 14.5px var(--font-sans)' }}>
            <span style={{ width: 104, color: 'var(--fg-3)' }}>{k}</span><span style={{ flex: 1, minWidth: 0 }}>{v}</span>
          </div>
        ))}</MoGroup>
        <p style={{ margin: 0, padding: '0 4px', font: '400 13px/1.5 var(--font-sans)', color: 'var(--fg-3)' }}>Session id, working directory and the resume command are on the Mac, under Details in the thread panel.</p>
      </div>
    </>
  );
}

function TerminalScreen({ app, id }) {
  const lines = ['$ npm run theme-check', 'Checking 212 files…', 'snippets/shipping-rates.liquid:41  RemoteAsset  ok', 'snippets/shipping-rates.liquid:88  ParserBlockingScript  fixed', '0 offenses', '$ npx playwright test checkout-nl', 'Running 6 tests using 3 workers', '  ✓ rate step loads for NL cart (2.1s)', '  ✓ free shipping over €60 (1.8s)', '  … 4 more running'];
  return (
    <>
      <MoHeader onBack={app.back} title="Terminal" sub="Read only · take over on the Mac" />
      <div className="mo-scroll scheme-dark" style={{ flex: 1, overflowY: 'auto', margin: '4px 12px 40px', borderRadius: 20, background: 'var(--chrome)', color: '#eceae5', padding: 16, font: '400 12px/1.7 var(--font-mono)' }}>
        {lines.map((l, i) => <div key={i} style={{ color: l.startsWith('$') ? '#eceae5' : '#908f89', whiteSpace: 'pre-wrap' }}>{l}</div>)}
      </div>
    </>
  );
}

function BrowserScreen({ app }) {
  return (
    <>
      <MoHeader onBack={app.back} title="Browser" sub="volero.nl/checkout · watch only" />
      <div style={{ flex: 1, padding: '4px 12px 40px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <MoStripes label="live browser view · volero.nl/checkout" height={'100%'} radius={20} />
        <p style={{ margin: 0, padding: '0 4px', font: '400 13px/1.5 var(--font-sans)', color: 'var(--fg-3)' }}>The agent is driving this browser. Logins and captchas are handled on the Mac.</p>
      </div>
    </>
  );
}

function ViewerScreen({ app, art }) {
  return (
    <>
      <MoHeader left={<MoRound icon="x" label="Close" onClick={app.back} />} title={<span style={{ font: '400 13.5px var(--font-mono)' }}>{art.name}</span>} sub={'#' + (art.ch || 'Volero') + (art.role ? ' · ' + art.role : '')} right={<MoRound icon="share" label="Share" onClick={() => app.toast('Share sheet')} />} />
      <div style={{ flex: 1, minHeight: 0, margin: '4px 0 0', background: '#fff', borderRadius: '22px 22px 0 0', overflow: 'hidden', boxShadow: 'var(--shadow-card)' }}>
        {art.live ? <iframe title={art.name} srcDoc={window.MOBILE.funnel} style={{ border: 0, width: '100%', height: '100%' }} /> : <div style={{ padding: 16, height: '100%', boxSizing: 'border-box' }}><MoStripes label={art.name} height={'100%'} /></div>}
      </div>
    </>
  );
}

Object.assign(window, { MoStepsRow, MoProse, MoOutcome, MoChanges, MoPlan, MoDelegation, ThreadScreen, MenuSheet, PlusSheet, StepsScreen, PRScreen, DetailsScreen, TerminalScreen, BrowserScreen, ViewerScreen });
