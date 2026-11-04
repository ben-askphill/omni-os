import React, { useState } from 'react';
import { StatusGlyph } from '../core/Status.jsx';
import { Icon } from '../icons/Icon.jsx';
import { Loader } from '../brand/Loader.jsx';

const ICON = (n) => (/bash|shell|git/i.test(n) ? 'terminal' : /read|write|edit|file|grep|glob/i.test(n) ? 'file' : /web|browser|fetch|search/i.test(n) ? 'globe' : /task|agent|delegate/i.test(n) ? 'layers' : 'tool');

/* One tool call (web/src Transcript ToolRow): a 32px pill row that opens to its output. */
export function ToolCall({ name, args, status = 'done', duration, output, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button type="button" className="om-tool__head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Icon name="chevronRight" size={12} className="om-caret" />
        <Icon name={ICON(name)} size={13} className="om-tool__icon" />
        <span className="om-tool__name">{name}</span>
        <span className="om-tool__args">{args}</span>
        {status === 'running' ? <Loader size={11} /> : status === 'failed' ? <span className="om-tool__err" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><StatusGlyph state="needs" size={7} />error</span> : duration ? <span className="om-tool__dur">{duration}</span> : null}
      </button>
      {open && <div className="om-tool__out"><pre className="om-pre">{output || '(no output)'}</pre></div>}
    </div>
  );
}

/* A run of tool calls (web/src ToolGroup): 20px-radius surface card, "N tool calls" + names, opens to the rows. */
export function ToolCalls({ children, defaultOpen = false, live }) {
  const [open, setOpen] = useState(defaultOpen);
  const kids = React.Children.toArray(children).filter(Boolean);
  if (kids.length === 1) return <div>{kids[0]}</div>;
  const names = [];
  kids.forEach((k) => { const n = k.props && k.props.name; if (n && !names.includes(n)) names.push(n); });
  const running = live ?? kids.some((k) => k.props && k.props.status === 'running');
  return (
    <div className="om-tgrp">
      <button type="button" className="om-tgrp__head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Icon name="chevronRight" size={12} className="om-caret" />
        <Icon name="tool" size={13} style={{ color: 'var(--fg-3)' }} />
        <b><span style={{ fontFamily: 'var(--font-num)' }}>{kids.length}</span> tool calls</b>
        <span className="sum">{names.slice(0, 4).join(', ')}</span>
        {running && <Loader size={11} />}
      </button>
      {open && <div className="om-tgrp__body">{kids}</div>}
    </div>
  );
}
