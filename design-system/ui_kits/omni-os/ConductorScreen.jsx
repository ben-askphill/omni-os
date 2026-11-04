/* Conductor thread (web/src pages/Thread.tsx + Transcript.tsx), with one delegation fanned out to three crew threads. */
function ConductorThread({ resolved, onResolve, extra = [], thinking, narrow = false }) {
  const { Message, ResultLine, ToolCall, ToolCalls, Delegation, CrewReport, ArtifactEmbed, Button, InlineConfirm, TaskId, Loader, CheckItem, Ticks, HarnessLogo } = window.OmniOS;
  const D = window.OMNI_DATA;
  const vo = { code: 'VO', name: 'Volero' };
  const decide = <InlineConfirm label="Pause WEEKEND15" icon="pause" confirmLabel="Pause until #812 merges" doneLabel="Paused" undoMs={4000} onConfirm={onResolve} />;
  const branches = [
    { taskId: 'T-4F2A', role: 'researcher', title: 'Compare checkout funnel before and after the 25 Sep deploy', channel: vo, harness: 'codex', state: 'done', progress: 'report in · 14:09' },
    { taskId: 'T-4F2B', role: 'builder', title: 'Patch the shipping-rate script in checkout', channel: vo, harness: 'claude-code', state: 'running', progress: 'step 5/9 · editing snippets/shipping-rates.liquid' },
    resolved
      ? { taskId: 'T-4F2C', role: 'store-ops', title: 'WEEKEND15 automation still firing on free-shipping carts', channel: vo, harness: 'claude-code', state: 'settled', statusLabel: 'Paused', progress: 'paused 14:12 · resumes after #812' }
      : { taskId: 'T-4F2C', role: 'store-ops', title: 'WEEKEND15 automation still firing on free-shipping carts', channel: vo, harness: 'claude-code', state: 'needs', note: 'Pause it until the patch ships? It stacks with free shipping and hides the rate step for about 30% of NL carts.', actions: decide }
  ];
  return (
    <div className="om-transcript">
      <Message role="user" time="14:02">Volero’s checkout drop-off spiked after Friday’s theme deploy. Find out why, fix it, and tell me what to send their team.</Message>
      <Message>
        <p>Three things in parallel: measure where the drop is, patch the likely cause, and check whether the weekend automation makes it worse. I’ll bring the numbers back before anything ships.</p>
      </Message>
      <ToolCalls>
        <ToolCall name="search_threads" args='channel:volero "shipping" since:30d' duration="0.4s" output={'3 threads\n  T-4C07  Shipping zones for BE          done  Sep 02\n  T-4D12  Free-shipping threshold test    done  Sep 11\n  T-4E88  Theme 4.2 deploy checklist      done  Sep 25'} />
        <ToolCall name="Read" args="snippets/shipping-rates.liquid" duration="0.2s" />
        <ToolCall name="Bash" args="git log main --since=2026-09-24 --oneline" duration="0.3s" output={'9e1c0af  Theme 4.2: new checkout extensibility rates\n41b7d2e  PDP: size guide drawer'} />
      </ToolCalls>
      <Delegation branches={branches} />
      <CrewReport role="researcher" taskId="T-4F2A" channel={vo} time="14:09" fresh={!resolved} title="The drop is at the shipping step, not payment"
        facts={['7d vs 7d', '18,402 sessions', '−26.2 pts at shipping', <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><HarnessLogo harness="codex" size={11} />Codex · 3m 41s</span>]}>
        <p>Shipping → payment completion fell from <strong>78.3% to 52.1%</strong> starting 25 Sep 16:40, two minutes after commit <code>9e1c0af</code> deployed. Cart, contact and payment steps are flat within a point.</p>
        <ArtifactEmbed name="funnel-before-after.html" kind="html" size="48 KB" taskId="T-4F2A" height={narrow ? 250 : 222} srcDoc={D.funnel} caption="rendered by researcher" />
      </CrewReport>
      <Message>
        <p>That matches the diff: the new rates snippet returns nothing when a discount zeroes the shipping line, so the step renders empty. Builder is patching it on <code>omni/t-4f2b-shipping-rates</code>. PR #812 is open and checks are running.</p>
        {!resolved && <p><strong>One decision is waiting on you</strong> (<TaskId id="T-4F2C" />): WEEKEND15 is what zeroes the line. I’d pause it until #812 merges.</p>}
        {resolved && <p>WEEKEND15 is paused. I’ll draft the note to Maartje once #812 merges and <code>playwright / checkout-nl</code> passes.</p>}
      </Message>
      <section aria-label="Plan" style={{ borderRadius: 22, background: 'var(--surface)', padding: '14px 16px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}><span className="om-caption">Plan</span><Ticks value={resolved ? 0.6 : 0.4} count={5} height={6} style={{ maxWidth: 160, flex: 1 }} /><span style={{ marginLeft: 'auto', font: 'var(--type-meta)', color: 'var(--fg-3)' }}>{resolved ? '3/5' : '2/5'}</span></div>
        <CheckItem state="completed">Find where in the funnel the drop is</CheckItem>
        <CheckItem state="completed">Tie it to the 25 Sep deploy</CheckItem>
        <CheckItem state={resolved ? 'completed' : 'in_progress'}>Decide on WEEKEND15 while the patch is out</CheckItem>
        <CheckItem state={resolved ? 'in_progress' : 'pending'}>Merge #812 once checks pass</CheckItem>
        <CheckItem state="pending">Draft the note to Maartje</CheckItem>
      </section>
      {extra.map((m, i) => (m.role === 'user' ? <Message key={i} role="user" time={m.time}>{m.text}</Message> : <Message key={i}><p>{m.text}</p></Message>))}
      {thinking ? <div className="om-working"><Loader size={12} /> Thinking</div> : <div className="om-working"><Loader size={12} /> Waiting on 1 crew thread · T-4F2B</div>}
    </div>
  );
}

function ConductorScreen({ resolved, onResolve, extra, onSend, thinking, showPanel }) {
  const { Composer, GitHubPanel, Status, Chip, HarnessLogo } = window.OmniOS;
  const D = window.OMNI_DATA;
  const scrollRef = React.useRef(null);
  React.useEffect(() => { const el = scrollRef.current; if (el && (extra.length || thinking)) el.scrollTop = el.scrollHeight; }, [extra.length, thinking]);
  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          <div className="om-thread" style={{ maxWidth: 768, margin: '0 auto', padding: '0 clamp(16px, 4vw, 32px)' }}>
            <header style={{ padding: '32px 0 20px' }}>
              <div className="om-caption" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 10 }}><span>Conductor</span><span>T-4F29</span><span>Mon 28 Sep · 14:02</span></div>
              <h1 className="om-display" style={{ margin: 0, fontSize: 26, lineHeight: 1.15 }}>Volero checkout drop-off after Friday’s deploy</h1>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 14 }}>
                <Status state="running" label="1 running" />
                {!resolved && <Status state="needs" label="1 needs you" />}
                <Status state="done" label="1 done" />
                {resolved && <Status state="settled" label="1 paused" />}
                <Chip tone="outline"><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><HarnessLogo harness="claude-code" size={12} />Claude Code · opus-4.5</span></Chip>
              </div>
            </header>
            <ConductorThread resolved={resolved} onResolve={onResolve} extra={extra} thinking={thinking} />
            <div style={{ height: 28 }} />
          </div>
        </div>
        <div style={{ flex: 'none', padding: '0 clamp(16px, 4vw, 32px) 16px' }}>
          <div style={{ maxWidth: 768, margin: '0 auto' }}>
            <Composer channel={{ code: 'VO', name: 'Volero' }} channels={D.channels.filter((c) => c.id !== 'conductor').slice(0, 6)} model="opus-4.5" onSend={onSend} />
          </div>
        </div>
      </div>
      {showPanel && <GitHubPanel pr={D.pr} />}
    </div>
  );
}

Object.assign(window, { ConductorThread, ConductorScreen });
